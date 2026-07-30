import * as THREE from 'three';

const BORDER_RATIO = 0.045; // proportion of the shorter image dimension

// Composites a loaded <img> onto a white print-style border and wraps the
// result in a texture ready to hand to a Photo mesh. A plain uniform border
// only - no corner/date-stamp marks - since the bow + clearcoat gloss on the
// mesh itself carry the "real photo" feel.
export function composePhotoTexture(image) {
    const border = Math.round(Math.min(image.naturalWidth, image.naturalHeight) * BORDER_RATIO);

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth + border * 2;
    canvas.height = image.naturalHeight + border * 2;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, border, border, image.naturalWidth, image.naturalHeight);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    return { texture, aspect: canvas.width / canvas.height };
}
