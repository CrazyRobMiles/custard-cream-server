// One-shot / repeatable script: seed a Picture document for every image file
// that actually exists in public/pictures/ on this machine, into whatever
// collection PICTURES_COLLECTION points at (see schemas/picture.js) - never
// the real production "pictures" collection, which references many files
// this machine doesn't have on disk.
//
// Usage:
//   1. Set PICTURES_COLLECTION=testpictures (or similar) in your local .env.
//   2. node scripts/seedTestPictures.js
//   3. Run the server/other scripts as normal - they'll all read/write
//      PICTURES_COLLECTION instead of the real "pictures" collection.
//
// Safe to re-run - files that already have a matching Picture document
// (matched by filename) are left untouched. Refuses to run at all unless
// PICTURES_COLLECTION is set, so it can never accidentally seed fake test
// data into the real production collection.

require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const Picture = require('../schemas/picture');
const User = require('../schemas/user');
const words = require('../wordlist.json');

const PICTURES_DIR = path.join(__dirname, '..', 'public', 'pictures');

const MIME_TYPE_BY_EXTENSION = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png'
};

function randomPhrase() {
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return [pick(), pick(), pick()].join('-');
}

async function uniquePhrase() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const phrase = randomPhrase();
        if ((await Picture.findOne({ phrase })) === null) return phrase;
    }
    throw new Error('Could not find a free three-word phrase after 20 attempts');
}

async function run() {
    if (!process.env.PICTURES_COLLECTION) {
        throw new Error(
            'Refusing to run: set PICTURES_COLLECTION in .env to a test collection ' +
            'name (e.g. "testpictures") first - this must never seed the real ' +
            'production "pictures" collection.'
        );
    }

    await mongoose.connect(process.env.DATABASE_URL, {});

    const cameraUser = await User.findOne({ email: process.env.CAMERA_ACCOUNT_EMAIL });
    if (!cameraUser) {
        throw new Error(
            `No user found for CAMERA_ACCOUNT_EMAIL (${process.env.CAMERA_ACCOUNT_EMAIL}) - ` +
            'start the server once first so it can create the camera account.'
        );
    }

    const filenames = (await fs.readdir(PICTURES_DIR))
        .filter(name => MIME_TYPE_BY_EXTENSION[path.extname(name).toLowerCase()]);

    let created = 0;
    let skipped = 0;

    for (const filename of filenames) {
        if (await Picture.findOne({ filename })) {
            skipped++;
            continue;
        }

        const picture = new Picture({
            phrase: await uniquePhrase(),
            filename,
            originalName: filename,
            mimeType: MIME_TYPE_BY_EXTENSION[path.extname(filename).toLowerCase()],
            uploadedBy: cameraUser._id,
            tags: 'test',
            aiInstruction: '',
            originalPhrase: ''
        });
        await picture.save();
        created++;
    }

    console.log(
        `Seeded "${process.env.PICTURES_COLLECTION}": ${created} created, ${skipped} ` +
        `already present (of ${filenames.length} files on disk in public/pictures/).`
    );

    await mongoose.disconnect();
}

run().catch(err => {
    console.error('Seeding test pictures failed:', err.message);
    process.exit(1);
});
