/**
 * The window.__GARY__ test API — the contract Playwright (and the factory's
 * e2e iteration loop) drives the game through.
 *
 * Canvas/WebGL games expose no DOM to assert on, so this object is the seam the
 * browser tests read and poke. Keep it in sync with the GameStore: `state` and
 * `score` are projections of GameState, `ready` flips true once the WebGL scene
 * has actually rendered its first frame.
 *
 * The factory EXTENDS this contract as gameplay lands (new readable fields, new
 * methods). Additive changes only — existing fields/methods are load-bearing for
 * tests already written.
 */
import type { GameStatus, GameStore } from './game/state.ts';

export interface GaryTestApi {
  /** Current high-level game state. Mirrors GameState.status. */
  readonly state: GameStatus;
  /** Current score. Mirrors GameState.score. */
  readonly score: number;
  /** True once the WebGL scene has rendered at least one frame. */
  readonly ready: boolean;
  /** Begin play (menu|gameover -> playing). */
  start: () => void;
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
 */
export function installTestApi(store: GameStore, isReady: () => boolean): void {
  const api: GaryTestApi = {
    get state() {
      return store.getState().status;
    },
    get score() {
      return store.getState().score;
    },
    get ready() {
      return isReady();
    },
    start() {
      store.start();
    },
  };

  window.__GARY__ = api;
}
