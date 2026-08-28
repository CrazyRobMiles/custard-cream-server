import { SlideshowScene, LOOKAHEAD_DISTANCE } from './slideshowScene.js';
import { FilmstripSlideshow } from './filmstripSlideshow.js';
import { composePhotoTexture } from './photoCompositor.js';

const QUEUE_LOW_WATERMARK = 4;
const BATCH_FETCH_COUNT = 10;
const DROP_INTERVAL_MIN_MS = 2000;
const DROP_INTERVAL_MAX_MS = 3000;

const params = new URLSearchParams(window.location.search);
const tags = params.get('tags') || '';
const scenario = params.get('scenario') || '';
const mode = params.get('mode') || 'top';

const canvasEl = document.getElementById('slideshowCanvas');
const filmstripCanvasEl = document.getElementById('filmstripCanvas');

let scene;
if (mode === 'horizontal') {
    canvasEl.style.display = 'none';
    scene = new FilmstripSlideshow(filmstripCanvasEl);
} else {
    filmstripCanvasEl.style.display = 'none';
    scene = new SlideshowScene(canvasEl);
}

let photoQueue = [];
let fetchingBatch = false;

function batchUrl(count) {
    const params = new URLSearchParams({ count: String(count) });
    if (tags) params.set('tags', tags);
    return `/random/batch?${params.toString()}`;
}

async function topUpQueue() {
    if (fetchingBatch || photoQueue.length >= QUEUE_LOW_WATERMARK) return;

    fetchingBatch = true;
    try {
        const response = await fetch(batchUrl(BATCH_FETCH_COUNT));
        const data = await response.json();
        photoQueue.push(...data.pictures);
    } catch (err) {
        console.log('Failed to fetch random pictures:', err.message);
    } finally {
        fetchingBatch = false;
    }
}

// The table view shows photos at a modest on-screen size, so the server's
// default thumbnail size suits it fine - but the horizontal filmstrip fills
// the entire screen height with each photo, so it asks for a size matching
// that (capped/clamped server-side regardless - see pages/pictures.js).
function thumbUrl(phrase) {
    const base = `/pictures/${encodeURIComponent(phrase)}/thumb`;
    if (mode !== 'horizontal') return base;

    const size = Math.round(window.innerHeight * Math.min(window.devicePixelRatio || 1, 2));
    return `${base}?size=${size}`;
}

async function loadImage(url) {
    const image = new Image();
    image.src = url;
    // decode() guarantees the image is fully decoded (naturalWidth/Height
    // populated) before it's used - unlike the 'load' event, which can fire
    // a moment before decoding actually finishes and leave a 0-size image.
    await image.decode();
    return image;
}

async function dropNext() {
    topUpQueue();

    const picture = photoQueue.shift();
    if (!picture) return; // idle - nothing to show yet, try again next cycle

    try {
        const image = await loadImage(thumbUrl(picture.phrase));
        if (mode === 'horizontal') {
            scene.dropPhoto({ image, aspect: image.naturalWidth / image.naturalHeight });
        } else {
            scene.dropPhoto(composePhotoTexture(image));
        }
    } catch (err) {
        console.log('Skipping a drop:', err.message);
    }
}

// requestAnimationFrame (driving the camera pan and each photo's own
// fall/settle animation) already freezes automatically while the tab is
// hidden, but this setTimeout-based cadence doesn't - browsers still fire
// background timers (just throttled to roughly once a second), so drops
// silently kept accumulating while the page was hidden and then all
// appeared at once, still-falling, the moment the tab regained focus.
// Tracking the pending timer and gating on document.hidden stops new drops
// from being scheduled at all while hidden, and picks the cadence back up
// fresh once the tab is visible again.
let dropTimer = null;

function scheduleNextDrop() {
    if (document.hidden) return;

    const delay = DROP_INTERVAL_MIN_MS + Math.random() * (DROP_INTERVAL_MAX_MS - DROP_INTERVAL_MIN_MS);
    dropTimer = setTimeout(async () => {
        dropTimer = null;
        await dropNext();
        scheduleNextDrop();
    }, delay);
}

// Scripted overlap-test scenarios, reproducible on demand via e.g.
// /slideshow/view?scenario=overlap instead of waiting for a specific overlap
// pattern to come up naturally in the random feed. x/z are offsets from the
// same "distance ahead of the camera" a normal drop lands at, so the whole
// scenario appears in a predictable, comfortable spot on load.
const SCENARIOS = {
    overlap: [
        // Corner-graze: centres 3.6 apart - farther apart than photos would
        // ever have been stacked under the old plain centre-distance check,
        // but rotated 45 degrees so their corners genuinely overlap.
        { x: -8, z: 0, rotationY: Math.PI / 4, delayMs: 500 },
        { x: -4.4, z: 0, rotationY: Math.PI / 4, delayMs: 1800 },

        // Large deliberate overlap - watch the second photo's skid carry it
        // in over the first as it settles.
        { x: 0, z: 0, rotationY: 0, delayMs: 3400 },
        { x: 0.8, z: 0.3, rotationY: 0.35, delayMs: 5200 },

        // Direct stack: three photos landing at almost the same spot.
        { x: 6, z: 0, rotationY: 0, delayMs: 7000 },
        { x: 6.2, z: 0.1, rotationY: 0.5, delayMs: 8400 },
        { x: 5.9, z: -0.1, rotationY: 1.0, delayMs: 9800 }
    ]
};

async function runScenario(name) {
    const steps = SCENARIOS[name];
    if (!steps) {
        console.log(`Unknown scenario "${name}" - known scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
        return;
    }

    const response = await fetch(batchUrl(steps.length));
    const data = await response.json();
    if (data.pictures.length === 0) {
        console.log('No pictures available to run the scenario.');
        return;
    }

    const anchorZ = scene.camera.position.z - LOOKAHEAD_DISTANCE;

    steps.forEach((step, i) => {
        setTimeout(async () => {
            const picture = data.pictures[i % data.pictures.length];
            try {
                const image = await loadImage(`/pictures/${encodeURIComponent(picture.phrase)}/thumb`);
                const { texture, aspect } = composePhotoTexture(image);
                scene.dropPhoto({ texture, aspect, x: step.x, z: anchorZ + step.z, rotationY: step.rotationY });
            } catch (err) {
                console.log('Scenario step failed:', err.message);
            }
        }, step.delayMs);
    });
}

if (scenario) {
    runScenario(scenario);
} else {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearTimeout(dropTimer);
            dropTimer = null;
        } else if (!dropTimer) {
            scheduleNextDrop();
        }
    });

    topUpQueue();
    scheduleNextDrop();
}
