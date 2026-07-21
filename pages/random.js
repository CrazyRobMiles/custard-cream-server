const express = require('express');
const router = express.Router();
const path = require('path');
const sharp = require('sharp');
const Picture = require('../schemas/picture');

const PICTURES_DIR = path.join(__dirname, '..', 'public', 'pictures');
const THUMB_MAX_DIMENSION = 240;
const THUMB_JPEG_QUALITY = 70;

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
        const thumbnail = await sharp(path.join(PICTURES_DIR, results[0].filename))
            .rotate() // apply EXIF orientation before it gets stripped by re-encoding
            .resize(THUMB_MAX_DIMENSION, THUMB_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: THUMB_JPEG_QUALITY })
            .toBuffer();

        // Every request should be a fresh random pick, not a cached one.
        res.set('Cache-Control', 'no-store');
        res.type('image/jpeg').send(thumbnail);
    }
    catch (err) {
        console.log('Thumbnail generation failed:', err.message);
        res.status(500).json({ error: 'Could not generate thumbnail' });
    }
});

module.exports = router;
