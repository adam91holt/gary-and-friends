/**
 * The arcade shell. The rendering side of the seam, and nothing else.
 *
 * It owns only COMMON SERVICES — the renderer and its pipeline, the camera, the
 * store, the runtime registry, audio, per-game high scores, input normalisation,
 * the HUD shell, resize handling and the frame loop — and it knows nothing about
 * any particular game. Every game-shaped decision (what to draw, what a swipe
 * means, where the camera should be, what the second instrument counts) belongs
 * to an `ArcadeGameRuntime` in `src/arcade/games/`.
 *
 * That is what lets four games coexist: a sibling adds a runtime file and fills
 * its pre-reserved catalog entry, and this file does not change.
 */
// Self-hosted variable display face. Bundled by Vite (no network/CDN at runtime)
// so the type scale in index.html renders in its intended voice rather than
// silently falling back to the system stack.
import '@fontsource-variable/space-grotesk/wght.css';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Fog,
  HemisphereLight,
  MathUtils,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { GameAudio } from './audio.ts';
import { HighwayRuntime } from './arcade/games/highway.ts';
import { createConeballRuntime } from './arcade/games/coneball.ts';
import { createRoyalRollRuntime } from './arcade/games/royalRoll.ts';
import { createTowerRuntime } from './arcade/games/tower.ts';
import { RuntimeRegistry } from './arcade/runtime.ts';
import { gameEntry } from './game/arcade/catalog.ts';
import {
  GAME_IDS,
  type ArcadeAction,
  type GameId,
} from './game/arcade/contracts.ts';
import {
  actionForKey,
  actionForSwipe,
  actionForTap,
  isTapTravel,
  routeAction,
} from './game/arcade/input.ts';
import {
  loadAllHighScores,
  submitGameHighScore,
  type StoragePort,
} from './game/highScore.ts';
import { GameStore } from './game/state.ts';
import { createPipeline } from './render/pipeline.ts';
import { detectQuality, qualitySettings, readDeviceProfile } from './render/quality.ts';
import { installTestApi, type GaryTestHooks } from './testApi.ts';
import { BG } from './theme.ts';
import { Hud } from './ui/hud.ts';

const store = new GameStore();
const audio = new GameAudio();

/**
 * The storage adapter for the persisted bests. This is the ONLY place in the app
 * that touches `localStorage` — `game/highScore.ts` holds the rules and takes
 * this port, so the whole comparison/parse layer stays unit-testable in node.
 * Access is probed once, because a browser with storage disabled throws on the
 * *property read*, not just on use.
 */
const storage: StoragePort | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

/** Every game's best. Presentation state, mirrored onto the HUD and test API. */
const highScores = loadAllHighScores(storage, GAME_IDS);
/** Latch so the mid-run record fanfare fires once per run, not once per frame. */
let recordAnnounced = false;

/** The selected game's best — the number the legacy `highScore` field returns. */
function selectedBest(): number {
  return highScores[store.getState().selectedGame];
}

// Honour the OS reduced-motion preference in the 3D layer too, not just CSS:
// camera sweeps snap instead of easing, and idle animation is stilled.
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (e) => {
  reducedMotion = e.matches;
});

// `ready` flips true after the first rendered frame. Tests wait on this.
let hasRenderedFrame = false;

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const scene = new Scene();
scene.fog = new Fog(BG, 20, 92);

const camera = new PerspectiveCamera(
  58,
  window.innerWidth / window.innerHeight,
  0.1,
  400,
);

// Quality is decided once from the device, because `antialias` is fixed at
// context creation and cannot be changed later.
const quality = qualitySettings(detectQuality(readDeviceProfile()));

const renderer = new WebGLRenderer({ antialias: quality.antialias });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(BG, 1);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

/** Every frame goes through the pipeline, never through the renderer directly,
 *  so post-processing can land later without touching shell logic. */
const pipeline = createPipeline(renderer, quality);

// The only lighting the shell owns: a neutral cool fill every game inherits.
// Anything characterful (a warm key, a hero light) belongs to a runtime.
scene.add(new HemisphereLight(0x5566aa, 0x0a0a12, 0.7));
scene.add(new AmbientLight(0xffffff, 0.25));

// ── The cabinet ─────────────────────────────────────────────────────────────

const registry = new RuntimeRegistry(scene);

const highway = new HighwayRuntime({
  store,
  audio,
  telemetry: {
    pulse: () => hud.pulse(),
    collected: (pickup) => hud.collected(pickup),
  },
});
registry.register(highway);
registry.register(createTowerRuntime());
registry.register(createConeballRuntime({ store, audio }));
registry.register(createRoyalRollRuntime());

/** The runtime currently on screen. Never null after the boot activation. */
function active() {
  const runtime = registry.current;
  if (!runtime) throw new Error('No active runtime');
  return runtime;
}

// ── Store reactions the shell owns ──────────────────────────────────────────
// Registered BEFORE the HUD subscribes, and that order is load-bearing:
// listeners fire in subscription order, so the record has to be banked and
// handed to the HUD before the HUD renders the game-over card — otherwise the
// card would headline "Wrecked!" on the very run that set a new best.

