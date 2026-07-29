/**
 * Renderer / bootstrap. The rendering side of the seam: it owns three.js, the
 * canvas, the chase camera and the animation loop, and it READS from the
 * GameStore. All game logic lives in src/game/*; this file stays logic-light so
 * the store stays unit-testable without a browser.
 *
 * What lives here: a scrolling 3-lane highway (see scene/road.ts), Gary lerping
 * between lane positions driven by store.lane, a chase camera that eases behind
 * him, and the DOM HUD (ui/hud.ts). The store is never mutated from the loop —
 * only from explicit user intent (keyboard / HUD buttons) and the test hooks.
 */
// Self-hosted variable display face. Bundled by Vite (no network/CDN at runtime)
// so the type scale in index.html renders in its intended voice rather than
// silently falling back to the system stack.
import '@fontsource-variable/space-grotesk/wght.css';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { GameStore } from './game/state.ts';
import { createGary } from './scene/gary.ts';
import { laneToX, Road } from './scene/road.ts';
import { Hud } from './ui/hud.ts';
import { installTestApi, type GaryTestHooks } from './testApi.ts';

const BG = 0x0e0e18;

const store = new GameStore();

// Honour the OS reduced-motion preference in the 3D layer too, not just CSS:
// camera sweeps snap instead of easing, and Gary's idle bob is stilled.
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (e) => {
  reducedMotion = e.matches;
});

// `ready` flips true after the first rendered frame. Tests wait on this.
let hasRenderedFrame = false;

// Deterministic test hooks. Names/signatures are pinned in testApi.ts; the
// concrete behaviour is supplied here. 02/03 fill in spawnFriend without
// renaming anything.
const hooks: GaryTestHooks = {
  setLane: (n) => store.setLane(n),
  forceCollision: () => store.gameOver(),
  spawnFriend: () => {
    /* ticket 02 wires real friend spawning here */
  },
};
installTestApi(store, () => hasRenderedFrame, hooks);

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

/**
 * Two camera rigs, eased between on state change (the one committed idea the
 * whole screen is built around): the menu is a low front-quarter "hero" shot
 * that frames Gary off to the right of the docked card — you meet the character
 * before you play him — and starting a run swings the camera up and back into
 * the over-the-shoulder chase pose. `start()` is therefore a camera move, not
 * just a card swap.
 */
const MENU_RIG = {
  pos: { x: -2.9, y: 1.35, z: 4.3 },
  look: { x: 0.55, y: 0.95, z: -1.5 },
} as const;
const CHASE_RIG = {
  pos: { x: 0, y: 3, z: 7 },
  look: { x: 0, y: 1.1, z: -6 },
} as const;

camera.position.set(MENU_RIG.pos.x, MENU_RIG.pos.y, MENU_RIG.pos.z);
camera.lookAt(MENU_RIG.look.x, MENU_RIG.look.y, MENU_RIG.look.z);

/** Where the camera currently aims; damped toward the active rig's target. */
const lookAt: { x: number; y: number; z: number } = {
  x: MENU_RIG.look.x,
  y: MENU_RIG.look.y,
  z: MENU_RIG.look.z,
};

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(BG, 1);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

// Lighting — a cool night sky with a warm key, so Gary's orange pops.
scene.add(new HemisphereLight(0x5566aa, 0x0a0a12, 0.7));
scene.add(new AmbientLight(0xffffff, 0.25));
const key = new DirectionalLight(0xfff1e0, 1.5);
key.position.set(4, 8, 6);
scene.add(key);
const rim = new DirectionalLight(0x6688ff, 0.6);
rim.position.set(-5, 4, -6);
scene.add(rim);

// Menu-only hero light, from the front-left where the hero camera sits, so Gary
// is modelled and lit in his portrait. Its intensity is cross-faded with the
// camera rig in the loop, so it never flattens the in-play road lighting.
const HERO_LIGHT_MAX = 1.5;
const heroLight = new DirectionalLight(0xffd9a8, HERO_LIGHT_MAX);
heroLight.position.set(-4, 3, 5);
scene.add(heroLight);

