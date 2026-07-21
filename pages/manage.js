const express = require('express');
const router = express.Router();

const authenticateToken = require('../behaviours/authenticateToken');
const requireRole = require('../behaviours/requireRole');
const TagCache = require('../behaviours/tagCache');
const Picture = require('../schemas/picture');

const PAGE_SIZE = 9;

// Every route here is for the site owner only - no route under /manage is
// ever reachable without a valid session for a "camera" role account.
router.use(authenticateToken, requireRole('camera'));

router.get('/', (req, res) => {
    res.render('manage.ejs');
});

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Backed by the in-memory TagCache (built at startup, kept current by
// registerTags on every save) rather than scanning every Picture here.
router.get('/api/tags', (req, res) => {
    res.json({ tags: TagCache.getTags() });
});

router.get('/api/pictures', async (req, res) => {
    const tag = String(req.query.tag || '').trim();
    const requestedPage = Math.max(1, parseInt(req.query.page, 10) || 1);

    const filter = {};
    if (tag) {
        filter.tags = { $regex: `(^|,)\\s*${escapeRegex(tag)}\\s*(,|$)` };
    }

    const totalCount = await Picture.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);

    const pictures = await Picture.find(filter)
        .sort({ uploadedAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE);

    res.json({
        pictures: pictures.map(picture => ({
            phrase: picture.phrase,
            filename: picture.filename,
            tags: picture.tags
        })),
        page,
        totalPages,
        totalCount
    });
});

router.get('/api/pictures/:phrase', async (req, res) => {
    const picture = await Picture.findOne({ phrase: req.params.phrase });

    if (picture === null) {
        res.status(404).json({ error: 'Picture not found' });
        return;
    }

    res.json({
        phrase: picture.phrase,
        filename: picture.filename,
        tags: picture.tags,
        aiInstruction: picture.aiInstruction,
        originalPhrase: picture.originalPhrase
    });
});

router.patch('/api/pictures/:phrase', async (req, res) => {
    const picture = await Picture.findOne({ phrase: req.params.phrase });

    if (picture === null) {
        res.status(404).json({ error: 'Picture not found' });
        return;
    }

    // Phrase and filename are not editable here - phrase is the picture's
    // permanent identity (used in shareable URLs) and filename is tied to
    // the file already on disk.
    picture.tags = String(req.body.tags ?? '').trim();
    picture.aiInstruction = String(req.body.aiInstruction ?? '').trim();
    picture.originalPhrase = String(req.body.originalPhrase ?? '').trim();

    await picture.save();
    TagCache.registerTags(picture.tags);

    res.json({
        phrase: picture.phrase,
        filename: picture.filename,
        tags: picture.tags,
        aiInstruction: picture.aiInstruction,
        originalPhrase: picture.originalPhrase
    });
});

// Removes only the Picture document - the image file under public/pictures/
// is left in place, same as every other maintenance script in scripts/.
router.delete('/api/pictures/:phrase', async (req, res) => {
    const result = await Picture.deleteOne({ phrase: req.params.phrase });

    if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Picture not found' });
        return;
    }

    res.status(204).end();
});

module.exports = router;
