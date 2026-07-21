// One-shot script: add a tag to every existing Picture document.
//
// Usage:
//   node scripts/addTag.js [tag]
//
// Defaults to "emf2026" if no tag is given. Safe to re-run - pictures that
// already have the tag are left untouched.

require('dotenv').config();
const mongoose = require('mongoose');
const Picture = require('../schemas/picture');

const tagToAdd = process.argv[2] || 'emf2026';

function parseTags(tagsString) {
    return String(tagsString || '')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
}

async function run() {
    await mongoose.connect(process.env.DATABASE_URL, {});

    const pictures = await Picture.find({});
    let updatedCount = 0;

    for (const picture of pictures) {
        const tags = parseTags(picture.tags);

        if (tags.includes(tagToAdd)) {
            continue;
        }

        tags.push(tagToAdd);
        picture.tags = tags.join(',');
        await picture.save();
        updatedCount++;
    }

    console.log(`Checked ${pictures.length} picture(s); added "${tagToAdd}" to ${updatedCount} of them.`);

    await mongoose.disconnect();
}

run().catch(err => {
    console.error('Failed to add tag:', err.message);
    process.exit(1);
});
