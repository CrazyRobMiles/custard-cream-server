const Picture = require('../schemas/picture');

// In-memory cache of every tag currently in use across all Pictures, built
// once at startup (init) and then kept up to date incrementally by
// registerTags whenever a Picture is saved - avoids re-scanning the whole
// collection on every /manage/api/tags request.
//
// Only ever grows: a tag stays cached even after the last Picture using it is
// edited or deleted, so the filter dropdown may occasionally offer a tag with
// zero matching pictures. That's a minor staleness tradeoff for not having to
// rescan the collection on every delete/edit - restarting the server (init())
// resyncs it exactly to what's in the database.
let tagSet = new Set();

function splitTags(tagsString) {
    return String(tagsString || '')
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
}

async function init() {
    const pictures = await Picture.find({}, 'tags');
    tagSet = new Set();

    for (const picture of pictures) {
        for (const tag of splitTags(picture.tags)) {
            tagSet.add(tag);
        }
    }
}

// Call after saving a Picture whose tags field may include ones not yet seen.
function registerTags(tagsString) {
    for (const tag of splitTags(tagsString)) {
        tagSet.add(tag);
    }
}

function getTags() {
    return [...tagSet].sort();
}

module.exports = { init, registerTags, getTags };
