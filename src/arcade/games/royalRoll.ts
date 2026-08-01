/**
 * Royal Roll — the cabinet's fourth game.
 *
 * The adapter, and only the adapter. Every rule lives in the pure simulation
 * (`src/game/games/royal-roll/`), every mesh lives in the three.js lane
 * (`src/scene/games/royal-roll/`), and this file is the seam between them and
 * the shell's `ArcadeGameRuntime` contract: it routes input into the game's own
 * guards, banks the score through the store (so the shell's per-game high-score
 * service sees it under `gary.highScore.royal-roll.v1`), turns simulation
 * events into sound and shake, and composes the shot.
 *
 * It touches no shared surface: `state.ts`, `testApi.ts`, `hud.ts`, the input
 * layer and the registry are all unchanged, and the deterministic test command
 * is declared by merging into `ArcadeCommandMap` from THIS file.
 *
 * ── The one committed idea ──────────────────────────────────────────────────
 * The camera is a broadcast unit covering a royal event, and the phase change
 * is the edit. Aiming, it sits low behind Gary on the launch line, so you sight
 * down your own throw. Committing hands the shot to a tracking camera riding
 * behind the roller. When the throw settles it becomes the REPLAY POSE — down
 * at deck level at the far end, looking back up the lane at the wreckage, with
 * the roller's trail still drawn on the floor. Three shots per throw, all
 * damped by the shell, so the round reads as coverage rather than as a form
 * updating.
 */
import { Group, MathUtils, type Scene } from 'three';
import type { GameAudio } from '../../audio.ts';
import type {
  ArcadeAction,
  ArcadeCommandMap,
  ArcadeCommandName,
  ArcadeSnapshot,
} from '../../game/arcade/contracts.ts';
import { addTrauma, decayTrauma, shakeOffset } from '../../game/fx/shake.ts';
import { LANE_MAX_Z } from '../../game/games/royal-roll/formation.ts';
import {
  clampAim,
  RoyalRoll,
  type RoyalRollPhase,
} from '../../game/games/royal-roll/simulation.ts';
import type { GameState, GameStore } from '../../game/state.ts';
import { laneZ } from '../../scene/games/royal-roll/lane.ts';
import { RoyalRollView } from '../../scene/games/royal-roll/view.ts';
import type {
  ArcadeGameRuntime,
  CameraPose,
  FrameContext,
} from '../runtime.ts';

/**
 * Royal Roll's deterministic test command, declared by merging into the shell's
 * `ArcadeCommandMap` from this file — so adding it edits no shared module (see
 * the extension-point note in `src/game/arcade/contracts.ts`).
 *
 * It sets the armed aim and NOTHING else: the throw still has to go through the
 * real `primary` action, the real launch guard and the real solver, so an E2E
 * test picks a line and then watches the game's own rules produce the result
 * instead of being handed one.
 */
declare module '../../game/arcade/contracts.ts' {
  interface ArcadeCommandMap {
    /** Set the armed aim, in radians. Clamped to the arc; aiming phase only. */
    'royal-roll:aim': { readonly angle: number };
  }
}

/**
 * Royal Roll's snapshot: the shell's generic shape plus the numbers only this
 * game has. The HUD reads `score`/`entities`/`metric` and knows nothing about
 * the rest; the e2e suite reads the rest and asserts the real rules ran.
 */
export interface RoyalRollSnapshot extends ArcadeSnapshot {
  readonly game: 'royal-roll';
  /** What the game is doing: aiming, rolling, or holding the result. */
  readonly phase: RoyalRollPhase;
  /** The armed launch angle, radians. 0 is straight down the lane. */
  readonly aimAngle: number;
  /** Which throw is being played (1-based). */
  readonly throwNumber: number;
  /** Throws in a run. */
  readonly throwLimit: number;
  /** Cones felled across the whole run. */
  readonly targetsDown: number;
  /** Cones still on their feet. */
  readonly standing: number;
  /** Where the roller is, and how fast — lane-local, straight off the solver. */
  readonly roller: {
    readonly x: number;
    readonly z: number;
    readonly speed: number;
  };
}

/** Trauma added when the roller thumps into the rack. */
const IMPACT_TRAUMA = 0.22;
/** Trauma added when the King goes over. The biggest knock in the game. */
const ROYAL_TRAUMA = 0.6;
/** Below this closing speed a contact is a nudge: no cue, no shake. */
const AUDIBLE_IMPACT = 2.5;

/** The three rigs (see the file header). Lane-local, converted through laneZ. */
/**
 * The aim pose. High enough over Gary's shoulder that the guide lies open on
 * the deck rather than edge-on: at eye level the whole aim fan foreshortens
 * into a couple of pixels behind his own body, which makes the one instrument
 * the game is played through unreadable.
 */
