const path = require('path');
const sharp = require('sharp');

const PICTURES_DIR = path.join(__dirname, '..', 'public', 'pictures');
const THUMB_MAX_DIMENSION = 240;
const THUMB_JPEG_QUALITY = 70;

// Shared by /random/thumb (badge/embedded clients) and /pictures/:phrase/thumb
// (slideshow) - each calls this with its own size/quality needs.
async function renderThumbnail(filename, { maxDimension = THUMB_MAX_DIMENSION, quality = THUMB_JPEG_QUALITY } = {}) {
    return sharp(path.join(PICTURES_DIR, filename))
        .rotate() // apply EXIF orientation before it gets stripped by re-encoding
        .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
}

module.exports = { renderThumbnail, THUMB_MAX_DIMENSION, THUMB_JPEG_QUALITY };
