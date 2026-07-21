// One-shot script: copy every existing Picture document into a separate
// "PictureBackup" collection, as a snapshot before running other bulk changes.
//
// Usage:
//   node scripts/backupPictures.js
//
// Safe to re-run - each picture is upserted by its original _id, so this
// never creates duplicates and never deletes anything, from either
// collection. Copies raw documents via the native MongoDB driver (not the
// Mongoose model), so any fields outside the current Picture schema are
// preserved as-is.

require('dotenv').config();
const mongoose = require('mongoose');
const Picture = require('../schemas/picture');

async function run() {
    await mongoose.connect(process.env.DATABASE_URL, {});

    const pictures = await Picture.collection.find({}).toArray();
    const backupCollection = mongoose.connection.db.collection('PictureBackup');

    let count = 0;
    for (const picture of pictures) {
        await backupCollection.replaceOne({ _id: picture._id }, picture, { upsert: true });
        count++;
    }

    console.log(`Backed up ${count} picture(s) into PictureBackup.`);

    await mongoose.disconnect();
}

run().catch(err => {
    console.error('Backup failed:', err.message);
    process.exit(1);
});
