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
 *
 * ── The arcade extension ────────────────────────────────────────────────────
 * The cabinet holds several games, so the store also owns WHICH one is
 * selected. `selectedGame` is additive: `lane`/`speed`/`friends` keep their
 * highway semantics exactly, and a non-highway runtime simply leaves them at
 * their idle values (lane = CENTER_LANE, speed = 0, friends = 0) rather than
 * redefining them.
 *
 * Extra actions: selectGame(id) — menu only · returnToMenu() — gameover only.
 */
import { DEFAULT_GAME, type GameId } from './arcade/contracts.ts';

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
  /**
   * Which game the cabinet is pointed at. On the menu this is the card the
   * player is about to open; while playing it is the game actually running.
   * It survives a run ending, which is what makes "Run it back" restart the
   * game you just played rather than dumping you back on the highway.
   */
  readonly selectedGame: GameId;
}

export type Listener = (state: GameState) => void;

const INITIAL_STATE: GameState = {
  status: 'menu',
  score: 0,
  lane: CENTER_LANE,
  speed: 0,
  friends: 0,
  selectedGame: DEFAULT_GAME,
};

/**
 * A clean, playable run. Not a constant any more: the selected game rides
 * through a start, so this is derived per-call from the game being started.
 */
function freshRun(selectedGame: GameId): GameState {
  return {
    status: 'playing',
    score: 0,
    lane: CENTER_LANE,
    // lane/speed/friends are the highway's legacy telemetry. Other runtimes keep
    // those fields at their documented idle values and expose their own motion
    // through ArcadeSnapshot instead.
    speed: selectedGame === DEFAULT_GAME ? BASE_SPEED : 0,
    friends: 0,
    selectedGame,
  };
}

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
   * menu | gameover -> playing, from a clean run (score/friends reset and Gary
   * re-centred). Highway starts at BASE_SPEED; other games retain the legacy
   * telemetry's idle speed of 0. This is also the restart path from gameover.
   * No-op if already playing.
   */
  start(): void {
    if (this.state.status === 'playing') return;
    this.setState(freshRun(this.state.selectedGame));
  }

  /**
   * Point the cabinet at a different game. **Menu only**: changing the game out
   * from under a live run (or from under a game-over card still showing that
   * run's score) would leave the HUD describing a game nobody played. The menu
   * is the one place where nothing is at stake.
   *
   * No-op when the id is already selected, so the roving grid cursor can call
   * this on every keystroke without churning subscribers.
   */
  selectGame(id: GameId): void {
    if (this.state.status !== 'menu') return;
    if (this.state.selectedGame === id) return;
    this.setState({ ...this.state, selectedGame: id });
  }

  /**
   * Leave a finished run and go back to the select grid. **Gameover only** —
   * the product rule is that the menu is reachable from the card at the end of
   * a run, not by abandoning one mid-play.
   *
   * The run's score/friends are cleared (the menu shows *bests*, not leftovers)
   * but the selection is kept, so the grid re-opens on the game just played.
   */
  returnToMenu(): void {
    if (this.state.status !== 'gameover') return;
    this.setState({
      ...INITIAL_STATE,
      selectedGame: this.state.selectedGame,
    });
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

  /** Move Gary while playing. Request is clamped to 0..LANE_COUNT-1. */
  setLane(lane: number): void {
    if (this.state.status !== 'playing') return;
    const next = clampLane(lane);
    if (next === this.state.lane) return;
    this.setState({ ...this.state, lane: next });
  }

  /** Set the forward travel speed while playing (never negative). */
  setSpeed(speed: number): void {
    if (this.state.status !== 'playing') return;
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
