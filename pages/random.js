const express = require('express');
const router = express.Router();
const { renderThumbnail } = require('../behaviours/thumbnail');
const TagCache = require('../behaviours/tagCache');
const Picture = require('../schemas/picture');

const MAX_BATCH_COUNT = 20;

// Same one-line escape used locally by pages/manage.js's tag filter - small
// enough that duplicating it here beats adding a shared util for one line.
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', async (req, res) => {
    // Consent is given by the camera operator choosing to publish at capture
    // time, so every uploaded picture is eligible for random view - no
    // separate release/consent gate.
    const results = await Picture.aggregate([{ $sample: { size: 1 } }]);

    if (results.length === 0) {
        res.render('random.ejs', { picture: null });
        return;
    }

    // $sample returns plain objects, not hydrated documents, but the view
    // only needs the fields it already selected (phrase, filename).
    res.render('random.ejs', { picture: results[0] });
});

// Raw originals can be several MB - far too big for small/embedded clients
// (e.g. the EMF badge) to download and decode. This returns a random pick
// already scaled down and re-encoded as a small JPEG.
router.get('/thumb', async (req, res) => {
    const results = await Picture.aggregate([{ $sample: { size: 1 } }]);

    if (results.length === 0) {
        res.status(404).json({ error: 'No pictures available' });
        return;
    }

    try {
        const thumbnail = await renderThumbnail(results[0].filename);

        // Every request should be a fresh random pick, not a cached one.
        res.set('Cache-Control', 'no-store');
        res.type('image/jpeg').send(thumbnail);
    }
    catch (err) {
        console.log('Thumbnail generation failed:', err.message);
        res.status(500).json({ error: 'Could not generate thumbnail' });
    }
});

// Powers the slideshow display - returns a batch of random pictures (as JSON
// metadata, not image bytes) optionally restricted to pictures carrying at
// least one of the given tags. Same no-consent-gate as the rest of /random.
router.get('/batch', async (req, res) => {
    const requestedCount = parseInt(req.query.count, 10) || 1;
    const count = Math.min(Math.max(1, requestedCount), MAX_BATCH_COUNT);

    const tags = String(req.query.tags || '')
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    const pipeline = [];
    if (tags.length > 0) {
        // OR match: any picture carrying at least one of the requested tags.
        const alternation = tags.map(escapeRegex).join('|');
        pipeline.push({ $match: { tags: { $regex: `(^|,)\\s*(${alternation})\\s*(,|$)` } } });
    }
    // $match before $sample so the random pick is drawn from the filtered
    // subset, not sampled first and then filtered down.
    pipeline.push({ $sample: { size: count } });

    const results = await Picture.aggregate(pipeline);
    res.json({ pictures: results.map(p => ({ phrase: p.phrase, filename: p.filename })) });
});

// Public tag list for the slideshow start page's picker - read-only, backed
// by the same in-memory TagCache pages/manage.js already uses.
router.get('/tags', (req, res) => {
    res.json({ tags: TagCache.getTags() });
});

module.exports = router;