let previousStatus = store.getState().status;
store.subscribe((state) => {
  if (state.status === previousStatus) return;
  if (state.status === 'playing') recordAnnounced = false;
  if (state.status === 'gameover') {
    // Bank the run against THIS game's record. `submitGameHighScore` writes
    // only on a genuine improvement, and only under that game's own key.
    const result = submitGameHighScore(
      storage,
      state.selectedGame,
      state.score,
      highScores[state.selectedGame],
    );
    highScores[state.selectedGame] = result.best;
    hud.setHighScore(result.best, result.isNew);
    hud.setHighScores(highScores);
    if (result.isNew && !recordAnnounced) audio.highScore();
  }
  previousStatus = state.status;
});

// ── The HUD shell ───────────────────────────────────────────────────────────

const hud = new Hud(store, {
  onUserGesture: () => audio.unlock(),
  onToggleSound: () => {
    const muted = audio.toggleMute();
    if (!muted) audio.lane(); // audible confirmation that sound is back
    return muted;
  },
  // Highlighting a card swings the live 3D behind the panel to that game, which
  // is the whole idea of the select screen: you are choosing a running cabinet,
  // not browsing a catalogue.
  onSelectGame: (id) => selectGame(id),
  onLaunch: (id) => launch(id),
  onBackToMenu: () => store.returnToMenu(),
});
hud.setHighScores(highScores);
hud.setHighScore(selectedBest());
hud.setMuted(audio.muted);

/** Point the cabinet at a game: store first, then the scene follows it. */
function selectGame(id: GameId): void {
  store.selectGame(id);
  if (store.getState().selectedGame !== id) return; // refused (not on the menu)
  registry.activate(id);
  hud.setHighScore(highScores[id]);
}

/**
 * Open a game from the menu. A slot that isn't built yet is selected and shown
 * — the player still gets to look at it — but never started, because there is
 * no run to have.
 */
function launch(id: GameId): void {
  selectGame(id);
  if (!gameEntry(id).playable) return;
  audio.unlock();
  store.start();
}

registry.activate(store.getState().selectedGame);
hud.setSnapshot(active().snapshot());

// ── Deterministic test hooks ────────────────────────────────────────────────
// Names/signatures are pinned in testApi.ts; the concrete behaviour lives here.
// Every one goes through real game logic, never through store poking.
const hooks: GaryTestHooks = {
  start: () => launch(store.getState().selectedGame),
  setLane: (n) => store.setLane(n),
  // Goes through the real collision predicate (Run.forceCollision injects a
  // vehicle onto Gary), so the e2e hook exercises collision, not just state.
  forceCollision: () => highway.run.forceCollision(),
  // Injects a friend into Gary's lane and lets the normal collision path
  // collect it, so the hook exercises the real pickup rule, not the store.
  spawnFriend: () => highway.run.spawnFriend(),
  entityCount: () => active().snapshot().entities,
  nearestAhead: () => highway.nearestAhead,
  nearMissCount: () => highway.run.nearMisses,
  congaLength: () => highway.run.conga.length,
  highScore: () => selectedBest(),
  highScores: () => ({ ...highScores }),
  particleCount: () => highway.particleCount,
  dying: () => highway.dying,
  snapshot: () => active().snapshot(),
  selectGame: (id) => selectGame(id),
  input: (action) => dispatch(action),
  backToMenu: () => store.returnToMenu(),
  command: (name, payload) => active().handleCommand?.(name, payload) ?? false,
};
installTestApi(store, () => hasRenderedFrame, hooks);

// ── Input: explicit user intent only (never the loop) ───────────────────────
// Every device is normalized to an ArcadeAction by the pure mapping in
// game/arcade/input.ts, then routed by STATUS. The shell contains no key names
// and no game rules; it only delivers the verb to whoever owns it right now.

function dispatch(action: ArcadeAction): void {
  const status = store.getState().status;
  switch (routeAction(status, action)) {
    case 'menu':
      hud.select.handleAction(action);
      break;
    case 'runtime':
      active().handleInput(action);
      break;
    case 'start':
      audio.unlock();
      store.start();
      break;
    case 'back':
      store.returnToMenu();
      break;
    case 'ignore':
      break;
  }
}

window.addEventListener('keydown', (e) => {
  const action = actionForKey(e.key);
  if (action === null) return;
  // A focused card is a native <button>: the browser already turns Space and
  // Enter into a `click` on it, and the grid owns its own arrow handling. If we
  // also dispatched here, one keystroke would fire twice.
  if (hud.select.ownsEvent(e.target)) return;
  dispatch(action);
  e.preventDefault();
});

