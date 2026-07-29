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
import { DEATH_DURATION, deathPose } from './game/fx/death.ts';
import {
  addTrauma,
  CRASH_TRAUMA,
  decayTrauma,
  NEAR_MISS_TRAUMA,
  PICKUP_TRAUMA,
  shakeOffset,
} from './game/fx/shake.ts';
import { Run } from './game/gameplay/run.ts';
import {
  loadHighScore,
  submitHighScore,
  type StoragePort,
} from './game/highScore.ts';
import { GameStore } from './game/state.ts';
import { createGary } from './scene/gary.ts';
import { Friends } from './scene/friends.ts';
import { ParticleFx } from './scene/particles.ts';
import { laneToX, Road } from './scene/road.ts';
import { Traffic } from './scene/traffic.ts';
import { installTestApi, type GaryTestHooks } from './testApi.ts';
import { BG } from './theme.ts';
import { Hud } from './ui/hud.ts';

const store = new GameStore();
const audio = new GameAudio();

// The particle layer: hop dust, collect pops, near-miss sparks, crash debris.
// Pure pools in src/game/fx/particles.ts; this is only their mesh.
const fx = new ParticleFx();

/**
 * The storage adapter for the persisted best. This is the ONLY place in the app
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

/** The current best. Presentation state, mirrored onto the HUD and test API. */
let highScore = loadHighScore(storage);
/** Latch so the mid-run record fanfare fires once per run, not once per frame. */
let recordAnnounced = false;

// Feedback for threading a gap: a whoosh cue plus a short accent pulse the HUD
// and the lighting both read. Set by the simulation, decayed by the loop.
let nearMissFlash = 0;
// Same idea for a pickup, but warmer and longer: collecting a friend is the
// happiest thing in the game and should light the whole road for a moment.
let friendFlash = 0;
/**
 * Camera trauma (see game/fx/shake.ts). Events ADD to it and the loop bleeds it
 * off, so a near miss during the crash shake deepens the same lurch rather than
 * restarting a competing one.
 */
let trauma = 0;
/** Seconds since the crash, or null while Gary is alive. Drives `deathPose`. */
let deathTime: number | null = null;
/** Where Gary was standing when he was hit. The death pose is relative to it. */
let deathX = 0;

