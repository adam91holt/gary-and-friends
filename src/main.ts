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
import { BASE_SPEED, GameStore } from './game/state.ts';
import { createGary } from './scene/gary.ts';
import { laneToX, Road } from './scene/road.ts';
import { Hud } from './ui/hud.ts';
import { installTestApi, type GaryTestHooks } from './testApi.ts';

const BG = 0x0e0e18;
/** Gentle road drift on the menu/gameover screens so the scene feels alive. */
const IDLE_SPEED = 6;

const store = new GameStore();

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
camera.position.set(0, 3, 7);
camera.lookAt(0, 1.1, -6);

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
let scoreCarry = 0;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  time += dt;

  const s = store.getState();
  const effectiveSpeed = s.status === 'menu' ? IDLE_SPEED : s.speed;

  // Award distance-based score while playing (renderer signals intent; the
  // store owns the number). Simple integer trickle; ticket 02 refines scoring.
  if (s.status === 'playing') {
    scoreCarry += (s.speed / BASE_SPEED) * dt * 10;
    if (scoreCarry >= 1) {
      const whole = Math.floor(scoreCarry);
      store.addScore(whole);
      scoreCarry -= whole;
    }
  }

  road.update(dt, effectiveSpeed);

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
  // Idle bob so he feels alive even on the menu.
  gary.position.y = Math.sin(time * 2.4) * 0.04;

  // Chase camera eases behind Gary and looks a little further down his lane.
  camera.position.x = MathUtils.damp(camera.position.x, targetX * 0.55, 5, dt);
  camera.lookAt(gary.position.x * 0.4, 1.1, -6);

  renderer.render(scene, camera);

  if (!hasRenderedFrame) {
    hasRenderedFrame = true;
    hud.setReady();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
