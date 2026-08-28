import * as THREE from 'three';

const BORDER_RATIO = 0.045; // proportion of the shorter image dimension

// Composites a loaded <img> onto a white print-style border. A plain uniform
// border only - no corner/date-stamp marks - since the table view's bow +
// clearcoat gloss carry the "real photo" feel instead. Returns the plain
// canvas - composePhotoTexture below wraps it in a three.js texture for the
// table view (slideshowScene.js). The filmstrip view (filmstripSlideshow.js)
// doesn't use this at all - it animates the already-decoded <img> directly
// and applies its border in CSS, since dynamically creating and immediately
// animating a large 2D canvas is a known flicker trouble spot.
export function composePhotoCanvas(image) {
    const border = Math.round(Math.min(image.naturalWidth, image.naturalHeight) * BORDER_RATIO);

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth + border * 2;
    canvas.height = image.naturalHeight + border * 2;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, border, border, image.naturalWidth, image.naturalHeight);

    return { canvas, aspect: canvas.width / canvas.height };
}

// Wraps composePhotoCanvas's result in a texture ready to hand to a Photo
// mesh (the table view - see slideshowScene.js).
export function composePhotoTexture(image) {
    const { canvas, aspect } = composePhotoCanvas(image);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    return { texture, aspect };
}
