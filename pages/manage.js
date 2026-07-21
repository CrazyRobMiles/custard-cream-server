const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const authenticateToken = require('../behaviours/authenticateToken');
const requireRole = require('../behaviours/requireRole');
const TagCache = require('../behaviours/tagCache');
const NanoBanana = require('../behaviours/nanoBanana');
const generateUniqueThreeWordPhrase = require('../behaviours/threeWordPhrase');
const EXTENSION_BY_MIME_TYPE = require('../behaviours/imageMimeTypes');
const Picture = require('../schemas/picture');

const PAGE_SIZE = 9;
const PICTURES_DIR = path.join(__dirname, '..', 'public', 'pictures');

function pictureDetail(picture) {
    return {
        phrase: picture.phrase,
        filename: picture.filename,
        tags: picture.tags,
        aiInstruction: picture.aiInstruction,
        originalPhrase: picture.originalPhrase
    };
}

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

    res.json(pictureDetail(picture));
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

    res.json(pictureDetail(picture));
});

// Sends the picture to Nano Banana (Gemini) for an AI edit and saves the
// result as a new derived Picture - never overwrites the original, same as
// how the camera itself records an AI-edited picture (aiInstruction and
// originalPhrase link the derivative back to what it came from).
router.post('/api/pictures/:phrase/ai-edit', async (req, res) => {
    const prompt = String(req.body.prompt || '').trim();

    if (!prompt) {
        res.status(400).json({ error: 'A prompt is required' });
        return;
    }

    const original = await Picture.findOne({ phrase: req.params.phrase });

    if (original === null) {
        res.status(404).json({ error: 'Picture not found' });
        return;
    }

    let imageBuffer;
    try {
        imageBuffer = await fs.readFile(path.join(PICTURES_DIR, original.filename));
    } catch (err) {
        res.status(409).json({ error: 'Image file is not available on this server, so it cannot be AI edited here' });
        return;
    }

    let result;
    try {
        result = await NanoBanana.editImage(imageBuffer, prompt, original.mimeType);
    } catch (err) {
        console.log('AI edit request failed:', err.message);
        res.status(502).json({ error: `AI edit request failed: ${err.message}` });
        return;
    }

    if (!result.data) {
        res.status(422).json({
            error: result.text ? `AI edit did not return an image: ${result.text}` : 'AI edit did not return an image'
        });
        return;
    }

    const extension = EXTENSION_BY_MIME_TYPE[result.mimeType] || '.png';
    const filename = `${crypto.randomUUID()}${extension}`;
    await fs.writeFile(path.join(PICTURES_DIR, filename), result.data);

    const picture = new Picture({
        phrase: await generateUniqueThreeWordPhrase(),
        filename,
        originalName: original.originalName,
        mimeType: result.mimeType,
        uploadedBy: res.user._id,
        tags: original.tags,
        aiInstruction: prompt,
        originalPhrase: original.phrase
    });

    await picture.save();
    TagCache.registerTags(picture.tags);

    res.status(201).json(pictureDetail(picture));
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
