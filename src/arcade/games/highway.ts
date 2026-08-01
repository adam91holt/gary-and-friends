/**
 * Endless Highway — the original game, now the cabinet's first runtime.
 *
 * This file is a MOVE, not a rewrite. Every rule, constant, camera rig, easing
 * lambda and comment below came out of `src/main.ts` unchanged; the only new
 * code is the `ArcadeGameRuntime` plumbing around it (enter/leave/reset/
 * snapshot/cameraTarget). If a number here differs from the one that shipped
 * before the arcade existed, that is a bug.
 *
 * It owns everything highway-shaped: the road, traffic, the cast, Gary himself,
 * the particle layer, the run simulation, the death animation, camera trauma
 * and the three camera rigs. The shell owns none of it.
 */
import {
  DirectionalLight,
  MathUtils,
  Mesh,
  PlaneGeometry,
  type Scene,
  Group,
} from 'three';
import type { GameAudio } from '../../audio.ts';
import type { ArcadeAction, ArcadeSnapshot } from '../../game/arcade/contracts.ts';
import { DEATH_DURATION, deathPose } from '../../game/fx/death.ts';
import {
  addTrauma,
  CRASH_TRAUMA,
  decayTrauma,
  NEAR_MISS_TRAUMA,
  PICKUP_TRAUMA,
  shakeOffset,
} from '../../game/fx/shake.ts';
import { Run, type FriendPickup } from '../../game/gameplay/run.ts';
import type { GameState, GameStore } from '../../game/state.ts';
import { ownStandard } from '../../render/materials.ts';
import { Friends } from '../../scene/friends.ts';
import { createGary } from '../../scene/gary.ts';
import { ParticleFx } from '../../scene/particles.ts';
import { laneToX, Road } from '../../scene/road.ts';
import { Traffic } from '../../scene/traffic.ts';
import type { NearestEntity } from '../../testApi.ts';
import type {
  ArcadeGameRuntime,
  CameraPose,
  FrameContext,
} from '../runtime.ts';

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

/** Bound slow frames so traffic cannot jump an entire reaction window before
 * input is observed. A modest catch-up allowance avoids severe time dilation
 * under browser contention while preserving a dodgeable world at low FPS. */
const SIMULATION_STEP = 0.05;

const KEY_LIGHT_BASE = 1.5;
const RIM_LIGHT_BASE = 0.6;
const HERO_LIGHT_MAX = 1.5;

/** What the highway tells the HUD. The runtime never touches the DOM itself. */
export interface HighwayTelemetry {
  /** Gary threaded a gap. */
  pulse(): void;
  /** A friend joined the conga line. */
  collected(pickup: FriendPickup): void;
}

export interface HighwayDeps {
  readonly store: GameStore;
  readonly audio: GameAudio;
  readonly telemetry: HighwayTelemetry;
}

export class HighwayRuntime implements ArcadeGameRuntime {
  readonly id = 'highway' as const;
  readonly root = new Group();

  private readonly store: GameStore;
  private readonly audio: GameAudio;
  private readonly telemetry: HighwayTelemetry;

  /** The particle layer: hop dust, collect pops, near-miss sparks, crash
   *  debris. Pure pools in src/game/fx/particles.ts; this is only their mesh. */
  private readonly fx = new ParticleFx();
  private readonly road = new Road();
  private readonly traffic = new Traffic();
  private readonly friends = new Friends();
  private readonly gary = createGary();
  private readonly key: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly heroLight: DirectionalLight;

  /** The gameplay simulation (traffic, friends, scoring, difficulty,
   *  collision). Pure logic — this class only ticks it and draws what it says. */
  readonly run: Run;

