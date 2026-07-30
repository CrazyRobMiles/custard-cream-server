import * as THREE from 'three';
import { Photo, getPhotoSize, SKID_OFFSET } from './photo.js';

const PAN_SPEED = 1.2; // world units/sec the camera travels along -Z
// Exported so slideshow.js's scripted test scenarios can place photos the
// same "distance ahead of the camera" as a normal random drop would.
export const LOOKAHEAD_DISTANCE = 18;
const BEHIND_MARGIN = 6; // how far past the camera a resting photo must be before it's culled
const MAX_TABLE_PHOTOS = 40; // safety clamp only - normal pan/cadence keeps well under this
const LANDING_HALF_WIDTH = 7; // lateral (x) range photos can land within
const TABLE_SURFACE_Y = 0;
// A new photo only needs to be raised above the table if it actually lands
// on top of something already there - raising every drop regardless (e.g. by
// a counter that only ever increases) makes the whole table drift upward
// over time and leaves most photos floating above the surface instead of
// resting on it. The step above whatever it's stacked on must still clear
// the bow's max displacement (+/-0.10 units) on both photos, or the two
// bowed surfaces cross through each other and Z-fight (visible as dark bands
// across the photos).
const STACK_HEIGHT_STEP = 0.3;
// A small margin added to each photo's half-extents before testing for
// overlap - covers the border's own width plus the skid's approach, so two
// photos whose bodies just clear each other but whose borders would still
// touch (or whose skid carries one slightly further than its nominal landing
// spot) are still stacked instead of left at the same height to Z-fight.
const OVERLAP_MARGIN = 0.2;
const MAX_FRAME_DELTA = 0.1; // clamp so a backgrounded tab can't resume with one huge jump
const TABLE_WIDTH = 24;
const TABLE_LENGTH = 80;
const PLANK_WORLD_SIZE = 4; // world units covered by one tile of the wood texture

// Separating Axis Theorem test for two rotated rectangles in the XZ plane -
// exact regardless of rotation, unlike a plain centre-to-centre distance
// check (which either misses corner-to-corner overlaps between two large
// rotated photos, or over-triggers for photos that are actually clear).
function rectanglesOverlap(x1, z1, rot1, halfW1, halfH1, x2, z2, rot2, halfW2, halfH2) {
    const u1 = [Math.cos(rot1), Math.sin(rot1)];
    const v1 = [-Math.sin(rot1), Math.cos(rot1)];
    const u2 = [Math.cos(rot2), Math.sin(rot2)];
    const v2 = [-Math.sin(rot2), Math.cos(rot2)];

    const tx = x2 - x1;
    const tz = z2 - z1;

    for (const axis of [u1, v1, u2, v2]) {
        const t = Math.abs(tx * axis[0] + tz * axis[1]);
        const r1 = halfW1 * Math.abs(u1[0] * axis[0] + u1[1] * axis[1])
            + halfH1 * Math.abs(v1[0] * axis[0] + v1[1] * axis[1]);
        const r2 = halfW2 * Math.abs(u2[0] * axis[0] + u2[1] * axis[1])
            + halfH2 * Math.abs(v2[0] * axis[0] + v2[1] * axis[1]);
        if (t > r1 + r2) return false; // a separating axis exists - no overlap
    }
    return true;
}

// Owns the three.js scene: a camera that continuously pans forward along an
// effectively infinite table (the table + light rig are repositioned every
// frame to stay centred under wherever the camera currently is, rather than
// modelling literally-infinite geometry), plus the currently-falling/resting
// Photo instances. Photos are never faded out - they simply scroll behind
// the camera and are disposed once safely out of the view frustum.
export class SlideshowScene {
    constructor(canvas) {
        this.photos = [];
        this.clock = new THREE.Clock();

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x141414);

