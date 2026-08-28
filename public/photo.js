import * as THREE from 'three';

const BASE_SIZE = 8.0; // world units, longest edge
const FALL_DURATION = 1.0;
const SETTLE_DURATION = 0.5;
const SPAWN_HEIGHT_ABOVE_LANDING = 8;
const TUMBLE_AMPLITUDE = Math.PI * 0.6; // max initial angle a photo can be dropped in at, relative to where it lands
const TUMBLE_FREQ = 10; // rad/s the drop-angle oscillates at while it decays
const SKID_OFFSET = 0.6;

// A photo dropped at an angle spins that angle down like a damped
// oscillator: envelope(t) = dropAngle * e^(-ANGULAR_DAMPING * t), so its
// angular velocity at release is ANGULAR_DAMPING * dropAngle (steeper drop
// angle -> faster initial spin) and decays at that same fixed rate. Choosing
// ANGULAR_DAMPING from FALL_DURATION - rather than picking it arbitrarily -
// means whatever angle a photo happens to be dropped at, the envelope has
// always decayed to ANGULAR_SETTLE_FRACTION of it (visually negligible) by
// the time FALLING hands off to SETTLING, so every photo reads as settled
// to its resting angle by then regardless of how far off it started.
const ANGULAR_SETTLE_FRACTION = 0.02;
const ANGULAR_DAMPING = -Math.log(ANGULAR_SETTLE_FRACTION) / FALL_DURATION;

const STATE = { FALLING: 'falling', SETTLING: 'settling', RESTING: 'resting' };

// The camera's field of view is fixed vertically, so a narrow (portrait)
// viewport shows much less of the table horizontally than a wide one - a
// fixed BASE_SIZE that looks right on a landscape desktop window ends up
// crowding a portrait phone screen. Scaling down for narrower viewports
// keeps photos occupying a comparable fraction of the visible width
// regardless of orientation. REFERENCE_ASPECT is "desktop landscape", the
// aspect BASE_SIZE was tuned against; MIN_SIZE_SCALE stops very narrow
// phones shrinking photos down to illegibility.
const REFERENCE_ASPECT = 16 / 9;
const MIN_SIZE_SCALE = 0.55;

function getSizeScale() {
    const viewportAspect = window.innerWidth / window.innerHeight;
    return Math.min(1, Math.max(MIN_SIZE_SCALE, viewportAspect / REFERENCE_ASPECT));
}

// Reads the current viewport each call (rather than caching) so it stays
// correct across resizes/orientation changes - each newly dropped photo
// picks up whatever scale is current at that moment; photos already on the
// table keep whatever size they landed at.
export function getPhotoSize(aspect) {
    const scale = getSizeScale();
    const width = (aspect >= 1 ? BASE_SIZE : BASE_SIZE * aspect) * scale;
    const height = (aspect >= 1 ? BASE_SIZE / aspect : BASE_SIZE) * scale;
    return { width, height };
}

