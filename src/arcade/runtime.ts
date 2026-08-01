/**
 * The runtime contract every game in the cabinet implements, plus the registry
 * that hands the shell whichever one is selected.
 *
 * This is the render-side seam. `src/main.ts` owns the common services — the
 * renderer, the camera, the store, audio, high scores, input, the HUD shell,
 * resize and the frame loop — and knows NOTHING about any particular game. A
 * runtime owns its own scene contents, its own simulation and its own feel, and
 * talks to the shell only through the methods below.
 *
 * The lifecycle, in the order the shell calls it:
 *
 *   enter()          once, when the player opens the game from the menu
 *   reset()          on every menu|gameover -> playing transition
 *   update(dt, ctx)  once a frame while the game is on screen
 *   handleInput(a)   on every normalized action routed to the runtime
 *   snapshot()       whenever the HUD or the test API wants to read state
 *   cameraTarget()   once a frame, to compose the shot
 *   leave()          once, when the player goes back to the menu
 *
 * `enter`/`leave` must be symmetric: a game that adds meshes to the scene in
 * `enter` removes them in `leave`, so switching games twice leaves nothing
 * behind. The shell asserts nothing about this; the runtimes are trusted, and
 * `e2e/arcade-menu.spec.ts` walks in and out of every one of them to prove it.
 */
import type { Object3D, Scene } from 'three';
import type {
  ArcadeCommandMap,
  ArcadeCommandName,
  ArcadeSnapshot,
  ArcadeAction,
  GameId,
} from '../game/arcade/contracts.ts';

/** A three-component vector, as plain data. Poses are values, not objects. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A camera pose: where the lens is and what it is aimed at. */
export interface CameraPose {
  readonly position: Vec3;
  readonly look: Vec3;
  /**
   * Damping lambda for this pose. Higher snaps harder. The shell multiplies
   * nothing in — a runtime that wants an instant cut asks for a huge lambda,
   * and the shell still honours reduced motion on top.
   */
  readonly lambda: number;
  /**
   * A displacement applied AFTER damping and after the camera is aimed, so a
   * knock never fights the framing logic — it shifts the composed shot rather
   * than becoming a target the damping then chases. `roll` tilts the horizon.
   * Null when nothing is shaking.
   */
  readonly shake: { readonly x: number; readonly y: number; readonly roll: number } | null;
}

/** What the shell tells a runtime on every tick. */
export interface FrameContext {
  /** Seconds since the previous frame, already clamped by the shell. */
  readonly dt: number;
  /** Seconds since boot. Shared clock, so wobbles across games stay in phase. */
  readonly time: number;
  /** Whether the player asked for reduced motion. Runtimes must honour it. */
  readonly reducedMotion: boolean;
}

/**
 * A playable (or placeholder) game.
 *
 * Note the deliberate omission: a runtime never receives the renderer, never
 * calls `requestAnimationFrame`, and never touches `localStorage`. Those are
 * shell services, and keeping them out is what makes four games coexist.
 */
export interface ArcadeGameRuntime {
  /** Which catalog entry this implements. */
  readonly id: GameId;
  /**
   * This game's scene subtree. The shell adds it to the scene on `enter` and
   * removes it on `leave`; a runtime should hang everything it draws off here
   * rather than adding to the scene directly.
   */
  readonly root: Object3D;
  /** Called once when the game is opened. Build/attach what is expensive here. */
  enter(scene: Scene): void;
  /** Called once when the game is closed. Undo exactly what `enter` did. */
  leave(scene: Scene): void;
  /** Return to a clean, playable state. Called on every run start/restart. */
  reset(): void;
  /** Advance one frame. Called while the game is on screen, in any status. */
  update(ctx: FrameContext): void;
  /** Receive a normalized action the shell routed here. */
  handleInput(action: ArcadeAction): void;
  /** Report the game's current state to the HUD and the test API. */
  snapshot(): ArcadeSnapshot;
  /** The shot this game wants right now. The shell damps toward it. */
  cameraTarget(): CameraPose;
  /**
   * Optional deterministic test commands, declared by the game itself through
   * `ArcadeCommandMap` declaration merging (see contracts.ts). Returns whether
   * the command was handled, so `window.__GARY__.command()` can tell a test
   * "that game doesn't know that command" instead of failing silently.
   */
  handleCommand?<K extends ArcadeCommandName>(
    name: K,
    payload: ArcadeCommandMap[K],
  ): boolean;
}

/**
 * The cabinet's runtime registry.
 *
 * Games are registered eagerly (all four modules are tiny and three of them are
 * placeholders), but only the ACTIVE one is entered — so an unopened game costs
 * a constructor call and nothing else.
 */
export class RuntimeRegistry {
  private readonly runtimes = new Map<GameId, ArcadeGameRuntime>();
  private active: ArcadeGameRuntime | null = null;

  constructor(private readonly scene: Scene) {}

  /** Add a runtime to the cabinet. Later registrations replace earlier ones. */
  register(runtime: ArcadeGameRuntime): void {
    this.runtimes.set(runtime.id, runtime);
  }

  /** Whether a game has a runtime at all. */
  has(id: GameId): boolean {
    return this.runtimes.has(id);
  }

  /** The runtime currently entered, or null before the first `activate`. */
  get current(): ArcadeGameRuntime | null {
    return this.active;
  }

  /**
   * Make `id` the entered runtime: leave whatever was on screen, enter the new
   * one, reset it to a clean state. Idempotent — activating the already-active
   * game does nothing, so the shell can call it from a store subscription
   * without churning scene graphs.
   */
  activate(id: GameId): ArcadeGameRuntime {
    const next = this.runtimes.get(id);
    if (!next) throw new Error(`No runtime registered for game: ${id}`);
    if (this.active === next) return next;

    if (this.active) this.active.leave(this.scene);
    this.active = next;
    next.enter(this.scene);
    next.reset();
    return next;
  }
}
