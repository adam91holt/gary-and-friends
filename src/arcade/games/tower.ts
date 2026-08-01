/**
 * Stack Attack — the cabinet's second runtime.
 *
 * A carriage runs a gantry above a growing tower; the primary action drops the
 * cast member it is carrying. Land it on the stack and the tower grows; land it
 * sloppily and the overhang is sheared off, narrowing what the next drop has to
 * hit; miss entirely and the run is over. There is no steering — the only input
 * is WHEN — which is what makes it a genuinely different mechanic from the
 * highway rather than a re-skin.
 *
 * This file is the adapter, and deliberately thin. The rules live in
 * `src/game/games/tower/` (pure, Vitest-covered, no three/DOM) and the diorama
 * lives in `src/scene/games/tower/` (three only, decides nothing). Everything
 * here does is wire the lifecycle: enter/leave the scene, reset both halves,
 * tick the simulation and then the view, route the primary action into a drop,
 * report a snapshot, and ask the shell for a camera pose.
 *
 * Nothing outside this file changes: the score banks to
 * `gary.highScore.tower.v1` through the shell's existing per-game high-score
 * service (it keys off `GameState.selectedGame`), the HUD draws height and
 * combo through its generic metric slot, and the deterministic test command is
 * declared by merging into `ArcadeCommandMap` from the tower's own module.
 */
import { Group, type Scene } from 'three';
import type { GameAudio } from '../../audio.ts';
import type {
  ArcadeAction,
  ArcadeCommandMap,
  ArcadeCommandName,
} from '../../game/arcade/contracts.ts';
import { addTrauma, decayTrauma, shakeOffset } from '../../game/fx/shake.ts';
import type { TowerSnapshot } from '../../game/games/tower/snapshot.ts';
import { TowerGame, type DropOutcome } from '../../game/games/tower/stack.ts';
import type { GameState, GameStore } from '../../game/state.ts';
import { TowerView } from '../../scene/games/tower/view.ts';
import type {
  ArcadeGameRuntime,
  CameraPose,
  FrameContext,
} from '../runtime.ts';

// Side-effect import of the module that declares `tower:carrier` on the shared
// command map. Importing the types alone would not merge the declaration.
import '../../game/games/tower/snapshot.ts';

/** Trauma added when a cone touches down. Felt, never disorienting. */
const LANDING_TRAUMA = 0.14;
/** Trauma added on a perfect landing — a happy bump, on top of the landing. */
const PERFECT_TRAUMA = 0.1;
/** Trauma added when the run ends. The one moment the frame may lurch. */
const MISS_TRAUMA = 0.85;

/**
 * Bound slow frames so the carriage cannot cross the whole perfect window
 * before an input is observed. Matches the highway's reasoning: a modest
 * catch-up allowance avoids time dilation under contention while keeping the
 * game genuinely timeable at low framerates.
 */
const SIMULATION_STEP = 0.02;

export interface TowerDeps {
  readonly store: GameStore;
  readonly audio: GameAudio;
}

export class TowerRuntime implements ArcadeGameRuntime {
  readonly id = 'tower' as const;
  readonly root = new Group();

  /** The simulation. Pure logic; this class only ticks it and draws what it says. */
  readonly game: TowerGame;

  private readonly store: GameStore;
  private readonly audio: GameAudio;
  private readonly view: TowerView;

  /** Camera trauma (see game/fx/shake.ts). Events add, the loop bleeds it off. */
  private trauma = 0;
  private reducedMotion = false;
  private time = 0;

