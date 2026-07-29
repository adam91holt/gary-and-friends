/**
 * The window.__GARY__ test API — the contract Playwright (and the factory's
 * e2e iteration loop) drives the game through.
 *
 * Canvas/WebGL games expose no DOM to assert on, so this object is the seam the
 * browser tests read and poke. Readable fields are GETTERS that project from the
 * live GameStore (never a duplicated copy of state); `ready` flips true once the
 * WebGL scene has actually rendered its first frame.
 *
 * The factory EXTENDS this contract as gameplay lands. Additive changes only —
 * existing fields/methods are load-bearing for tests already written.
 *
 * ── Deterministic test hooks (pinned by the foundation ticket) ──────────────
 * Playwright can't rely on random spawns, so the game exposes hooks that force
 * specific situations. Their NAMES and SIGNATURES are fixed here so tickets
 * 02/03 fill in the behaviour without renaming and breaking each other:
 *
 *   __setLane(n)      — move Gary to lane n (0..2). Wired now.
 *   __forceCollision()— force the game into gameover. Wired now (store.gameOver).
 *   __spawnFriend()   — spawn a collectible friend. STUB until ticket 02.
 *
 * The renderer supplies the concrete implementations (see GaryTestHooks) so this
 * module stays free of game/render specifics.
 */
import type { GameStatus, GameStore } from './game/state.ts';

/** Concrete implementations wired in by the renderer (src/main.ts). */
export interface GaryTestHooks {
  /** Move Gary to lane n (clamped to the valid range by the store). */
  setLane: (n: number) => void;
  /** Force a collision -> gameover, deterministically. */
  forceCollision: () => void;
  /** Spawn a collectible friend into the world. */
  spawnFriend: () => void;
}

export interface GaryTestApi {
  /** Current high-level game state. Mirrors GameState.status. */
  readonly state: GameStatus;
  /** Current score. Mirrors GameState.score. */
  readonly score: number;
  /** Friends collected this run. Mirrors GameState.friends. */
  readonly friends: number;
  /** Which lane Gary is in (0..2). Mirrors GameState.lane. */
  readonly lane: number;
  /** Forward travel speed (world-units/sec). Mirrors GameState.speed. */
  readonly speed: number;
  /** True once the WebGL scene has rendered at least one frame. */
  readonly ready: boolean;
  /** Begin / restart play (menu|gameover -> playing). */
  start: () => void;
  /** Deterministic hook: move Gary to lane n. */
  __setLane: (n: number) => void;
  /** Deterministic hook: force a collision -> gameover. */
  __forceCollision: () => void;
  /** Deterministic hook: spawn a collectible friend (stub until ticket 02). */
  __spawnFriend: () => void;
}

declare global {
  interface Window {
    __GARY__?: GaryTestApi;
  }
}

/**
 * Install window.__GARY__, backed by the live GameStore.
 * @param store   the single source of game-logic truth
 * @param isReady callback returning whether a frame has rendered yet
 * @param hooks   renderer-supplied implementations for the deterministic hooks
 */
export function installTestApi(
  store: GameStore,
  isReady: () => boolean,
  hooks: GaryTestHooks,
): void {
  const api: GaryTestApi = {
    get state() {
      return store.getState().status;
    },
    get score() {
      return store.getState().score;
    },
    get friends() {
      return store.getState().friends;
    },
    get lane() {
      return store.getState().lane;
    },
    get speed() {
      return store.getState().speed;
    },
    get ready() {
      return isReady();
    },
    start() {
      store.start();
    },
    __setLane(n: number) {
      hooks.setLane(n);
    },
    __forceCollision() {
      hooks.forceCollision();
    },
    __spawnFriend() {
      hooks.spawnFriend();
    },
  };

  window.__GARY__ = api;
}