// ── Touch: iPhone / iPad. Swipe = a direction, tap = the primary verb ────────
// Handlers sit on the canvas (the play area). The HUD overlay is
// pointer-events:none except its own buttons, so a touch anywhere that isn't a
// button falls through to here, while the buttons keep their taps.
// touch-action:none on the canvas (see index.html) stops the browser hijacking
// these gestures for scroll/zoom, so we never need preventDefault — the
// listeners stay passive.
let touchId: number | null = null;
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false; // travelled past the tap slop -> a swipe, not a tap
let swiped = false; // a direction already fired this gesture

function trackedTouch(list: TouchList): Touch | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === touchId) return list[i];
  }
  return null;
}

const canvas = renderer.domElement;

canvas.addEventListener(
  'touchstart',
  (e) => {
    if (touchId !== null) return; // already tracking a finger; ignore extras
    const t = e.changedTouches[0];
    touchId = t.identifier;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchMoved = false;
    swiped = false;
  },
  { passive: true },
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    if (touchId === null) return;
    const t = trackedTouch(e.changedTouches);
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (!isTapTravel(dx, dy)) touchMoved = true;
    // One direction per gesture, resolved on the dominant axis, so a
    // scroll-shaped drag never nudges the player sideways.
    if (swiped) return;
    const action = actionForSwipe(dx, dy);
    if (action === null) return;
    dispatch(action);
    swiped = true;
  },
  { passive: true },
);

canvas.addEventListener(
  'touchend',
  (e) => {
    if (touchId === null) return;
    const t = trackedTouch(e.changedTouches);
    if (!t) return;
    // A tap (no meaningful travel, no swipe) is the Space/Enter intent.
    if (!touchMoved && !swiped) dispatch(actionForTap());
    touchId = null;
  },
  { passive: true },
);
canvas.addEventListener(
  'touchcancel',
  () => {
    touchId = null;
  },
  { passive: true },
);

// ── Resize ──────────────────────────────────────────────────────────────────

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  pipeline.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
// iOS Safari shrinks/grows the layout viewport when the URL bar slides away and
// on orientation flips. `resize` covers most of it, but the visualViewport and
// orientationchange events are the reliable signals on iOS, so mirror onResize
// onto them too — otherwise the canvas can end up letterboxed or overscrolled.
window.visualViewport?.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// ── Render loop ─────────────────────────────────────────────────────────────

/** Where the camera currently aims; damped toward the active runtime's pose. */
const lookAt = { x: 0, y: 1, z: 0 };
{
  // Compose the very first frame from the active runtime's pose rather than
  // easing in from an arbitrary origin, so boot is not a swoop from nowhere.
  const pose = active().cameraTarget();
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  lookAt.x = pose.look.x;
  lookAt.y = pose.look.y;
  lookAt.z = pose.look.z;
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
}

let lastTime = performance.now();
let time = 0;

/** Bound slow frames so a game cannot jump an entire reaction window before
 *  input is observed. A modest catch-up allowance avoids severe time dilation
 *  under browser contention while preserving a playable world at low FPS. */
const MAX_FRAME_DT = 0.1;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, MAX_FRAME_DT);
  lastTime = now;
  time += dt;

  const runtime = active();
  runtime.update({ dt, time, reducedMotion });

  const snapshot = runtime.snapshot();
  hud.setSnapshot(snapshot);

  const s = store.getState();
  const best = highScores[s.selectedGame];

  // Passing your best is a mid-run event, not a game-over reveal: announce it
  // the moment it happens, so the last stretch of the run is played knowing it.
  if (
    s.status === 'playing' &&
    !recordAnnounced &&
    best > 0 &&
    snapshot.score > best
  ) {
    recordAnnounced = true;
    hud.recordBroken(snapshot.score);
    audio.highScore();
  }

  // Camera: the runtime says where it wants to be, the shell damps toward it.
  // Because every pose is damped, a state change (or a game change) reads as a
  // continuous camera move rather than a cut.
  const pose = runtime.cameraTarget();
  const lambda = reducedMotion ? 1e3 : pose.lambda;
  camera.position.x = MathUtils.damp(camera.position.x, pose.position.x, lambda, dt);
  camera.position.y = MathUtils.damp(camera.position.y, pose.position.y, lambda, dt);
  camera.position.z = MathUtils.damp(camera.position.z, pose.position.z, lambda, dt);

  // Shake is applied AFTER the damping so a knock never fights the framing
  // logic — it displaces the composed shot rather than becoming a target the
  // damping then chases.
  const shake = reducedMotion ? null : pose.shake;
  if (shake) {
    camera.position.x += shake.x;
    camera.position.y += shake.y;
  }

  lookAt.x = MathUtils.damp(lookAt.x, pose.look.x, lambda, dt);
  lookAt.y = MathUtils.damp(lookAt.y, pose.look.y, lambda, dt);
  lookAt.z = MathUtils.damp(lookAt.z, pose.look.z, lambda, dt);
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
  // Roll goes on AFTER lookAt (which overwrites the whole orientation), so the
  // horizon tilts with the shake without the camera losing its aim point.
  if (shake) camera.rotateZ(shake.roll);

  pipeline.render(scene, camera);

  if (!hasRenderedFrame) {
    hasRenderedFrame = true;
    hud.setReady();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
