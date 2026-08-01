/**
 * Bartholocone's Big Bounce — the cabinet's third runtime.
 *
 * The seam, exactly as `runtime.ts` describes it: the pure simulation lives in
 * `src/game/games/coneball/` and the scene lives in
 * `src/scene/games/coneball/`. This file is the adapter between them and the
 * shell — lifecycle, input, camera and the snapshot — and it contains no game
 * rules of its own beyond deciding how a rule FEELS.
 *
 * Nothing outside this file and `src/game/arcade/catalog.ts` changes to bring
 * the game online: the per-game test command is declared here by merging into
 * `ArcadeCommandMap` (see contracts.ts), so `src/testApi.ts`, `main.ts`,
 * `state.ts`, `hud.ts` and the registry are all untouched.
 */
import { Group, type Scene } from 'three';
import type { GameAudio } from '../../audio.ts';
import type {
  ArcadeAction,
  ArcadeCommandMap,
  ArcadeCommandName,
} from '../../game/arcade/contracts.ts';
import {
  MAX_RETURN_ANGLE,
  PADDLE_HALF_WIDTH,
  PADDLE_Z,
  START_LIVES,
} from '../../game/games/coneball/arena.ts';
import {
  ConeballSim,
  type ConeballPlacement,
  type ConeballSnapshot,
} from '../../game/games/coneball/sim.ts';
import {
  addTrauma,
  decayTrauma,
  shakeOffset,
} from '../../game/fx/shake.ts';
import type { GameState, GameStore } from '../../game/state.ts';
import { ConeballView } from '../../scene/games/coneball/view.ts';
import type {
  ArcadeGameRuntime,
  CameraPose,
  FrameContext,
} from '../runtime.ts';

/**
 * Big Bounce's deterministic test commands, declared by merging into the map
 * the foundation ticket reserved. This is why `src/testApi.ts` needs no edit:
 * `window.__GARY__.command('coneball:place', …)` is type-checked off this.
 */
declare module '../../game/arcade/contracts.ts' {
  interface ArcadeCommandMap {
    /**
     * Put the ball (and optionally the board) somewhere specific and let the
     * NORMAL rules resolve whatever happens next. It sets up a situation; it
     * never asserts an outcome — the ball still has to genuinely reach the
     * board through the swept solver to score a rally, genuinely reach a drum
     * to smash it, and genuinely cross the miss line to cost a life.
     */
    'coneball:place': ConeballPlacement;
    /** Let the ball go, exactly as the primary action does. */
    'coneball:serve': undefined;
  }
}

/**
 * Trauma per event. Deliberately quieter than the highway's crash: this screen
 * shakes several times a rally, so the same amplitude would be unreadable.
 */
const RETURN_TRAUMA = 0.14;
const TARGET_TRAUMA = 0.2;
const WALL_TRAUMA = 0.06;
const MISS_TRAUMA = 0.5;
/** A slimmer amplitude than the highway's, for the same reason. */
const SHAKE_AMPLITUDE = 0.16;

/**
 * The two camera rigs, eased between on state change — the same idea the
 * highway commits to, applied to a court.
 *
 * The MENU rig is a low three-quarter shot from the player's corner, composed
 * off to the RIGHT of frame like every other slot (the panel docks left), so
 * you meet Bartholocone and the wall of drums before you play them. Starting a
 * run swings up and back into the PLAY rig: high behind the board, looking up
 * the court, which is the only pose from which a ball's line is readable.
 */
const MENU_RIG = {
  pos: { x: -1.1, y: 1.5, z: 7.4 },
  look: { x: -2.4, y: 1.1, z: 0.4 },
} as const;
const PLAY_RIG = {
  pos: { x: 0, y: 6.5, z: 10.4 },
  look: { x: 0, y: 0.4, z: -1.8 },
} as const;
/**
 * Game-over: crane down and in behind the board, so the last thing you look at
 * is the empty court from Bartholocone's own eyeline — the ball is not coming
 * back, and the shot says so.
 */