// Dark ground beyond the road so the horizon reads solid under the fog.
const ground = new Mesh(
  new PlaneGeometry(400, 500),
  new MeshStandardMaterial({ color: 0x0c0c16, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.06, -120);
scene.add(ground);

// The scrolling highway.
const road = new Road();
scene.add(road.group);

// Gary — stays at world z=0; the road scrolls past him. Lane drives his X.
const gary = createGary();
gary.position.set(laneToX(store.getState().lane), 0, 0);
scene.add(gary);

// DOM overlay (menu / HUD / gameover / loading skeleton).
const hud = new Hud(store);

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ── Input: explicit user intent only (never the loop) ───────────────────────
window.addEventListener('keydown', (e) => {
  const { status, lane } = store.getState();
  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      store.setLane(lane - 1);
      e.preventDefault();
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      store.setLane(lane + 1);
      e.preventDefault();
      break;
    case ' ':
    case 'Enter':
      if (status !== 'playing') store.start();
      e.preventDefault();
      break;
    default:
      break;
  }
});

// ── Render loop ─────────────────────────────────────────────────────────────
let lastTime = performance.now();
let time = 0;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  time += dt;

  const s = store.getState();
  const menuFraming = s.status === 'menu';

  road.update(dt, s.speed);

  // Gary eases toward his lane's X, banking into the move for some juice.
  const targetX = laneToX(s.lane);
  const prevX = gary.position.x;
  gary.position.x = MathUtils.damp(prevX, targetX, 9, dt);
  gary.rotation.z = MathUtils.damp(
    gary.rotation.z,
    (targetX - gary.position.x) * 0.5,
    9,
    dt,
  );
  // Idle bob stays at or above the road surface (stilled for reduced motion).
  gary.position.y = reducedMotion ? 0 : 0.04 + Math.sin(time * 2.4) * 0.04;
  // On the menu he turns to face the hero camera; in play he squares up to the
  // road ahead. Same damped-transition idea as the camera rigs.
  gary.rotation.y = MathUtils.damp(
    gary.rotation.y,
    menuFraming ? -0.42 : 0,
    reducedMotion ? 1e3 : 3.2,
    dt,
  );

  // Camera: pick the rig for the current state, then damp position AND aim
  // toward it. On the menu that's the hero shot; playing/gameover is the chase
  // pose tracking Gary's lane. Because both are damped, `start()` reads as a
  // continuous camera move rather than a cut.
  const rig = menuFraming ? MENU_RIG : CHASE_RIG;
  // Lane tracking only applies to the chase rig; the hero shot stays composed.
  const camTargetX = menuFraming ? rig.pos.x : rig.pos.x + targetX * 0.55;
  const lookTargetX = menuFraming ? rig.look.x : gary.position.x * 0.4;
  // Reduced motion: snap to the rig instead of sweeping the viewport.
  const camLambda = reducedMotion ? 1e3 : 3.2;

  camera.position.x = MathUtils.damp(camera.position.x, camTargetX, camLambda, dt);
  camera.position.y = MathUtils.damp(camera.position.y, rig.pos.y, camLambda, dt);
  camera.position.z = MathUtils.damp(camera.position.z, rig.pos.z, camLambda, dt);

  lookAt.x = MathUtils.damp(lookAt.x, lookTargetX, camLambda, dt);
  lookAt.y = MathUtils.damp(lookAt.y, rig.look.y, camLambda, dt);
  lookAt.z = MathUtils.damp(lookAt.z, rig.look.z, camLambda, dt);
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);

  // Cross-fade the hero light with the same easing as the rig move.
  heroLight.intensity = MathUtils.damp(
    heroLight.intensity,
    menuFraming ? HERO_LIGHT_MAX : 0,
    camLambda,
    dt,
  );

  renderer.render(scene, camera);

  if (!hasRenderedFrame) {
    hasRenderedFrame = true;
    hud.setReady();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