const AIM_RIG = {
  pos: { x: 0, y: 3.15, z: 4.9 },
  look: { x: 0, y: 0.35, z: laneZ(6.6) },
} as const;
const TRACK_RIG = {
  /** How high and how far behind the roller the tracking camera rides. */
  height: 2.5,
  behind: 4.2,
  /** How far past the roller the lens aims, so the rack grows in frame. */
  ahead: 3.2,
} as const;
/**
 * The replay pose: over the left barrier at mid-lane, low and close, looking
 * down at the rack.
 *
 * Deliberately NOT a trip to the far end past the arch. That version framed the
 * lane beautifully and felt awful: a twenty-unit round trip every throw meant
 * the camera was still flying home when the next aim was already armed. This is
 * a shorter, side-on move — the second camera in the truck, not a helicopter.
 */
const RESULT_RIG = {
  pos: { x: -2.7, y: 1.4, z: laneZ(4.1) },
  look: { x: 0.2, y: 0.45, z: laneZ(8.2) },
} as const;

export interface RoyalRollDeps {
  readonly store: GameStore;
  readonly audio: GameAudio;
}

export class RoyalRollRuntime implements ArcadeGameRuntime {
  readonly id = 'royal-roll' as const;
  readonly root = new Group();

  private readonly store: GameStore;
  private readonly audio: GameAudio;
  private readonly view = new RoyalRollView();
  private readonly game: RoyalRoll;

