const mongoose = require('mongoose');

const pictureSchema = new mongoose.Schema(
    {
        phrase: {
            type: String,
            required: true,
            unique: true
        },
        filename: {
            type: String,
            required: true
        },
        originalName: {
            type: String,
            required: true
        },
        mimeType: {
            type: String,
            required: true
        },
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        uploadedAt: {
            type: Date,
            default: Date.now,
            required: true
        },
        // Comma-separated list of tags (e.g. "emf2026,workshop"), provided by
        // the camera alongside the image. See docs/configuration.md for the
        // full upload request format.
        tags: {
            type: String,
            default: ''
        },
        // The AI instruction/prompt the camera used to process this image,
        // if any.
        aiInstruction: {
            type: String,
            default: ''
        },
        // Three-word phrase of the original picture this one was derived
        // from (e.g. an AI-edited version of an already-published photo).
        originalPhrase: {
            type: String,
            default: ''
        }
    });

// Normally resolves to the default "pictures" collection. Set
// PICTURES_COLLECTION in .env to point the whole app at a different
// collection instead - e.g. a local test collection seeded to match whatever
// files actually exist in public/pictures/ on this machine, so test runs
// never read or write the real production Picture documents (most of which
// reference files this machine doesn't have). See scripts/seedTestPictures.js.
module.exports = mongoose.model('Picture', pictureSchema, process.env.PICTURES_COLLECTION || undefined);
