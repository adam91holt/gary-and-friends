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
 *
 * ── Shared shape (pinned by the foundation ticket) ──────────────────────────
 * These field names / types / actions are the contract tickets 02–04 build on.
 * They may extend the *behaviour* behind an action, but must not rename a field
 * or change a signature:
 *
 *   status  : GameStatus  — 'menu' | 'playing' | 'gameover'
 *   score   : number      — accumulates while playing
 *   lane    : number      — 0..2, Gary starts centre (1); clamped by setLane()
 *   speed   : number      — forward travel, world-units/sec; 0 when not playing
 *   friends : number      — friends collected (spawn/collection logic: ticket 02)
 *
 * Actions: start() · addScore() · addFriends() · setLane() · setSpeed() ·
 *          gameOver() · reset()
 */

export type GameStatus = 'menu' | 'playing' | 'gameover';

/** Number of lanes on the highway. Gary occupies one at a time. */
export const LANE_COUNT = 3;
/** The centre lane index; Gary spawns here. */
export const CENTER_LANE = 1;
/** Forward speed (world-units/sec) a fresh run starts at. */
export const BASE_SPEED = 24;

export interface GameState {
  readonly status: GameStatus;
  readonly score: number;
  /** Which lane (0..LANE_COUNT-1) Gary is in. Center = CENTER_LANE. */
  readonly lane: number;
  /** Forward travel speed in world-units/sec. 0 unless playing. */
  readonly speed: number;
  /** Friends collected this run. */
  readonly friends: number;
}

export type Listener = (state: GameState) => void;

const INITIAL_STATE: GameState = {
  status: 'menu',
  score: 0,
  lane: CENTER_LANE,
  speed: 0,
  friends: 0,
};

/** A clean, playable state — the shape both start() and restart converge on. */
const FRESH_RUN: GameState = {
  status: 'playing',
  score: 0,
  lane: CENTER_LANE,
  speed: BASE_SPEED,
  friends: 0,
};

/** Clamp an arbitrary (possibly fractional) lane request into 0..LANE_COUNT-1. */
function clampLane(lane: number): number {
  const i = Math.round(lane);
  if (Number.isNaN(i) || i < 0) return 0;
  if (i > LANE_COUNT - 1) return LANE_COUNT - 1;
  return i;
}

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

  /**
   * menu | gameover -> playing, from a clean run (score/friends reset, Gary
   * re-centred, speed back to BASE_SPEED). This is also the "restart" path from
   * gameover. No-op if already playing.
   */
  start(): void {
    if (this.state.status === 'playing') return;
    this.setState(FRESH_RUN);
  }

  /** Add to the score. Only meaningful while playing. */
  addScore(points: number): void {
    if (this.state.status !== 'playing') return;
    this.setState({ ...this.state, score: this.state.score + points });
  }

  /** Collect friends. Only meaningful while playing. (Spawn logic: ticket 02.) */
  addFriends(count = 1): void {
    if (this.state.status !== 'playing') return;
    this.setState({ ...this.state, friends: this.state.friends + count });
  }

  /** Move Gary to a lane. Request is clamped to 0..LANE_COUNT-1. */
  setLane(lane: number): void {
    const next = clampLane(lane);
    if (next === this.state.lane) return;
    this.setState({ ...this.state, lane: next });
  }

  /** Set the forward travel speed (never negative). */
  setSpeed(speed: number): void {
    const next = speed < 0 ? 0 : speed;
    if (next === this.state.speed) return;
    this.setState({ ...this.state, speed: next });
  }

  /** playing -> gameover, preserving score/friends/lane. Motion stops. */
  gameOver(): void {
    if (this.state.status !== 'playing') return;
    this.setState({ ...this.state, status: 'gameover', speed: 0 });
  }

  /** Back to a clean menu state. */
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