const OVER_RIG = {
  pos: { x: 0, y: 2.5, z: 8.2 },
  look: { x: 0, y: 0.7, z: -2.6 },
} as const;

/**
 * The two shell services this game needs, injected exactly as the highway's
 * are. A runtime never reaches for a singleton: the store is the single source
 * of game-logic truth and the shell owns it, so it is handed over, not grabbed.
 */
export interface ConeballDeps {
  readonly store: GameStore;
  readonly audio: GameAudio;
}

export class ConeballRuntime implements ArcadeGameRuntime {
  readonly id = 'coneball' as const;
  readonly root = new Group();

  private readonly store: GameStore;
  private readonly audio: GameAudio;
  private readonly view = new ConeballView();
  /** The pure simulation. This class only ticks it and draws what it says. */
  readonly sim: ConeballSim;

  private trauma = 0;
  private reducedMotion = false;
  private time = 0;
  /** 0..1, lit on a miss so the camera recoils with the loss. */
  private missFlash = 0;

  private previousState: GameState;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: ConeballDeps) {
    this.store = deps.store;
    this.audio = deps.audio;
    this.previousState = this.store.getState();

    this.sim = new ConeballSim(this.store, {
      events: {
        onServe: () => {
          this.view.onServe();
          this.audio.lane();
        },
        onReturn: (x) => {
          this.view.onReturn(x, this.sim.paddleX, PADDLE_HALF_WIDTH);
          this.trauma = addTrauma(this.trauma, RETURN_TRAUMA);
          this.audio.nearMiss();
        },
        onWall: (x, z) => {
          this.view.onWall(x, z);
          this.trauma = addTrauma(this.trauma, WALL_TRAUMA);
        },
        onTarget: (target) => {
          this.view.onTarget(target);
          this.trauma = addTrauma(this.trauma, TARGET_TRAUMA);
          this.audio.friend();
        },
        onWaveClear: () => {
          this.audio.highScore();
        },
        onMiss: (x) => {
          this.view.onMiss(x);
          this.trauma = addTrauma(this.trauma, MISS_TRAUMA);
          this.missFlash = 1;
          this.audio.crash();
        },
      },
    });

    this.root.add(this.view.root);
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
   * Back to a clean, drawable court: everything the simulation owns plus
   * everything the *renderer* owns, so a restart can never leave last run's
   * sparks, a half-popped drum or a stale ball trail over a fresh court.
   */
  reset(): void {
    this.sim.reset();
    this.view.reset();
    this.trauma = 0;
    this.missFlash = 0;
  }

  handleInput(action: ArcadeAction): void {
    if (this.store.getState().status !== 'playing') return;
    switch (action) {
      case 'left':
        this.audio.unlock();
        this.sim.moveBoard(-1);
        break;
      case 'right':
        this.audio.unlock();
        this.sim.moveBoard(1);
        break;
      case 'primary':
        // The serve verb. Inert mid-rally — `serve()` refuses when the ball is
        // already live, so mashing it can never fire a second ball.
        this.audio.unlock();
        this.sim.serve();
        break;
      // Up/down have no meaning on a court that only slides sideways, and
      // `back` is the shell's, never the game's.
      case 'up':
      case 'down':
      case 'back':
        break;
    }
  }

  private onStateChange(state: GameState): void {
    const previous = this.previousState;
    if (state.status !== previous.status) {
      if (state.status === 'playing' || state.status === 'menu') {
        this.reset();
        if (state.status === 'playing') this.audio.start();
      }
    }
    this.previousState = state;
  }

  update(ctx: FrameContext): void {
    this.reducedMotion = ctx.reducedMotion;
    this.time = ctx.time;

    // The simulation runs itself on fixed substeps; the shell's dt is only ever
    // handed over, never interpreted here.
    this.sim.update(ctx.dt);
    this.view.update(this.sim, ctx.dt, ctx.time, ctx.reducedMotion);

    this.trauma = decayTrauma(this.trauma, ctx.dt);
    this.missFlash = this.missFlash > 0.001 ? this.missFlash * Math.exp(-2.2 * ctx.dt) : 0;
  }

  /**
   * Camera: the menu's hero shot, the play rig high behind the board, and a
   * craned-down game-over pose. All three damped by the shell, so every
   * transition reads as one continuous move rather than a cut.
   *
   * While playing, the rig also drifts a little with the ball — a fraction of
   * its lateral position, never a full follow. A camera that tracked the ball
   * one-for-one would hold it dead centre and destroy the only cue the player
   * has for reading its angle: its movement against the court.
   */
  cameraTarget(): CameraPose {
    const status = this.store.getState().status;
    const rig =
      status === 'menu' ? MENU_RIG : status === 'gameover' ? OVER_RIG : PLAY_RIG;

    const tracking = status === 'playing' ? 1 : 0;
    const ballX = this.sim.ball.x * 0.13 * tracking;
    // The shot pulls back a touch as the ball retreats up the court, so the far
    // row of drums stays framed with it.
    const depth = tracking
      ? Math.max(0, -this.sim.ball.z) * 0.06 + this.missFlash * 0.5
      : 0;

    return {
      position: {
        x: rig.pos.x + ballX,
        y: rig.pos.y + depth * 0.35,
        z: rig.pos.z + depth,
      },
      look: {
        x: rig.look.x + ballX * 1.4,
        y: rig.look.y,
        z: rig.look.z,
      },
      lambda: this.reducedMotion ? 1e3 : 3.4,
      shake:
        this.reducedMotion || this.trauma <= 0
          ? null
          : shakeOffset(this.trauma, this.time, SHAKE_AMPLITUDE),
    };
  }

  /**
   * The generic HUD slots, filled with Big Bounce's own numbers: the score is
   * the store's, and the headline metric is the rally — the thing the whole
   * risk/reward argument of the game turns on.
   *
   * Lives ride along in the typed snapshot rather than in the metric slot: the
   * HUD renders exactly one metric, and a rally you are building is a more
   * useful thing to watch than a countdown you already know.
   */
  snapshot(): ConeballSnapshot {
    return this.sim.snapshot(this.store.getState().score);
  }

  /**
   * Deterministic test commands. Both go through the real rules — `place`
   * positions the ball and lets the swept solver decide what it meets,
   * `serve` is the same call the primary action makes.
   */
  handleCommand<K extends ArcadeCommandName>(
    name: K,
    payload: ArcadeCommandMap[K],
  ): boolean {
    // Outside a run there is no court to place anything on, and a test that
    // thinks it set something up would be asserting against a menu.
    if (this.store.getState().status !== 'playing') return false;
    switch (name) {
      case 'coneball:serve':
        return this.sim.serve();
      case 'coneball:place':
        // `name` narrows the map lookup, so this really is the placement type.
        return this.sim.placeBall(payload as ArcadeCommandMap['coneball:place']);
      default:
        // Some other game's command, or the shell's reserved no-op. Reported
        // honestly as unhandled rather than silently swallowed.
        return false;
    }
  }

  /* ── Read-only projections, for the shell and the e2e suite ─────────────── */

  /** Live particles across the view's spark pools. */
  get particleCount(): number {
    return this.view.particleCount;
  }

  /** Lives left this run. */
  get lives(): number {
    return this.sim.lives;
  }
}

/** Build the runtime. Named like the placeholders it replaces, so main.ts holds. */
export function createConeballRuntime(deps: ConeballDeps): ArcadeGameRuntime {
  return new ConeballRuntime(deps);
}

/** Re-exported so a consumer can size a HUD without importing the arena. */
export { MAX_RETURN_ANGLE, PADDLE_Z, START_LIVES };
export type { ConeballSnapshot };
