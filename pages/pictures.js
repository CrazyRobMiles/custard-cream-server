const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');

const authenticateToken = require('../behaviours/authenticateToken');
const requireRole = require('../behaviours/requireRole');
const generateUniqueThreeWordPhrase = require('../behaviours/threeWordPhrase');
const TagCache = require('../behaviours/tagCache');
const EXTENSION_BY_MIME_TYPE = require('../behaviours/imageMimeTypes');
const Picture = require('../schemas/picture');

const PICTURES_DIR = path.join(__dirname, '..', 'public', 'pictures');

// Someone typing "Oak Larch Feather" (spaces, mixed case) should still find
// oak-larch-feather - normalize before ever looking it up.
function normalizePhrase(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024,
        files: 1
    },
    fileFilter(req, file, cb) {
        if (!EXTENSION_BY_MIME_TYPE[file.mimetype]) {
            cb(new Error('Only JPEG and PNG images are accepted'));
            return;
        }
        cb(null, true);
    }
});

router.post('/', authenticateToken, requireRole('camera', 'admin'), upload.single('image'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'No image file provided (expected field "image")' });
        return;
    }

    try {
        const phrase = await generateUniqueThreeWordPhrase();
        const extension = EXTENSION_BY_MIME_TYPE[req.file.mimetype];
        // The on-disk filename is a random GUID, unrelated to the phrase - so
        // browsing public/pictures/ (or knowing a raw file URL) can't reveal
        // which three words point at which file. Finding a picture always
        // requires the phrase -> Picture database lookup below.
        const filename = `${crypto.randomUUID()}${extension}`;

        await fs.writeFile(path.join(PICTURES_DIR, filename), req.file.buffer);

        const picture = new Picture({
            phrase,
            filename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            uploadedBy: res.user._id,
            // Optional fields from the camera - all default to '' if omitted.
            tags: String(req.body.tags || '').trim(),
            aiInstruction: String(req.body.aiInstruction || '').trim(),
            originalPhrase: String(req.body.originalPhrase || '').trim()
        });

        await picture.save();
        TagCache.registerTags(picture.tags);

        const url = new URL(`pictures/${phrase}`, process.env.HOST_ADDRESS).toString();

        res.status(201).json({ url, phrase });
    }
    catch (err) {
        console.log('Picture upload failed:', err.message);
        res.status(500).json({ error: 'Could not save picture' });
    }
});

// Must be registered before GET /:phrase, or "find" would be parsed as a phrase.
router.get('/find', (req, res) => {
    const phrase = normalizePhrase(req.query.phrase);

    if (!phrase) {
        res.redirect('/');
        return;
    }

    res.redirect(`/pictures/${encodeURIComponent(phrase)}`);
});

router.get('/:phrase', async (req, res) => {
    const picture = await Picture.findOne({ phrase: req.params.phrase });

    if (picture === null) {
        res.status(404).render('pictureNotFound.ejs', { phrase: req.params.phrase });
        return;
    }

    res.render('picture.ejs', { picture });
});

module.exports = router;
