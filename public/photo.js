import * as THREE from 'three';

const BASE_SIZE = 8.0; // world units, longest edge
const GEOMETRY_SEGMENTS = 16;
const FALL_DURATION = 1.0;
const SETTLE_DURATION = 0.5;
const SPAWN_HEIGHT_ABOVE_LANDING = 8;
const TUMBLE_AMPLITUDE = Math.PI * 0.6;
const TUMBLE_FREQ = 10;
// Exported so SlideshowScene's overlap check can allow for how far a photo's
// skid can actually carry it from its nominal landing spot.
export const SKID_OFFSET = 0.6;

const STATE = { FALLING: 'falling', SETTLING: 'settling', RESTING: 'resting' };

let nextMaterialId = 0;

// Shared with SlideshowScene's overlap check, so both agree exactly on how
// big a photo of a given aspect ratio actually is.
export function getPhotoSize(aspect) {
    const width = aspect >= 1 ? BASE_SIZE : BASE_SIZE * aspect;
    const height = aspect >= 1 ? BASE_SIZE / aspect : BASE_SIZE;
    return { width, height };
}

// A single photo on the table: a subdivided plane, bowed slightly via a
// vertex-shader displacement injected into a MeshPhysicalMaterial (clearcoat
// gives the glossy print finish for free - no hand-written lighting shader
// needed), animated through a drop -> bounce -> rest state machine.
export class Photo {
    constructor({ texture, aspect, x, z, landingY, rotationY, bowAmplitude, bowAxisMix }) {
        this.finalX = x;
        this.finalZ = z;
        this.landingY = landingY;
        this.finalRotationY = rotationY;
        this.bowAmplitude = bowAmplitude;
        this.bowAxisMix = bowAxisMix;

        const { width, height } = getPhotoSize(aspect);
        this.halfWidth = width / 2;
        this.halfHeight = height / 2;

        // Built lying flat (normal +Y) by baking the rotation into the
        // geometry itself, so the mesh's own .rotation stays single-axis
        // (yaw only) with no Euler-order surprises.
        const geometry = new THREE.PlaneGeometry(width, height, GEOMETRY_SEGMENTS, GEOMETRY_SEGMENTS);
        geometry.rotateX(-Math.PI / 2);

        // FrontSide (the default) - the photo only ever yaws around its
        // vertical axis while lying flat, so its back is never actually
        // visible. DoubleSide was a leftover from an earlier tumble design;
        // keeping it risked the bow displacement flipping a few triangles'
        // winding at grazing angles and rendering a mirrored back-face patch,
        // which showed up as misaligned borders where photos overlapped.
        const material = new THREE.MeshPhysicalMaterial({
            map: texture,
            roughness: 0.35,
            metalness: 0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.15
        });

        // MeshPhysicalMaterial's default program cache key only reflects
        // flags like "has a map" / "has clearcoat", so every Photo would
        // otherwise collide onto one shared compiled program - and with a
        // shared program, onBeforeCompile (and the per-material map/uniform
        // setup it does) only actually runs for the first material that
        // triggers the compile, leaving every other Photo's own texture
        // unbound (rendered as flat grey) or its bow uniforms stale. Giving
        // each Photo its own cache key forces its own compile, at the cost
        // of one small, cheap shader compile per drop - never a concern at
        // this scale (well under a hundred concurrent photos).
        const materialId = nextMaterialId++;
        material.customProgramCacheKey = () => `photo-${materialId}`;

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uBowAmplitude = { value: this.bowAmplitude };
            shader.uniforms.uAxisMix = { value: this.bowAxisMix };
            // onBeforeCompile only adds these to the JS-side uniforms object -
            // the GLSL source still needs its own `uniform` declarations, so
            // they're prepended here rather than relying on any built-in chunk.
            shader.vertexShader = 'uniform float uBowAmplitude;\nuniform float uAxisMix;\n' + shader.vertexShader
                .replace('#include <begin_vertex>', `
                    #include <begin_vertex>
                    float bowCoord = mix(uv.x, uv.y, uAxisMix) * 2.0 - 1.0;
                    transformed.y += uBowAmplitude * (1.0 - bowCoord * bowCoord);
                `)
                .replace('#include <beginnormal_vertex>', `
                    #include <beginnormal_vertex>
                    float bowCoordN = mix(uv.x, uv.y, uAxisMix) * 2.0 - 1.0;
                    float bowSlope = -2.0 * uBowAmplitude * bowCoordN;
                    objectNormal = normalize(objectNormal + vec3(mix(bowSlope, 0.0, uAxisMix), 0.0, mix(0.0, bowSlope, uAxisMix)));
                `);
        };

        // Shadow maps are rendered with an auto-generated MeshDepthMaterial
        // that knows nothing about the bow displacement above - without a
        // matching custom depth material, the recorded shadow depth doesn't
        // match the actual bowed surface, and the photo self-shadows into a
        // solid black band. Re-applying the same position displacement here
        // (normal isn't needed for a depth pass) keeps the two in sync.
        const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        depthMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uBowAmplitude = { value: this.bowAmplitude };
            shader.uniforms.uAxisMix = { value: this.bowAxisMix };
            shader.vertexShader = 'uniform float uBowAmplitude;\nuniform float uAxisMix;\n' + shader.vertexShader
                .replace('#include <begin_vertex>', `
                    #include <begin_vertex>
                    float bowCoord = mix(uv.x, uv.y, uAxisMix) * 2.0 - 1.0;
                    transformed.y += uBowAmplitude * (1.0 - bowCoord * bowCoord);
                `);
        };
        depthMaterial.customProgramCacheKey = () => `photo-depth-${materialId}`;

        this.geometry = geometry;
        this.material = material;
        this.depthMaterial = depthMaterial;
        this.texture = texture;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.customDepthMaterial = depthMaterial;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        this.state = STATE.FALLING;
        this.elapsed = 0;
        // The photo falls in already at a slightly skidded position, then
        // SETTLING eases it into its true final spot - this is what reads
        // as "sliding across" whatever's already on the table.
        this.skidStartX = x + (Math.random() - 0.5) * SKID_OFFSET;
        this.skidStartZ = z + (Math.random() - 0.5) * SKID_OFFSET;
        this.tumbleSeed = Math.random() * Math.PI * 2;

        this.mesh.position.set(this.skidStartX, landingY + SPAWN_HEIGHT_ABOVE_LANDING, this.skidStartZ);
        this.mesh.rotation.y = rotationY + (Math.random() - 0.5) * TUMBLE_AMPLITUDE;
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

            const tumbleDecay = 1 - eased;
            this.mesh.rotation.y = this.finalRotationY
                + Math.sin(this.elapsed * TUMBLE_FREQ + this.tumbleSeed) * (TUMBLE_AMPLITUDE * 0.5) * tumbleDecay;

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
        this.depthMaterial.dispose();
    }
}
