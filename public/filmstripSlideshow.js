import * as THREE from 'three';

const SCROLL_SPEED = 200; // px/sec the whole filmstrip scrolls left at

// Drives a full-height, edge-to-edge horizontal filmstrip: photos are laid
// out left-to-right in the order they arrive, each exactly as tall as the
// viewport with its own width set by its aspect ratio, touching the next
// with no gap - then the whole strip scrolls left at a constant speed, like
// a single continuous reel rather than separate photos entering and exiting
// independently. No border, no drop shadow, no backdrop - just the photos
// themselves, laid out and scrolled.
//
// Rendered through WebGL (an orthographic three.js scene - one world unit
// per screen pixel, so layout/positioning math is plain pixel arithmetic)
// rather than DOM/CSS, matching the table view (slideshowScene.js): a
// single persistent canvas, redrawn as one atomic GPU draw call every frame
// via renderer.setAnimationLoop. An earlier DOM version (freshly created
// elements repositioned via CSS transform, one per photo, appended/removed
// from the page) kept flickering on desktop; a later WebGL version fixed
// that but still used per-photo transparency (a semi-transparent drop
// shadow plane) for polish, which is itself a plausible source of
// GPU-driver-dependent blending flicker - opaque-only geometry here removes
// that too.
export class FilmstripSlideshow {
    constructor(canvas) {
        this.active = []; // { mesh, geometry, material, texture, left, right } in chain (unscrolled) coordinates, left-to-right order
        this.nextLeft = 0; // chain-coordinate x where the next photo's left edge goes
        this.scrollOffset = 0; // px scrolled so far

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x141414);

        // left/right/top/bottom are set for real in _resize() below, once
        // the viewport size is known.
        this.camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 100);
        this.camera.position.z = 10;

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this._handleResize = () => this._resize();
        window.addEventListener('resize', this._handleResize);
        this._resize();

        this._clock = new THREE.Clock();
        this.renderer.setAnimationLoop(() => this._onFrame());
    }

    _resize() {
        this.vw = window.innerWidth;
        this.vh = window.innerHeight;

        // World space matches screen pixels 1:1, origin at the viewport
        // centre.
        this.camera.left = -this.vw / 2;
        this.camera.right = this.vw / 2;
        this.camera.top = this.vh / 2;
        this.camera.bottom = -this.vh / 2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(this.vw, this.vh);
    }

    // image: the already-loaded/decoded <img> element from slideshow.js's
    // loadImage() - used directly as the texture source, no compositing.
    dropPhoto({ image, aspect }) {
        const height = this.vh;
        const width = height * aspect;

        const texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;

        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);

        const left = this.nextLeft;
        const right = left + width;
        this.nextLeft = right;

        this.active.push({ mesh, geometry, material, texture, left, right });
    }

    _onFrame() {
        const delta = this._clock.getDelta();
        this.scrollOffset += SCROLL_SPEED * delta;

        // Chain-x 0 (the very first photo's left edge) starts flush with
        // the viewport's right edge (+vw/2 in camera-space) and moves left
        // as scrollOffset grows - so a photo's on-screen centre is its own
        // chain-space centre, shifted by that same amount.
        for (const photo of this.active) {
            photo.mesh.position.x = (photo.left + photo.right) / 2 - this.scrollOffset + this.vw / 2;
        }

        this.active = this.active.filter((photo) => {
            const screenRight = photo.right - this.scrollOffset + this.vw / 2;
            if (screenRight > -this.vw / 2) return true; // still at least partly on screen
            this._disposePhoto(photo);
            return false;
        });

        this.renderer.render(this.scene, this.camera);
    }

    _disposePhoto(photo) {
        this.scene.remove(photo.mesh);
        photo.geometry.dispose();
        photo.material.dispose();
        photo.texture.dispose();
    }
}