// A single flat photo on the table: a plain plane with a glossy
// MeshPhysicalMaterial (clearcoat gives the print-like highlight for free -
// no hand-written lighting shader needed), animated through a drop -> slide
// -> rest state machine. Photos used to bow slightly, but a lower photo's
// curve could poke through a less-curved one stacked above it - especially
// once several photos land at the same clamped stack height (see
// slideshowScene.js) and also overlap each other, with nothing left to keep
// one curve fully above another. Flat photos can't have that problem, and
// losing the curve isn't a big loss visually.
//
// Which overlapping photo appears "on top" is resolved by draw order
// (renderOrder + depth test/write disabled below), not by height - every
// photo rests at the same fixed height (see PHOTO_HEIGHT in
// slideshowScene.js). Height-based stacking was tried first, but two
// photos both resting at the same (safety-capped) height that also
// overlapped each other had nothing left to separate them and their
// overlap flickered - an inherent risk of resolving overlap via the
// depth buffer at all. Draw order has no such failure mode: renderOrder
// fully decides paint order, so two coplanar photos never compete for the
// same depth-buffer value in the first place.
export class Photo {
    constructor({ texture, aspect, x, z, landingY, rotationY, renderOrder }) {
        this.finalX = x;
        this.finalZ = z;
        this.landingY = landingY;
        this.finalRotationY = rotationY;

        const { width, height } = getPhotoSize(aspect);

        // Built lying flat (normal +Y) by baking the rotation into the
        // geometry itself, so the mesh's own .rotation stays single-axis
        // (yaw only) with no Euler-order surprises.
        const geometry = new THREE.PlaneGeometry(width, height);
        geometry.rotateX(-Math.PI / 2);

        // FrontSide (the default) - the photo only ever yaws around its
        // vertical axis while lying flat, so its back is never actually
        // visible. depthTest/depthWrite are off because layering between
        // photos is handled entirely by renderOrder (see class comment).
        const material = new THREE.MeshPhysicalMaterial({
            map: texture,
            roughness: 0.35,
            metalness: 0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.15,
            depthTest: false,
            depthWrite: false
        });

        this.geometry = geometry;
        this.material = material;
        this.texture = texture;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.renderOrder = renderOrder;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        this.state = STATE.FALLING;
        this.elapsed = 0;
        // The photo falls in already at a slightly skidded position, then
        // SETTLING eases it into its true final spot - this is what reads
        // as "sliding across" whatever's already on the table.
        this.skidStartX = x + (Math.random() - 0.5) * SKID_OFFSET;
        this.skidStartZ = z + (Math.random() - 0.5) * SKID_OFFSET;
        // The angle this photo is dropped in at, relative to finalRotationY -
        // see ANGULAR_DAMPING above for how this decays back to 0.
        this.dropAngle = (Math.random() - 0.5) * TUMBLE_AMPLITUDE;

        this.mesh.position.set(this.skidStartX, landingY + SPAWN_HEIGHT_ABOVE_LANDING, this.skidStartZ);
        this.mesh.rotation.y = rotationY + this.dropAngle;
    }

    get position() {
        return this.mesh.position;
    }

    isResting() {
        return this.state === STATE.RESTING;
    }

    update(delta) {
        if (this.state === STATE.RESTING) return;

        this.elapsed += delta;

        if (this.state === STATE.FALLING) {
            const t = Math.min(this.elapsed / FALL_DURATION, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            this.mesh.position.y = THREE.MathUtils.lerp(this.landingY + SPAWN_HEIGHT_ABOVE_LANDING, this.landingY, eased);

            const envelope = this.dropAngle * Math.exp(-ANGULAR_DAMPING * this.elapsed);
            this.mesh.rotation.y = this.finalRotationY + envelope * Math.cos(this.elapsed * TUMBLE_FREQ);

            if (t >= 1) {
                this.state = STATE.SETTLING;
                this.elapsed = 0;
            }
            return;
        }

        // SETTLING: a smooth slide from the skid position into the final
        // resting spot. smoothstep (3t^2-2t^3) has zero velocity at *both*
        // t=0 and t=1, matching the zero velocity FALLING already eased down
        // to - any oscillating bounce/wobble here (tried previously) starts
        // at nonzero velocity from a standing start, which is exactly what
        // read as a twitch right as the photo landed. Y and rotation are
        // already at their final values by the end of FALLING, so only X/Z
        // need to move here.
        const t = Math.min(this.elapsed / SETTLE_DURATION, 1);
        const eased = t * t * (3 - 2 * t);

        this.mesh.position.x = THREE.MathUtils.lerp(this.skidStartX, this.finalX, eased);
        this.mesh.position.z = THREE.MathUtils.lerp(this.skidStartZ, this.finalZ, eased);

        if (t >= 1) {
            this.state = STATE.RESTING;
            this.mesh.position.set(this.finalX, this.landingY, this.finalZ);
            this.mesh.rotation.y = this.finalRotationY;
        }
    }

    dispose(scene) {
        scene.remove(this.mesh);
        this.geometry.dispose();
        this.texture.dispose();
        this.material.dispose();
    }
}
