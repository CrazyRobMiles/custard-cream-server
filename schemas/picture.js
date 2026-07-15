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
        }
    });

module.exports = mongoose.model('Picture', pictureSchema);