        // near/far kept tight around the actual visible range (given the
        // camera's height and pitch, nothing of interest is ever closer than
        // ~14 or farther than ~25 units) rather than a generic 0.1-100 -
        // depth-buffer precision is very sensitive to that ratio, and a
        // needlessly wide range was leaving overlapping photos' borders
        // prone to Z-fighting.
        this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 6, 35);
        this.camera.position.set(0, 14, 9);
        this.camera.lookAt(0, 0, 0);
        // From here on the camera only ever translates along Z - never
        // rotated again - so this initial look angle is preserved forever
        // as the camera and its "ahead" table/lighting move together.

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this._buildTable();
        this._buildLighting();

        this._handleResize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this._handleResize);
        this._handleResize();

        this.renderer.setAnimationLoop((time) => this._onFrame(time));
    }

    _buildTable() {
        const texture = this._createWoodTexture();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(TABLE_WIDTH / PLANK_WORLD_SIZE, TABLE_LENGTH / PLANK_WORLD_SIZE);
        this.tableTexture = texture;

        const geometry = new THREE.PlaneGeometry(TABLE_WIDTH, TABLE_LENGTH);
        const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
        this.table = new THREE.Mesh(geometry, material);
        this.table.rotation.x = -Math.PI / 2;
        this.table.position.y = TABLE_SURFACE_Y;
        this.table.receiveShadow = true;
        this.scene.add(this.table);
    }

    // A small procedural wood-plank tile (no external asset needed), tiled
    // via RepeatWrapping across the table.
    _createWoodTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#d8cba8';
        ctx.fillRect(0, 0, size, size);

        const plankCount = 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 2;
        for (let i = 0; i <= plankCount; i++) {
            const x = (i / plankCount) * size;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, size);
            ctx.stroke();
        }

        for (let i = 0; i < 40; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const length = 20 + Math.random() * 60;
            const shade = 20 + Math.random() * 40;
            ctx.strokeStyle = `rgba(${150 + shade}, ${125 + shade * 0.6}, ${85 + shade * 0.3}, 0.2)`;
            ctx.lineWidth = 1 + Math.random() * 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (Math.random() - 0.5) * 6, y + length);
            ctx.stroke();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    _buildLighting() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

        // Grouped so both the light and its target move with the camera
        // every frame - the table always looks identically lit no matter
        // how far along it the camera has travelled.
        this.lightRig = new THREE.Group();
        this.scene.add(this.lightRig);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(3, 20, 6);
        directionalLight.target.position.set(0, 0, -10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.set(1024, 1024);
        directionalLight.shadow.bias = -0.0015;
        directionalLight.shadow.normalBias = 0.02;
        directionalLight.shadow.camera.left = -16;
        directionalLight.shadow.camera.right = 16;
        directionalLight.shadow.camera.top = 24;
        directionalLight.shadow.camera.bottom = -24;
        directionalLight.shadow.camera.near = 1;
        directionalLight.shadow.camera.far = 50;

        this.lightRig.add(directionalLight, directionalLight.target);
    }

    // x/z/rotationY are optional overrides for scripted test scenarios
    // (see slideshow.js's ?scenario= handling) - normal random drops omit
    // them and get the usual random placement.
    dropPhoto({ texture, aspect, x: fixedX, z: fixedZ, rotationY: fixedRotationY }) {
        if (this.photos.length >= MAX_TABLE_PHOTOS) return;

        const x = fixedX ?? (Math.random() * 2 - 1) * LANDING_HALF_WIDTH;
        const z = fixedZ ?? this.camera.position.z - LOOKAHEAD_DISTANCE;
        const rotationY = fixedRotationY ?? Math.random() * Math.PI * 2;
        // Always positive: the bow's edges sit exactly at landingY and the
        // curve only ever bulges upward from there (never below) - a
        // negative amplitude would dip the photo's centre below landingY,
        // sinking it into the table (or whatever it's resting on).
        const bowAmplitude = 0.04 + Math.random() * 0.06;
        const bowAxisMix = Math.random();

        const { width, height } = getPhotoSize(aspect);
        // The skid can carry the photo up to SKID_OFFSET/2 further from its
        // nominal landing spot in either X or Z, so pad this photo's own
        // half-extents to cover the full area its body might actually pass
        // through, not just where it ends up at rest.
        const halfWidth = width / 2 + SKID_OFFSET / 2 + OVERLAP_MARGIN;
        const halfHeight = height / 2 + SKID_OFFSET / 2 + OVERLAP_MARGIN;

        // Flush with the table by default; only raised above it for photos
        // it actually overlaps - a real oriented-rectangle test (not just
        // centre-to-centre distance), since two large photos can overlap at
        // their corners well past any single "too close" radius once
        // rotation is taken into account. Not tied to a global,
        // ever-increasing counter.
        let landingY = TABLE_SURFACE_Y;
        for (const other of this.photos) {
            if (rectanglesOverlap(
                x, z, rotationY, halfWidth, halfHeight,
                other.finalX, other.finalZ, other.finalRotationY,
                other.halfWidth + OVERLAP_MARGIN, other.halfHeight + OVERLAP_MARGIN
            )) {
                landingY = Math.max(landingY, other.landingY + STACK_HEIGHT_STEP);
            }
        }

        const photo = new Photo({ texture, aspect, x, z, landingY, rotationY, bowAmplitude, bowAxisMix });
        this.scene.add(photo.mesh);
        this.photos.push(photo);
    }

    _onFrame() {
        const delta = Math.min(this.clock.getDelta(), MAX_FRAME_DELTA);
        const stepZ = PAN_SPEED * delta;

        this.camera.position.z -= stepZ;
        this.table.position.z = this.camera.position.z;
        this.lightRig.position.z = this.camera.position.z;

        // The table mesh is recentred on the camera every frame above (so it
        // never runs out), which would otherwise drag the wood grain along
        // with it and make the floor look like it's not moving at all -
        // nudging the texture offset by the same distance cancels that out,
        // so the grain reads as a fixed pattern the camera pans over. The
        // sign here matches PlaneGeometry's UV convention (v=0 at local
        // y=-height/2, v=1 at y=+height/2) - getting it backwards doesn't
        // just fail to cancel the recentring, it doubles up the drift in the
        // wrong direction, which is what made the floor and the (correctly
        // world-fixed) photos appear to move opposite ways.
        this.tableTexture.offset.y += stepZ / PLANK_WORLD_SIZE;

        for (const photo of this.photos) {
            photo.update(delta);
        }

        // The camera looks toward -Z, so a resting photo is behind it once
        // its z has fallen far enough below the camera's current z.
        this.photos = this.photos.filter((photo) => {
            const isBehind = photo.isResting() && (photo.position.z - this.camera.position.z) > BEHIND_MARGIN;
            if (isBehind) {
                photo.dispose(this.scene);
                return false;
            }
            return true;
        });

        this.renderer.render(this.scene, this.camera);
    }
}
