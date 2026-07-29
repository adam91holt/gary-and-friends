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
import { GameAudio } from './audio.ts';
import { Run } from './game/gameplay/run.ts';
import { GameStore } from './game/state.ts';
import { createGary } from './scene/gary.ts';
import { laneToX, Road } from './scene/road.ts';
import { Traffic } from './scene/traffic.ts';
import { installTestApi, type GaryTestHooks } from './testApi.ts';
import { BG } from './theme.ts';
import { Hud } from './ui/hud.ts';

const store = new GameStore();
const audio = new GameAudio();

// Feedback for threading a gap: a whoosh cue plus a short accent pulse the HUD
// and the lighting both read. Set by the simulation, decayed by the loop.
let nearMissFlash = 0;

// The gameplay simulation (traffic, scoring, difficulty ramp, collision). Pure
// logic — this file only ticks it and draws whatever it says.
const run = new Run(store, {
  onNearMiss: () => {
    nearMissFlash = 1;
    audio.nearMiss();
    hud.pulse();
  },
});

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
  // Goes through the real collision predicate (Run.forceCollision injects a
  // vehicle onto Gary), so the e2e hook exercises collision, not just state.
  forceCollision: () => run.forceCollision(),
  spawnFriend: () => {
    /* ticket 03 wires real friend spawning here — add a second EntityField
       beside run.traffic and inject into it; see src/game/entities/field.ts */
  },
  entityCount: () => run.traffic.activeCount,
  nearestAhead: () => {
    let nearest: { distance: number; lane: number } | null = null;
    for (const e of run.traffic.entities) {
      if (!e.active || e.z > 0) continue;
      const distance = -e.z;
      if (nearest === null || distance < nearest.distance) {
        nearest = { distance, lane: e.lane };
      }
    }
    return nearest;
  },
  nearMissCount: () => run.nearMisses,
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
const KEY_LIGHT_BASE = 1.5;
const key = new DirectionalLight(0xfff1e0, KEY_LIGHT_BASE);
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

// Oncoming traffic — instanced meshes driven entirely by run.traffic entities.
const traffic = new Traffic();
scene.add(traffic.group);

// Gary — stays at world z=0; the road scrolls past him. Lane drives his X.
const gary = createGary();
gary.position.set(laneToX(store.getState().lane), 0, 0);
scene.add(gary);

// Render-local feel state. It reacts to store transitions without becoming game
// state: visual speed coasts, while crash spin/shake decay independently.
let visualSpeed = store.getState().speed;
let shake = 0;
let crashSpinTarget = 0;
let previousState = store.getState();
store.subscribe((state) => {
  if (state.status !== previousState.status) {
    if (state.status === 'playing' || state.status === 'menu') {
      // Both start/restart and an explicit store.reset() clear simulation-owned
      // state. Otherwise reset() would leave frozen traffic visible on the menu.
      run.reset();
      traffic.sync(run.traffic.entities);
      gary.position.x = laneToX(state.lane);
      visualSpeed = 0;
      if (state.status === 'playing') audio.start();
    }
    if (state.status === 'gameover') {
      audio.crash();
      shake = reducedMotion ? 0 : 0.2;
      crashSpinTarget = gary.rotation.y + 2;
    }
  }
  if (state.status === 'playing' && state.lane !== previousState.lane) {
    audio.lane();
  }
  previousState = state;
});

// DOM overlay (menu / HUD / gameover / loading skeleton).
const hud = new Hud(store, () => audio.unlock());

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
      if (status === 'playing') audio.unlock();
      store.setLane(lane - 1);
      e.preventDefault();
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      if (status === 'playing') audio.unlock();
      store.setLane(lane + 1);
      e.preventDefault();
      break;
    case ' ':
    case 'Enter':
      if (status !== 'playing') {
        audio.unlock();
        store.start();
      }
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

  // Tick the simulation FIRST, so everything drawn this frame reflects the same
  // instant: distance/score/speed ramp, traffic movement + spawning, collision.
  // Gary's rendered X is fed back in so a hit matches the cone you can see.
  run.setGaryX(gary.position.x);
  run.update(dt);
  traffic.sync(run.traffic.entities);

  const s = store.getState();
  const menuFraming = s.status === 'menu';

  visualSpeed = reducedMotion
    ? s.speed
    : MathUtils.damp(
        visualSpeed,
        s.speed,
        s.status === 'gameover' ? 2.2 : 1.6,
        dt,
      );
  road.update(dt, visualSpeed);

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
  // Bob only while Gary is alive; a collision topples and spins the whole cone.
  const canBob = s.status === 'playing' || s.status === 'menu';
  gary.position.y =
    reducedMotion || !canBob ? 0 : 0.04 + Math.sin(time * 2.4) * 0.04;
  gary.rotation.x = MathUtils.damp(
    gary.rotation.x,
    s.status === 'gameover' ? -1.35 : 0,
    reducedMotion ? 1e3 : 7,
    dt,
  );
  const yawTarget =
    s.status === 'gameover' ? crashSpinTarget : menuFraming ? -0.42 : 0;
  gary.rotation.y = MathUtils.damp(
    gary.rotation.y,
    yawTarget,
    reducedMotion ? 1e3 : s.status === 'gameover' ? 7 : 3.2,
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

  if (!reducedMotion && shake > 0.001) {
    shake *= Math.exp(-6 * dt);
    camera.position.x += shake * Math.sin(time * 60);
    camera.position.y += shake * Math.cos(time * 53);
  } else {
    shake = 0;
  }

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

  // Near miss: a brief warm bloom on the key light and a small camera kick, so
  // squeezing past a truck is felt in the scene and not only in the HUD.
  if (nearMissFlash > 0.001) {
    nearMissFlash *= Math.exp(-7 * dt);
    key.intensity = KEY_LIGHT_BASE + nearMissFlash * 1.5;
    if (!reducedMotion) camera.position.y += nearMissFlash * 0.06;
  } else {
    nearMissFlash = 0;
    key.intensity = KEY_LIGHT_BASE;
  }

  renderer.render(scene, camera);

  if (!hasRenderedFrame) {
    hasRenderedFrame = true;
    hud.setReady();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