// The gameplay simulation (traffic, friends, scoring, difficulty, collision).
// Pure logic — this file only ticks it and draws whatever it says.
const run = new Run(store, {
  onNearMiss: (vehicleX) => {
    nearMissFlash = 1;
    trauma = addTrauma(trauma, NEAR_MISS_TRAUMA);
    audio.nearMiss();
    hud.pulse();
    // Spray sparks off the side the traffic actually passed, rather than
    // guessing from Gary's lane (which points the wrong way in the centre lane).
    const side = Math.sign(vehicleX - gary.root.position.x) || 1;
    if (!reducedMotion) fx.nearMiss(gary.root.position.x, side);
  },
  onFriend: (pickup) => {
    friendFlash = 1;
    trauma = addTrauma(trauma, PICKUP_TRAUMA);
    audio.friend();
    hud.collected(pickup);
    if (!reducedMotion) fx.pop(gary.root.position.x, pickup.variant);
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
  // Injects a friend into Gary's lane and lets the normal collision path
  // collect it, so the hook exercises the real pickup rule, not the store.
  spawnFriend: () => run.spawnFriend(),
  entityCount: () => run.traffic.activeCount + run.friends.activeCount,
  nearestAhead: () => {
    let nearest: { distance: number; lane: number } | null = null;
    // Traffic only: this is the "what am I about to hit" readout tests steer
    // by. A friend is something to aim FOR, so folding it in here would make
    // the dodging bots swerve away from the reward.
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
  congaLength: () => run.conga.length,
  highScore: () => highScore,
  particleCount: () => fx.liveCount,
  dying: () => deathTime !== null && deathTime < DEATH_DURATION,
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
/**
 * The wreck shot. The chase rig aims nineteen units up an empty road, which is
 * exactly the wrong place to be looking at the moment the road stops — the
 * punchline of the whole game is a flattened cone lying at z=0, and the default
 * pose puts it below the bottom of the frame.
 *
 * So game-over swings down and around into a low front-quarter shot that
 * mirrors the menu's hero framing: card docked left, Gary on the right. Meeting
 * him standing proud and leaving him flat on his back is the SAME composition,
 * and the only thing that changed is what happened to him. Offsets are relative
 * to his crash X so the shot composes from whichever lane he died in.
 */
const WRECK_RIG = {
  // Gary settles at +0.6 yaw, so the payoff camera crosses to his front-right;
  // the card remains left-docked while his eyes, not his back, carry the joke.
  pos: { x: 3.0, y: 1.5, z: 6.2 },
  look: { x: 0.0, y: 0.35, z: 3.3 },
} as const;

/**
 * Ceiling on how far the conga line is allowed to pull the chase camera back
 * (world units of tail). Beyond this the road ahead would start to shrink
 * faster than the tail grows, trading the thing you have to react to for the
 * thing you already earned — a bad deal at any convoy length.
 */
const CONGA_FRAME_MAX = 6.5;

/**
 * How the convoy reframes the chase shot, per world unit of tail.
 *
 * The LIFT matters more than the pull-back, and that is the whole trick. From
 * the default low chase pose you are looking straight down the line, so every
 * cone hides behind the one in front and a six-friend convoy reads as one lumpy
 * mass. Rising as it grows turns the same tail into a legible queue of distinct
 * characters — which is the reward you actually earned. Pulling back alone just
 * makes the pile smaller.
 */
const CONGA_LIFT = 0.28;
/**
 * Deliberately GREATER than 1: the tail grows toward the camera, so retreating
 * one-for-one only ever holds the newest arrival exactly at the near clip of
 * the frame — and the newest arrival is the one the player just earned and most
 * wants to see. Over-retreating buys the margin that keeps them in shot.
 */
const CONGA_PULLBACK = 1.3;
const CONGA_AIM_BACK = 0.75;

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
const RIM_LIGHT_BASE = 0.6;
const rim = new DirectionalLight(0x6688ff, RIM_LIGHT_BASE);
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

// The cast: collectible cones on the road plus the conga line behind Gary.
// Both are placed straight from the simulation (run.friends / run.conga).
const friends = new Friends();
scene.add(friends.group);

// Particles ride above the road, below everything else.
scene.add(fx.group);

// Gary — stays at world z=0; the road scrolls past him. Lane drives his X.
// `root` is positioned/rotated; `body` carries the squash-and-stretch scale.
const gary = createGary();
gary.root.position.set(laneToX(store.getState().lane), 0, 0);
scene.add(gary.root);

// Render-local feel state. It reacts to store transitions without becoming game
// state: visual speed coasts, while the death animation and trauma decay
// independently.
let visualSpeed = store.getState().speed;
let previousState = store.getState();
store.subscribe((state) => {
  if (state.status !== previousState.status) {
    if (state.status === 'playing' || state.status === 'menu') {
      // Both start/restart and an explicit store.reset() clear simulation-owned
      // state. Otherwise reset() would leave frozen traffic visible on the menu.
      run.reset();
      traffic.sync(run.traffic.entities);
      // The conga line is simulation-owned too: reset() empties it, and this
      // clears the meshes in the same frame so no ghost cones survive a restart.
      friends.clear();
      // Same rule for the fx: last run's crash debris must not be hanging in
      // the air over a fresh road.
      fx.clear();
      gary.root.position.set(laneToX(state.lane), 0, 0);
      gary.root.rotation.set(0, 0, 0);
      gary.body.scale.set(1, 1, 1);
      visualSpeed = 0;
      trauma = 0;
      deathTime = null;
      recordAnnounced = false;
      if (state.status === 'playing') audio.start();
    }
    if (state.status === 'gameover') {
      // The comedic death starts here and the loop plays it out; the crash cue,
      // the debris and the biggest shake in the game all land on the same frame
      // as the squash, because an impact that isn't simultaneous isn't an impact.
      deathTime = 0;
      deathX = gary.root.position.x;
      audio.crash();
      trauma = addTrauma(trauma, CRASH_TRAUMA);
      if (!reducedMotion) fx.crash(gary.root.position.x);

      // Bank the run. `submitHighScore` writes only on a genuine improvement.
      const result = submitHighScore(storage, state.score, highScore);
      highScore = result.best;
      hud.setHighScore(highScore, result.isNew);
      if (result.isNew && !recordAnnounced) audio.highScore();
    }
  }
  if (state.status === 'playing' && state.lane !== previousState.lane) {
    audio.lane();
    // Dust kicked off the lane he is leaving — the visual echo of the input.
    if (!reducedMotion) {
      fx.hop(gary.root.position.x, Math.sign(state.lane - previousState.lane));
    }
  }
  previousState = state;
});

// DOM overlay (menu / HUD / gameover / loading skeleton).
const hud = new Hud(
  store,
  () => audio.unlock(),
  () => {
    const muted = audio.toggleMute();
    if (!muted) audio.lane(); // audible confirmation that sound is back
    return muted;
  },
);
hud.setHighScore(highScore);
hud.setMuted(audio.muted);

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

/** Bound slow frames so traffic cannot jump an entire reaction window before
 * input is observed. A modest catch-up allowance avoids severe time dilation
 * under browser contention while preserving a dodgeable world at low FPS. */
const MAX_FRAME_DT = 0.1;
const SIMULATION_STEP = 0.05;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, MAX_FRAME_DT);
  lastTime = now;
  time += dt;

  // Catch the simulation up before drawing. Gary advances in the same small
  // steps as traffic so a low-fps late dodge follows the path seen at 60fps
  // instead of either teleporting clear or remaining frozen for a whole frame.
  let remaining = dt;
  while (remaining > 0) {
    const step = Math.min(remaining, SIMULATION_STEP);
    const targetX = laneToX(store.getState().lane);
    gary.root.position.x = MathUtils.damp(gary.root.position.x, targetX, 12, step);
    run.setGaryX(gary.root.position.x);
    run.update(step);
    remaining -= step;
  }
  traffic.sync(run.traffic.entities);
  friends.syncField(run.friends.entities, time, reducedMotion);
  friends.syncConga(run.conga.members, time, reducedMotion);

  const s = store.getState();
  const menuFraming = s.status === 'menu';

  // Passing your best is a mid-run event, not a game-over reveal: announce it
  // the moment it happens, so the last stretch of the run is played knowing it.
  if (
    s.status === 'playing' &&
    !recordAnnounced &&
    highScore > 0 &&
    s.score > highScore
  ) {
    recordAnnounced = true;
    hud.recordBroken(s.score);
    audio.highScore();
  }

  visualSpeed = reducedMotion
    ? s.speed
    : MathUtils.damp(
        visualSpeed,
        s.speed,
        s.status === 'gameover' ? 2.2 : 1.6,
        dt,
      );
  road.update(dt, visualSpeed);
  // Event bursts need the road frame even when recurring dust is disabled (for
  // example by reduced-motion preferences).
  fx.setRoadSpeed(visualSpeed);

  // Road dust under Gary while the road is moving. Emitted on a distance
  // cadence inside `fx`, so the plume thickens with speed instead of thinning.
  if (!reducedMotion && s.status === 'playing') {
    fx.road(dt, gary.root.position.x, visualSpeed);
  } else if (!reducedMotion && s.status === 'gameover') {
    // The screen players linger on keeps breathing after the impact burst dies:
    // one slow curl off the wreck, sparse enough to preserve the still payoff.
    fx.smoulder(dt, gary.root.position.x);
  }
  fx.update(dt);

  // Gary's X already advanced with the simulation substeps above; bank the
  // rendered cone toward the remainder of that same lane change.
  const targetX = laneToX(s.lane);

  if (deathTime !== null) {
    // ── The comedic death ──────────────────────────────────────────────────
    // Every number comes from the pure `deathPose(t)` beat sheet; this only
    // applies it. Reduced motion jumps straight to the settled pose: Gary is
    // still visibly wrecked (that's information), he just doesn't bounce.
    deathTime += dt;
    const pose = deathPose(reducedMotion ? DEATH_DURATION : deathTime);
    gary.body.scale.set(pose.scaleX, pose.scaleY, pose.scaleZ);
    gary.root.position.set(deathX + pose.x, pose.y, pose.z);
    gary.root.rotation.set(-pose.tip, pose.spin, 0);
  } else {
    gary.body.scale.set(1, 1, 1);
    gary.root.rotation.z = MathUtils.damp(
      gary.root.rotation.z,
      (targetX - gary.root.position.x) * 0.5,
      9,
      dt,
    );
    gary.root.rotation.x = MathUtils.damp(gary.root.rotation.x, 0, 7, dt);
    gary.root.position.y = reducedMotion
      ? 0
      : 0.04 + Math.sin(time * 2.4) * 0.04;
    gary.root.rotation.y = MathUtils.damp(
      gary.root.rotation.y,
      menuFraming ? -0.42 : 0,
      reducedMotion ? 1e3 : 3.2,
      dt,
    );
  }

  // Camera: pick the rig for the current state, then damp position AND aim
  // toward it. Menu is the hero shot, playing is the chase pose, game-over
  // swings down into the wreck shot. Because all three are damped, every
  // transition reads as a continuous camera move rather than a cut — and the
  // crash's move is the payoff, craning down to look at what's left of him.
  const wreckFraming = s.status === 'gameover';
  const rig = menuFraming ? MENU_RIG : wreckFraming ? WRECK_RIG : CHASE_RIG;
  // Composed rigs (hero, wreck) hold their framing; only the chase pose tracks
  // the lane. The wreck rig offsets from where Gary actually came to rest, so
  // the shot composes identically whichever lane he died in.
  const wreckX = deathX;
  const camTargetX = menuFraming
    ? rig.pos.x
    : wreckFraming
      ? rig.pos.x + wreckX
      : rig.pos.x + targetX * 0.55;
  const lookTargetX = menuFraming
    ? rig.look.x
    : wreckFraming
      ? rig.look.x + wreckX
      : gary.root.position.x * 0.4;
  // Reduced motion: snap to the rig instead of sweeping the viewport.
  const camLambda = reducedMotion ? 1e3 : 3.2;

  // The convoy earns its own framing: as the conga line grows, the chase rig
  // eases back and up so the tail stays in shot instead of trailing off behind
  // the camera. The reward literally changes the composition — the longer your
  // line, the wider the shot, which is the whole fantasy made visible. Damped
  // like every other rig move, so it reads as a slow pull-back, never a cut.
  // Composed rigs opt out: they are framing ONE cone, deliberately.
  const tail =
    menuFraming || wreckFraming
      ? 0
      : Math.min(run.conga.tailLength, CONGA_FRAME_MAX);
  camera.position.x = MathUtils.damp(camera.position.x, camTargetX, camLambda, dt);
  camera.position.y = MathUtils.damp(
    camera.position.y,
    rig.pos.y + tail * CONGA_LIFT,
    camLambda,
    dt,
  );
  camera.position.z = MathUtils.damp(
    camera.position.z,
    rig.pos.z + tail * CONGA_PULLBACK,
    camLambda,
    dt,
  );

  // Camera shake, applied AFTER the rig damping so a knock never fights the
  // framing logic — it displaces the composed shot rather than becoming a
  // target the damping then chases. Trauma-based (see game/fx/shake.ts): a
  // near miss is a nudge, a crash is a lurch, and both settle rather than stop.
  trauma = decayTrauma(trauma, dt);
  const shake = reducedMotion || trauma <= 0 ? null : shakeOffset(trauma, time);
  if (shake) {
    camera.position.x += shake.x;
    camera.position.y += shake.y;
  }

  lookAt.x = MathUtils.damp(lookAt.x, lookTargetX, camLambda, dt);
  // As the camera rises for a long convoy, the aim drops with it: otherwise the
  // extra height would just tilt the shot up into empty sky and push the tail
  // off the bottom of the frame. Together they read as craning up over the line.
  lookAt.y = MathUtils.damp(
    lookAt.y,
    rig.look.y - tail * CONGA_LIFT * 0.5,
    camLambda,
    dt,
  );
  // The aim point also drifts back toward Gary as the convoy grows. Raising and
  // retreating the camera alone still aims 19 units up the road, which puts the
  // near end of a long tail below the bottom of the frame — the friends closest
  // to Gary, i.e. the ones that just joined, would be the ones you cannot see.
  lookAt.z = MathUtils.damp(
    lookAt.z,
    rig.look.z + tail * CONGA_AIM_BACK,
    camLambda,
    dt,
  );
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
  // Roll goes on AFTER lookAt (which overwrites the whole orientation), so the
  // horizon tilts with the shake without the camera losing its aim point.
  if (shake) camera.rotateZ(shake.roll);

  // Cross-fade the hero light with the same easing as the rig move. It sits
  // front-left, which is where BOTH composed rigs sit — so it models Gary in
  // his portrait and again in his wreck, and stays out of the road lighting
  // while a run is actually under way. Dimmer on the wreck: he's had a day.
  heroLight.intensity = MathUtils.damp(
    heroLight.intensity,
    menuFraming || wreckFraming ? HERO_LIGHT_MAX : 0,
    camLambda,
    dt,
  );

  // Near miss: a brief warm bloom on the key light and a small camera kick, so
  // squeezing past a truck is felt in the scene and not only in the HUD.
  // Pickup: a warmer, slower bloom than the near-miss kick, so collecting a
  // friend feels like the road lighting up rather than a hazard whipping past.
  if (friendFlash > 0.001) {
    friendFlash *= Math.exp(-3.4 * dt);
  } else {
    friendFlash = 0;
  }

  if (nearMissFlash > 0.001) {
    nearMissFlash *= Math.exp(-7 * dt);
    if (!reducedMotion) camera.position.y += nearMissFlash * 0.06;
  } else {
    nearMissFlash = 0;
  }
  key.intensity =
    KEY_LIGHT_BASE + nearMissFlash * 1.5 + friendFlash * 1.1;
  // The pickup also warms the rim light, so the whole convoy is momentarily
  // outlined — the tail is what you just made bigger, so the tail should glow.
  rim.intensity = RIM_LIGHT_BASE + friendFlash * 1.4;

  renderer.render(scene, camera);

  if (!hasRenderedFrame) {
    hasRenderedFrame = true;
    hud.setReady();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
