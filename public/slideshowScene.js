import * as THREE from 'three';
import { Photo } from './photo.js';

const PAN_SPEED = 1.2; // world units/sec the camera travels along -Z
// Exported so slideshow.js's scripted test scenarios can place photos the
// same "distance ahead of the camera" as a normal random drop would.
export const LOOKAHEAD_DISTANCE = 18;
const BEHIND_MARGIN = 6; // how far past the camera a resting photo must be before it's culled
const MAX_TABLE_PHOTOS = 40; // safety clamp only - normal pan/cadence keeps well under this
const LANDING_HALF_WIDTH = 12; // lateral (x) range photos can land within
const LANDING_ROTATION_RANGE = Math.PI / 6; // 30 degrees, i.e. +/-15 degrees off horizontal
const TABLE_SURFACE_Y = 0;
// Every photo rests at this same fixed height, just enough above the table
// to avoid Z-fighting against it - which photo appears "on top" where two
// overlap is resolved entirely by draw order (see PHOTO_HEIGHT's use in
// dropPhoto/Photo below), not by height. Height-based stacking (raising each
// new overlapping drop a little further above whatever it landed on) was
// tried first, but once several photos in a crowded area got clamped to the
// same safety-cap height and also overlapped each other, there was nothing
// left to separate them and their overlap flickered. Draw order has no such
// failure mode - two coplanar photos never compete for the same depth-buffer
// value in the first place.
const PHOTO_HEIGHT = TABLE_SURFACE_Y + 0.02;
const MAX_FRAME_DELTA = 0.1; // clamp so a backgrounded tab can't resume with one huge jump
const TABLE_WIDTH = 32; // wider than LANDING_HALF_WIDTH*2 so most drops land on it, not past its edge
const TABLE_LENGTH = 80;
const PLANK_WORLD_SIZE = 4; // world units covered by one tile of the wood texture

// Camera pitches down at an angle (14 up, 9 back) - it's looking partly
// *along* Z, which is also the axis it pans, so panning flies it forward
// into the look direction ("coming towards you"). near/far kept tight
// around the actual visible range (given the camera's height and pitch,
// nothing of interest is ever closer than ~14 or farther than ~25 units)
// rather than a generic 0.1-100 - depth-buffer precision is very sensitive
// to that ratio, and a needlessly wide range was leaving overlapping
// photos' borders prone to Z-fighting.
const CAMERA = { x: 0, y: 14, z: 9, near: 6, far: 35, fov: 40 };

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
        // Every drop gets the next value, so a newer photo always draws over
        // an older one it overlaps - a plain sort key, not a world-space
        // quantity, so it's safe to let this climb forever for the life of
        // the session (unlike the height-based approach it replaced).
        this.nextRenderOrder = 1; // 0 is the table's default, so photos start above it

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x141414);

        this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
        this.camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
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
        directionalLight.shadow.camera.left = -20;
        directionalLight.shadow.camera.right = 20;
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
        // Photos always come to rest within +/-15 degrees of horizontal
        // (rotationY 0), like something dropped flat rather than spun in on
        // landing - LANDING_ROTATION_RANGE below is that 30-degree spread.
        const rotationY = fixedRotationY ?? (Math.random() - 0.5) * LANDING_ROTATION_RANGE;

        const photo = new Photo({
            texture, aspect, x, z, rotationY,
            landingY: PHOTO_HEIGHT,
            renderOrder: this.nextRenderOrder++
        });
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
