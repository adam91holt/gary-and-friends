/**
 * Pure game-state store. NO three.js / DOM imports allowed in this file.
 *
 * This is the game-logic side of the logic/rendering seam: everything here is
 * synchronous, deterministic, and unit-testable under Vitest without a browser
 * or a WebGL context. The renderer (src/main.ts) subscribes to this store and
 * draws whatever the state says; it never owns game state itself.
 *
 * The factory extends THIS module (new fields, actions, transitions) as gameplay
 * lands, and mirrors any test-relevant additions into window.__GARY__ (see
 * src/testApi.ts).
 */

export type GameStatus = 'menu' | 'playing' | 'gameover';

export interface GameState {
  readonly status: GameStatus;
  readonly score: number;
}

export type Listener = (state: GameState) => void;

const INITIAL_STATE: GameState = {
  status: 'menu',
  score: 0,
};

export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: GameState = INITIAL_STATE) {
    this.state = initial;
  }

  getState(): GameState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** menu | gameover -> playing. Resets score. No-op if already playing. */
  start(): void {
    if (this.state.status === 'playing') return;
    this.setState({ status: 'playing', score: 0 });
  }

  /** Add to the score. Only meaningful while playing. */
  addScore(points: number): void {
    if (this.state.status !== 'playing') return;
    this.setState({ ...this.state, score: this.state.score + points });
  }

  /** playing -> gameover, preserving the final score. */
  gameOver(): void {
    if (this.state.status !== 'playing') return;
    this.setState({ ...this.state, status: 'gameover' });
  }

  /** Back to the menu with a fresh score. */
  reset(): void {
    this.setState(INITIAL_STATE);
  }

  private setState(next: GameState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