  private previousState: GameState;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: TowerDeps) {
    this.store = deps.store;
    this.audio = deps.audio;
    this.previousState = this.store.getState();

    this.game = new TowerGame(this.store, {
      onDrop: (outcome) => this.onDrop(outcome),
    });
    this.view = new TowerView(this.game);
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

  /** Back to a clean, drawable yard: simulation AND renderer state. */
  reset(): void {
    this.game.reset();
    this.view.reset();
    this.trauma = 0;
  }

  handleInput(action: ArcadeAction): void {
    // Stack Attack is a pure timing game: `primary` is the entire control
    // scheme, and the directional axes are deliberately inert. There is no lane
    // to change and no paddle to steer — letting an arrow key nudge the
    // carriage would quietly turn it into an aiming game.
    if (action !== 'primary') return;
    if (this.store.getState().status !== 'playing') return;
    this.audio.unlock();
    if (this.game.drop()) this.audio.lane();
  }

  update(ctx: FrameContext): void {
    this.reducedMotion = ctx.reducedMotion;
    this.time = ctx.time;

    // Catch the simulation up in small steps before drawing, so a hitched frame
    // resolves a drop against the same carriage path a 60fps frame would.
    let remaining = ctx.dt;
    while (remaining > 0) {
      const step = Math.min(remaining, SIMULATION_STEP);
      this.game.update(step);
      remaining -= step;
    }

    this.view.update(ctx.dt, ctx.time, ctx.reducedMotion);
    this.trauma = decayTrauma(this.trauma, ctx.dt);
  }

  snapshot(): TowerSnapshot {
    const state = this.store.getState();
    return {
      game: this.id,
      score: state.score,
      // Live objects in the yard: the pieces standing in the tower plus the
      // cone in the air. The pad is scenery, not an entity.
      entities: this.game.stackHeight + (this.game.fallingCone ? 1 : 0),
      metric: { label: 'Height', value: this.game.stackHeight },
      height: this.game.stackHeight,
      combo: this.game.combo,
      carrierX: this.game.carrierX,
      falling: this.game.fallingCone !== null,
    };
  }

  cameraTarget(): CameraPose {
    const pose = this.view.cameraPose(this.store.getState().status);
    return {
      position: pose.position,
      look: pose.look,
      // Reduced motion: snap to the framing instead of craning the viewport.
      lambda: this.reducedMotion ? 1e3 : 2.4,
      shake:
        this.reducedMotion || this.trauma <= 0
          ? null
          : shakeOffset(this.trauma, this.time),
    };
  }

  /**
   * The deterministic test command. It parks the carriage and nothing else —
   * the drop that follows goes through the real `drop()` and the real landing
   * rule, so an e2e test that stacks five cones has genuinely stacked five
   * cones. Returns false for a command this game doesn't know, so the shell can
   * report "not handled" honestly.
   */
  handleCommand<K extends ArcadeCommandName>(
    name: K,
    payload: ArcadeCommandMap[K],
  ): boolean {
    if (name !== 'tower:carrier') return false;
    const command = payload as ArcadeCommandMap['tower:carrier'];
    if (typeof command?.x !== 'number' || !Number.isFinite(command.x)) {
      return false;
    }
    return command.direction === undefined
      ? this.game.placeCarrier(command.x)
      : this.game.placeCarrier(command.x, command.direction);
  }

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  private onStateChange(state: GameState): void {
    const previous = this.previousState;
    if (state.status !== previous.status) {
      if (state.status === 'playing' || state.status === 'menu') {
        this.reset();
        if (state.status === 'playing') this.audio.start();
      }
      if (state.status === 'gameover') {
        this.audio.crash();
        this.trauma = addTrauma(this.trauma, MISS_TRAUMA);
      }
    }
    this.previousState = state;
  }

  /**
   * A drop resolved. The simulation says what happened; this decides how it
   * feels — the cue, the shake, and (via the view) the dust and the flash.
   */
  private onDrop(outcome: DropOutcome): void {
    this.view.onDrop(outcome);
    if (!outcome.landed) return; // the gameover transition owns that moment

    this.trauma = addTrauma(
      this.trauma,
      LANDING_TRAUMA + (outcome.perfect ? PERFECT_TRAUMA : 0),
    );
    // A perfect landing is one of only two rising cues in the game, so it is
    // audibly the good thing — the same rule the highway's pickup chirp follows.
    if (outcome.perfect) this.audio.friend();
    else this.audio.nearMiss();
  }
}

/** Build the tower runtime. Called once by the shell's registry block. */
export function createTowerRuntime(deps: TowerDeps): ArcadeGameRuntime {
  return new TowerRuntime(deps);
}