  private reducedMotion = false;
  private time = 0;
  private trauma = 0;
  /**
   * Where the last throw came to rest. Captured on settle so the replay pose
   * composes around the line that was actually thrown rather than around a
   * fixed spot the roller may be nowhere near.
   */
  private resultX = 0;
  private resultZ = 0;
  /** Eased 0..1 blend into the replay pose across the settle beat. */
  private resultBlend = 0;
  private previousState: GameState;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: RoyalRollDeps) {
    this.store = deps.store;
    this.audio = deps.audio;
    this.previousState = this.store.getState();

    this.game = new RoyalRoll({
      events: {
        onLaunch: () => {
          this.audio.start();
          this.view.trail.clear();
        },
        onImpact: (x, z, strength) => {
          this.view.impactFx(x, z, strength, this.reducedMotion);
          if (strength <= AUDIBLE_IMPACT) return;
          this.audio.lane();
          // Scaled by the closing speed the solver actually resolved: the feel
          // layer cannot exaggerate a hit that did not happen.
          this.trauma = addTrauma(
            this.trauma,
            IMPACT_TRAUMA * Math.min(1, strength / 7),
          );
        },
        onBarrier: (x, z, strength) => {
          this.view.barrierFx(x, z, strength, this.reducedMotion);
        },
        onKnock: (target) => {
          this.view.knockFx(target, this.reducedMotion);
          if (target.royal) {
            this.audio.crash();
            this.trauma = addTrauma(this.trauma, ROYAL_TRAUMA);
          } else {
            this.audio.friend();
          }
        },
        onSettled: (result) => {
          this.resultX = this.game.roller.x;
          this.resultZ = this.game.roller.z;
          this.resultBlend = 0;
          // Banked through the store, so the shell's record service sees this
          // run under the game's own key without either side special-casing it.
          if (result.total > 0) this.store.addScore(result.total);
          if (result.cleared) this.audio.highScore();
        },
        onGameOver: () => {
          this.store.gameOver();
        },
      },
    });

    this.root.add(this.view.group);
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

  /** Back to throw one against a full rack, with a swept deck and no fx. */
  reset(): void {
    this.game.reset();
    this.view.reset();
    this.trauma = 0;
    this.resultBlend = 0;
    this.resultX = 0;
    this.resultZ = 0;
    // Draw the fresh rack immediately, so a reset lane is never a blank frame.
    this.view.sync(this.game, 0, this.time, this.reducedMotion);
  }

  /**
   * ← → swing the aim, `primary` commits the throw.
   *
   * Both go through the simulation's own guards, so an input arriving mid-roll
   * is refused by the game rule rather than by a flag in this file.
   */
  handleInput(action: ArcadeAction): void {
    if (this.store.getState().status !== 'playing') return;
    if (action === 'left') {
      if (this.game.adjustAim(-1)) this.audio.lane();
    } else if (action === 'right') {
      if (this.game.adjustAim(1)) this.audio.lane();
    } else if (action === 'primary') {
      this.audio.unlock();
      this.game.launch();
    }
  }

  update(ctx: FrameContext): void {
    this.reducedMotion = ctx.reducedMotion;
    this.time = ctx.time;

    // The simulation advances only during a live run: on the menu and on the
    // game-over card the lane is a still life, which is what makes the wreckage
    // of a ten-throw run worth leaving on screen under the card.
    if (this.store.getState().status === 'playing') this.game.update(ctx.dt);

    this.view.sync(this.game, ctx.dt, ctx.time, ctx.reducedMotion);

    const wantResult = this.game.phase === 'settling' ? 1 : 0;
    this.resultBlend = ctx.reducedMotion
      ? wantResult
      : MathUtils.damp(this.resultBlend, wantResult, wantResult === 1 ? 4.5 : 6, ctx.dt);

    this.trauma = decayTrauma(this.trauma, ctx.dt);
  }

  /**
   * The shell's generic slots, plus this game's own numbers.
   *
   * `score` comes from the store (so the HUD, the record service and the test
   * API can never disagree) and `entities` is the cones still standing. The one
   * generic instrument is CONES FELLED rather than the throw number, because
   * the throws you have left are already an instrument in the world (the crown
   * pips down the left barrier) and because "throw 10 of 10" is a useless
   * headline on the game-over card while "31 cones" is the result itself.
   */
  snapshot(): RoyalRollSnapshot {
    return {
      game: this.id,
      score: this.store.getState().score,
      entities: this.game.standingCount,
      metric: { label: 'Cones', value: this.game.targetsDown },
      phase: this.game.phase,
      aimAngle: this.game.aimAngle,
      throwNumber: this.game.throwNumber,
      throwLimit: this.game.throwLimitCount,
      targetsDown: this.game.targetsDown,
      standing: this.game.standingCount,
      roller: {
        x: this.game.roller.x,
        z: this.game.roller.z,
        speed: Math.hypot(this.game.roller.vx, this.game.roller.vz),
      },
    };
  }

  handleCommand<K extends ArcadeCommandName>(
    name: K,
    payload: ArcadeCommandMap[K],
  ): boolean {
    if (name !== 'royal-roll:aim') return false;
    const { angle } = payload as ArcadeCommandMap['royal-roll:aim'];
    // Through the real `setAim`, so the aiming-phase guard and the arc clamp
    // both apply exactly as they do to a keypress.
    this.game.setAim(clampAim(angle));
    return true;
  }

  /**
   * Camera: aim pose → tracking pose → replay pose (see the file header).
   *
   * Reduced motion collapses all three to the aim pose and asks for an instant
   * lambda, so the lane never sweeps and nothing shakes: the aim, the phase and
   * the knocked cones stay exactly as legible, the viewport just stops moving
   * to say so.
   */
  cameraTarget(): CameraPose {
    if (this.reducedMotion) {
      return { position: AIM_RIG.pos, look: AIM_RIG.look, lambda: 1e3, shake: null };
    }

    const rolling = this.game.phase === 'rolling';
    const rollerSceneZ = laneZ(this.game.roller.z);

    // Rolling: ride behind and above the roller, aiming past it, so the rack
    // grows in frame as the throw closes on it.
    const basePos = rolling
      ? {
          x: this.game.roller.x * 0.45,
          y: TRACK_RIG.height,
          z: rollerSceneZ + TRACK_RIG.behind,
        }
      : AIM_RIG.pos;
    const baseLook = rolling
      ? {
          x: this.game.roller.x * 0.5,
          y: 0.45,
          z: rollerSceneZ - TRACK_RIG.ahead,
        }
      : AIM_RIG.look;

    // The replay pose is blended in across the settle beat rather than cut to,
    // so the end of a throw reads as the camera being handed over. It leans
    // toward wherever the throw actually finished, so a line down the left is
    // reviewed from further left.
    const blend = this.resultBlend;
    const resultPosX = RESULT_RIG.pos.x + this.resultX * 0.35;
    const resultLookZ = laneZ(
      Math.min(LANE_MAX_Z, Math.max(6, this.resultZ + 0.8)),
    );

    return {
      position: {
        x: MathUtils.lerp(basePos.x, resultPosX, blend),
        y: MathUtils.lerp(basePos.y, RESULT_RIG.pos.y, blend),
        z: MathUtils.lerp(basePos.z, RESULT_RIG.pos.z, blend),
      },
      look: {
        x: MathUtils.lerp(baseLook.x, RESULT_RIG.look.x + this.resultX * 0.3, blend),
        y: MathUtils.lerp(baseLook.y, RESULT_RIG.look.y, blend),
        z: MathUtils.lerp(baseLook.z, resultLookZ, blend),
      },
      // The tracking shot is looser than the composed poses: a camera that
      // snapped to a moving roller would read as a cursor, not a camera.
      lambda: rolling ? 2.4 : 3.4,
      shake: this.trauma <= 0 ? null : shakeOffset(this.trauma, this.time),
    };
  }

  private onStateChange(state: GameState): void {
    const previous = this.previousState;
    this.previousState = state;
    if (state.status === previous.status) return;
    // Start/restart and an explicit store reset both rebuild the whole lane.
    if (state.status === 'playing' || state.status === 'menu') this.reset();
  }
}

/** The registry's factory, matching the shape the placeholder exported. */
export function createRoyalRollRuntime(deps: RoyalRollDeps): ArcadeGameRuntime {
  return new RoyalRollRuntime(deps);
}