  // Render-local feel state. It reacts to store transitions without becoming
  // game state: visual speed coasts, while the death animation and trauma decay
  // independently.
  private visualSpeed = 0;
  private nearMissFlash = 0;
  private friendFlash = 0;
  /**
   * Camera trauma (see game/fx/shake.ts). Events ADD to it and the loop bleeds
   * it off, so a near miss during the crash shake deepens the same lurch rather
   * than restarting a competing one.
   */
  private trauma = 0;
  /** Seconds since the crash, or null while Gary is alive. Drives `deathPose`. */
  private deathTime: number | null = null;
  /** Where Gary was standing when he was hit. The death pose is relative to it. */
  private deathX = 0;
  /** Reduced motion, refreshed from the shell's FrameContext every tick. */
  private reducedMotion = false;
  private time = 0;

  private previousState: GameState;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: HighwayDeps) {
    this.store = deps.store;
    this.audio = deps.audio;
    this.telemetry = deps.telemetry;
    this.previousState = this.store.getState();

    this.run = new Run(this.store, {
      onNearMiss: (vehicleX) => {
        this.nearMissFlash = 1;
        this.trauma = addTrauma(this.trauma, NEAR_MISS_TRAUMA);
        this.audio.nearMiss();
        this.telemetry.pulse();
        // Spray sparks off the side the traffic actually passed, rather than
        // guessing from Gary's lane (which points the wrong way in the centre).
        const side = Math.sign(vehicleX - this.gary.root.position.x) || 1;
        if (!this.reducedMotion) this.fx.nearMiss(this.gary.root.position.x, side);
      },
      onFriend: (pickup) => {
        this.friendFlash = 1;
        this.trauma = addTrauma(this.trauma, PICKUP_TRAUMA);
        this.audio.friend();
        this.telemetry.collected(pickup);
        if (!this.reducedMotion) this.fx.pop(this.gary.root.position.x, pickup.variant);
      },
    });

    // Lighting the highway owns. The shell contributes only the neutral
    // hemisphere/ambient fill every game shares — a warm key that pops Gary's
    // orange is a decision about THIS road, so it lives with the road.
    this.key = new DirectionalLight(0xfff1e0, KEY_LIGHT_BASE);
    this.key.position.set(4, 8, 6);
    this.rim = new DirectionalLight(0x6688ff, RIM_LIGHT_BASE);
    this.rim.position.set(-5, 4, -6);
    // Menu-only hero light, from the front-left where the hero camera sits, so
    // Gary is modelled and lit in his portrait. Its intensity is cross-faded
    // with the camera rig, so it never flattens the in-play road lighting.
    this.heroLight = new DirectionalLight(0xffd9a8, HERO_LIGHT_MAX);
    this.heroLight.position.set(-4, 3, 5);

    // Dark ground beyond the road so the horizon reads solid under the fog.
    const ground = new Mesh(
      new PlaneGeometry(400, 500),
      ownStandard({ color: 0x0c0c16, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.06, -120);

    // Gary — stays at world z=0; the road scrolls past him. Lane drives his X.
    // `root` is positioned/rotated; `body` carries the squash-and-stretch scale.
    this.gary.root.position.set(laneToX(this.store.getState().lane), 0, 0);

    this.root.add(
      this.key,
      this.rim,
      this.heroLight,
      ground,
      this.road.group,
      this.traffic.group,
      this.friends.group,
      // Particles ride above the road, below everything else.
      this.fx.group,
      this.gary.root,
    );
  }

  enter(scene: Scene): void {
    scene.add(this.root);
    this.previousState = this.store.getState();
    this.unsubscribe = this.store.subscribe((state) => this.onStateChange(state));
  }

  leave(scene: Scene): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    scene.remove(this.root);
  }

  /**
   * Back to a clean, drawable highway. Called by the shell on activation and on
   * every menu|gameover -> playing transition — everything the simulation owns
   * plus everything the *renderer* owns, so a restart can never leave frozen
   * traffic, ghost cones or last run's debris hanging over a fresh road.
   */
  reset(): void {
    this.run.reset();
    this.traffic.sync(this.run.traffic.entities);
    this.friends.clear();
    this.fx.clear();
    this.gary.root.position.set(laneToX(this.store.getState().lane), 0, 0);
    this.gary.root.rotation.set(0, 0, 0);
    this.gary.body.scale.set(1, 1, 1);
    this.visualSpeed = 0;
    this.trauma = 0;
    this.deathTime = null;
  }

  handleInput(action: ArcadeAction): void {
    // The highway is a three-lane dodger: only the horizontal axis means
    // anything, and `primary` is deliberately inert mid-run (routing has
    // already decided it is not a start, and Gary has nothing to confirm).
    if (action === 'left') this.changeLane(-1);
    else if (action === 'right') this.changeLane(1);
  }

  /** Move Gary one lane in `delta` (-1 left / +1 right). The store clamps range. */
  private changeLane(delta: number): void {
    const { status, lane } = this.store.getState();
    if (status !== 'playing') return;
    this.audio.unlock();
    this.store.setLane(lane + delta);
  }

  private onStateChange(state: GameState): void {
    const previous = this.previousState;
    if (state.status !== previous.status) {
      if (state.status === 'playing' || state.status === 'menu') {
        // Both start/restart and an explicit store.reset() clear simulation-
        // and renderer-owned state alike.
        this.reset();
        if (state.status === 'playing') this.audio.start();
      }
      if (state.status === 'gameover') {
        // The comedic death starts here and the loop plays it out; the crash
        // cue, the debris and the biggest shake in the game all land on the
        // same frame as the squash, because an impact that isn't simultaneous
        // isn't an impact.
        this.deathTime = 0;
        this.deathX = this.gary.root.position.x;
        this.audio.crash();
        this.trauma = addTrauma(this.trauma, CRASH_TRAUMA);
        if (!this.reducedMotion) this.fx.crash(this.gary.root.position.x);
      }
    }
    if (state.status === 'playing' && state.lane !== previous.lane) {
      this.audio.lane();
      // Dust kicked off the lane he is leaving — the visual echo of the input.
      if (!this.reducedMotion) {
        this.fx.hop(
          this.gary.root.position.x,
          Math.sign(state.lane - previous.lane),
        );
      }
    }
    this.previousState = state;
  }

  update(ctx: FrameContext): void {
    const { dt } = ctx;
    this.reducedMotion = ctx.reducedMotion;
    this.time = ctx.time;

    // Catch the simulation up before drawing. Gary advances in the same small
    // steps as traffic so a low-fps late dodge follows the path seen at 60fps
    // instead of either teleporting clear or remaining frozen for a whole frame.
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, SIMULATION_STEP);
      const stepTargetX = laneToX(this.store.getState().lane);
      this.gary.root.position.x = MathUtils.damp(
        this.gary.root.position.x,
        stepTargetX,
        12,
        step,
      );
      this.run.setGaryX(this.gary.root.position.x);
      this.run.update(step);
      remaining -= step;
    }
    this.traffic.sync(this.run.traffic.entities);
    this.friends.syncField(this.run.friends.entities, this.time, this.reducedMotion);
    this.friends.syncConga(this.run.conga.members, this.time, this.reducedMotion);

    const s = this.store.getState();
    const menuFraming = s.status === 'menu';

    this.visualSpeed = this.reducedMotion
      ? s.speed
      : MathUtils.damp(
          this.visualSpeed,
          s.speed,
          s.status === 'gameover' ? 2.2 : 1.6,
          dt,
        );
    this.road.update(dt, this.visualSpeed);
    // Event bursts need the road frame even when recurring dust is disabled
    // (for example by reduced-motion preferences).
    this.fx.setRoadSpeed(this.visualSpeed);

    // Road dust under Gary while the road is moving. Emitted on a distance
    // cadence inside `fx`, so the plume thickens with speed instead of thinning.
    if (!this.reducedMotion && s.status === 'playing') {
      this.fx.road(dt, this.gary.root.position.x, this.visualSpeed);
    } else if (!this.reducedMotion && s.status === 'gameover') {
      // The screen players linger on keeps breathing after the impact burst
      // dies: one slow curl off the wreck, sparse enough to preserve the still
      // payoff.
      this.fx.smoulder(dt, this.gary.root.position.x);
    }
    this.fx.update(dt);

    // Gary's X already advanced with the simulation substeps above; bank the
    // rendered cone toward the remainder of that same lane change.
    const targetX = laneToX(s.lane);

    if (this.deathTime !== null) {
      // ── The comedic death ────────────────────────────────────────────────
      // Every number comes from the pure `deathPose(t)` beat sheet; this only
      // applies it. Reduced motion jumps straight to the settled pose: Gary is
      // still visibly wrecked (that's information), he just doesn't bounce.
      this.deathTime += dt;
      const pose = deathPose(this.reducedMotion ? DEATH_DURATION : this.deathTime);
      this.gary.body.scale.set(pose.scaleX, pose.scaleY, pose.scaleZ);
      this.gary.root.position.set(this.deathX + pose.x, pose.y, pose.z);
      this.gary.root.rotation.set(-pose.tip, pose.spin, 0);
    } else {
      this.gary.body.scale.set(1, 1, 1);
      this.gary.root.rotation.z = MathUtils.damp(
        this.gary.root.rotation.z,
        (targetX - this.gary.root.position.x) * 0.5,
        9,
        dt,
      );
      this.gary.root.rotation.x = MathUtils.damp(this.gary.root.rotation.x, 0, 7, dt);
      this.gary.root.position.y = this.reducedMotion
        ? 0
        : 0.04 + Math.sin(this.time * 2.4) * 0.04;
      this.gary.root.rotation.y = MathUtils.damp(
        this.gary.root.rotation.y,
        menuFraming ? -0.42 : 0,
        this.reducedMotion ? 1e3 : 3.2,
        dt,
      );
    }

    this.trauma = decayTrauma(this.trauma, dt);

    // Cross-fade the hero light with the same easing as the rig move. It sits
    // front-left, which is where BOTH composed rigs sit — so it models Gary in
    // his portrait and again in his wreck, and stays out of the road lighting
    // while a run is actually under way. Dimmer on the wreck: he's had a day.
    const camLambda = this.reducedMotion ? 1e3 : 3.2;
    const wreckFraming = s.status === 'gameover';
    this.heroLight.intensity = MathUtils.damp(
      this.heroLight.intensity,
      menuFraming || wreckFraming ? HERO_LIGHT_MAX : 0,
      camLambda,
      dt,
    );

    // Near miss: a brief warm bloom on the key light and a small camera kick,
    // so squeezing past a truck is felt in the scene and not only in the HUD.
    // Pickup: a warmer, slower bloom than the near-miss kick, so collecting a
    // friend feels like the road lighting up rather than a hazard whipping past.
    if (this.friendFlash > 0.001) {
      this.friendFlash *= Math.exp(-3.4 * dt);
    } else {
      this.friendFlash = 0;
    }
    if (this.nearMissFlash > 0.001) {
      this.nearMissFlash *= Math.exp(-7 * dt);
    } else {
      this.nearMissFlash = 0;
    }
    this.key.intensity =
      KEY_LIGHT_BASE + this.nearMissFlash * 1.5 + this.friendFlash * 1.1;
    // The pickup also warms the rim light, so the whole convoy is momentarily
    // outlined — the tail is what you just made bigger, so the tail should glow.
    this.rim.intensity = RIM_LIGHT_BASE + this.friendFlash * 1.4;
  }

  /**
   * Camera: pick the rig for the current state and hand the shell the pose.
   * Menu is the hero shot, playing is the chase pose, game-over swings down
   * into the wreck shot. Because the shell damps all three, every transition
   * reads as a continuous camera move rather than a cut — and the crash's move
   * is the payoff, craning down to look at what's left of him.
   */
  cameraTarget(): CameraPose {
    const s = this.store.getState();
    const menuFraming = s.status === 'menu';
    const wreckFraming = s.status === 'gameover';
    const rig = menuFraming ? MENU_RIG : wreckFraming ? WRECK_RIG : CHASE_RIG;
    const targetX = laneToX(s.lane);
    // Composed rigs (hero, wreck) hold their framing; only the chase pose
    // tracks the lane. The wreck rig offsets from where Gary actually came to
    // rest, so the shot composes identically whichever lane he died in.
    const wreckX = this.deathX;
    const camTargetX = menuFraming
      ? rig.pos.x
      : wreckFraming
        ? rig.pos.x + wreckX
        : rig.pos.x + targetX * 0.55;
    const lookTargetX = menuFraming
      ? rig.look.x
      : wreckFraming
        ? rig.look.x + wreckX
        : this.gary.root.position.x * 0.4;

    // The convoy earns its own framing: as the conga line grows, the chase rig
    // eases back and up so the tail stays in shot instead of trailing off
    // behind the camera. The reward literally changes the composition — the
    // longer your line, the wider the shot, which is the whole fantasy made
    // visible. Composed rigs opt out: they are framing ONE cone, deliberately.
    const tail =
      menuFraming || wreckFraming
        ? 0
        : Math.min(this.run.conga.tailLength, CONGA_FRAME_MAX);

    // A near miss also lifts the lens a touch, on top of the rig.
    const kick = this.reducedMotion ? 0 : this.nearMissFlash * 0.06;

    return {
      position: {
        x: camTargetX,
        y: rig.pos.y + tail * CONGA_LIFT + kick,
        z: rig.pos.z + tail * CONGA_PULLBACK,
      },
      look: {
        x: lookTargetX,
        // As the camera rises for a long convoy, the aim drops with it:
        // otherwise the extra height would just tilt the shot up into empty sky
        // and push the tail off the bottom of the frame. Together they read as
        // craning up over the line.
        y: rig.look.y - tail * CONGA_LIFT * 0.5,
        // The aim point also drifts back toward Gary as the convoy grows.
        // Raising and retreating the camera alone still aims 19 units up the
        // road, which puts the near end of a long tail below the bottom of the
        // frame — the friends closest to Gary, i.e. the ones that just joined,
        // would be the ones you cannot see.
        z: rig.look.z + tail * CONGA_AIM_BACK,
      },
      // Reduced motion: snap to the rig instead of sweeping the viewport.
      lambda: this.reducedMotion ? 1e3 : 3.2,
      // Trauma-based (see game/fx/shake.ts): a near miss is a nudge, a crash is
      // a lurch, and both settle rather than stop.
      shake:
        this.reducedMotion || this.trauma <= 0
          ? null
          : shakeOffset(this.trauma, this.time),
    };
  }

  snapshot(): ArcadeSnapshot {
    const s = this.store.getState();
    return {
      game: this.id,
      score: s.score,
      entities: this.entityCount,
      metric: { label: 'Friends', value: s.friends },
    };
  }

  /* ── Deterministic test hooks (implementations behind window.__GARY__) ──── */

  /** How many entities are live in the world right now (traffic, friends). */
  get entityCount(): number {
    return this.run.traffic.activeCount + this.run.friends.activeCount;
  }

  /** Live particles across every fx pool. */
  get particleCount(): number {
    return this.fx.liveCount;
  }

  /** Whether Gary's death animation is currently playing. */
  get dying(): boolean {
    return this.deathTime !== null && this.deathTime < DEATH_DURATION;
  }

  /** The nearest live vehicle still ahead of Gary (null if the road is clear). */
  get nearestAhead(): NearestEntity | null {
    let nearest: { distance: number; lane: number } | null = null;
    // Traffic only: this is the "what am I about to hit" readout tests steer
    // by. A friend is something to aim FOR, so folding it in here would make
    // the dodging bots swerve away from the reward.
    for (const e of this.run.traffic.entities) {
      if (!e.active || e.z > 0) continue;
      const distance = -e.z;
      if (nearest === null || distance < nearest.distance) {
        nearest = { distance, lane: e.lane };
      }
    }
    return nearest;
  }
}
