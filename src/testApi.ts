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
 *   __spawnFriend()   — spawn a collectible friend. Wired now: injects a friend
 *                       into Gary's lane just ahead of him and lets the normal
 *                       collision path collect it, so the hook exercises the
 *                       real pickup rule rather than poking store state.
 *
 * The renderer supplies the concrete implementations (see GaryTestHooks) so this
 * module stays free of game/render specifics.
 *
 * ── The arcade extension ────────────────────────────────────────────────────
 * The cabinet holds several games, so the contract gained `game`, `games`,
 * `snapshot`, `selectGame(id)`, `input(action)`, `backToMenu()` and
 * `highScores`. Every pre-arcade member keeps working unchanged: `state`,
 * `score`, `lane`, `speed`, `friends` still describe the highway exactly as
 * before, `start()` still starts it, and `highScore` still returns the SELECTED
 * game's best (the highway, by default).
 *
 * ── The reserved per-game command hook ──────────────────────────────────────
 * `command(name, payload)` is the extension point sibling tickets use so they
 * never have to edit THIS file. A game declares its own commands by merging
 * into `ArcadeCommandMap` from its own module and implements `handleCommand` on
 * its runtime; the signature here is generic over that map, so a new command is
 * type-checked at the call site with no shared-file edit.
 */
import { GAME_IDS } from './game/arcade/contracts.ts';
import type {
  ArcadeAction,
  ArcadeCommandMap,
  ArcadeCommandName,
  ArcadeSnapshot,
  GameId,
} from './game/arcade/contracts.ts';
import type { GameStatus, GameStore } from './game/state.ts';

/** Concrete implementations wired in by the renderer (src/main.ts). */
export interface GaryTestHooks {
  /** Move Gary to lane n (clamped to the valid range by the store). */
  setLane: (n: number) => void;
  /** Force a collision -> gameover, deterministically. */
  forceCollision: () => void;
  /** Spawn a collectible friend into the world. */
  spawnFriend: () => void;
  /** How many entities are live in the world right now (traffic, friends). */
  entityCount: () => number;
  /** The nearest live entity still ahead of Gary (null if the road is clear). */
  nearestAhead: () => NearestEntity | null;
  /** Vehicles threaded closely this run. */
  nearMissCount: () => number;
  /** How many friends are currently trailing Gary in the conga line. */
  congaLength: () => number;
  /** The SELECTED game's persisted best (via the storage adapter in main.ts). */
  highScore: () => number;
  /** Every game's persisted best, keyed by id. */
  highScores: () => Record<GameId, number>;
  /** Live particles across every fx pool. */
  particleCount: () => number;
  /** Whether Gary's death animation is currently playing. */
  dying: () => boolean;
  /** The active runtime's own report of itself. */
  snapshot: () => ArcadeSnapshot;
  /** Point the cabinet at a game (menu only, enforced by the store). */
  selectGame: (id: GameId) => void;
  /** Feed a normalized action through the real routing path. */
  input: (action: ArcadeAction) => void;
  /** Leave a finished run for the select grid (gameover only). */
  backToMenu: () => void;
  /** Forward a per-game command; false if that game doesn't implement it. */
  command: <K extends ArcadeCommandName>(
    name: K,
    payload: ArcadeCommandMap[K],
  ) => boolean;
}

/** A read-only snapshot of the next thing Gary is about to meet. */
export interface NearestEntity {
  /** Distance ahead of Gary in world units (always positive). */
  readonly distance: number;
  /** Which lane it occupies (0..2). */
  readonly lane: number;
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
  /**
   * Live world entities (traffic today, friends once 03 lands). Lets e2e assert
   * that traffic actually spawns during a run and that restart clears it,
   * neither of which is visible in the store.
   */
  readonly entities: number;
  /**
   * The nearest entity still ahead of Gary (distance + lane), or null when the
   * road ahead is clear. Lets a test wait for traffic to be genuinely in frame
   * before a screenshot, and steer deterministically relative to it.
   */
  readonly nearestAhead: NearestEntity | null;
  /**
   * Vehicles Gary has threaded closely this run (reset by start()). Unlike the
   * HUD toast — which is a short animation — this is durable, so a test can
   * assert the near-miss rule fired without racing the CSS.
   */
  readonly nearMisses: number;
  /**
   * Friends currently trailing Gary in the conga line. Distinct from `friends`:
   * that is the store's *count collected this run*, this is how many cones are
   * actually in the world behind him. They agree in normal play, which is
   * precisely why asserting on both is worth doing — it catches a HUD counter
   * that rises without the line growing, and vice versa.
   */
  readonly conga: number;
  /**
   * The persisted best score, as the game currently believes it. 0 when there
   * is no record yet (or when `localStorage` is unavailable). Updated the
   * moment a run ends, so a test can crash, read this, reload, and assert it
   * survived — which is the only way to test persistence from the outside.
   */
  readonly highScore: number;
  /**
   * Live particles across every fx pool (hop dust, collect pops, near-miss
   * sparks, crash debris). Lets e2e assert the juice actually fired rather than
   * racing an animation, and lets a screenshot wait until particles are in
   * frame instead of catching an empty road.
   */
  readonly particles: number;
  /**
   * True while Gary's squash-and-stretch death is playing. Distinct from
   * `state === 'gameover'`: the status flips on impact, this stays true for the
   * length of the animation, so a test can prove the death *plays* rather than
   * that the state merely changed.
   */
  readonly dying: boolean;
  /**
   * Which game the cabinet is pointed at. On the menu this is the highlighted
   * card; while playing it is the game actually running. Mirrors
   * `GameState.selectedGame`.
   */
  readonly game: GameId;
  /** Every game in the cabinet, in grid order. Static — it mirrors the catalog. */
  readonly games: readonly GameId[];
  /**
   * The active runtime's own snapshot: score, live entities and whatever that
   * game calls its second number. This is how a test asserts on a game the
   * store has no fields for — a tower's height is not a `lane`.
   */
  readonly snapshot: ArcadeSnapshot;
  /**
   * Every game's persisted best, keyed by id. `highScore` remains the SELECTED
   * game's best, so a pre-arcade test that never selects anything still reads
   * the highway's record.
   */
  readonly highScores: Record<GameId, number>;
  /** Begin / restart play (menu|gameover -> playing). */
  start: () => void;
  /**
   * Point the cabinet at a game. Menu only — the store refuses mid-run, so a
   * test cannot swap the game out from under a live score.
   */
  selectGame: (id: GameId) => void;
  /**
   * Feed a normalized action through the REAL routing path — the same
   * `routeAction` the keyboard and touch handlers use. A test driving the menu
   * with `input('right')` exercises the shipping navigation rather than a
   * parallel one.
   */
  input: (action: ArcadeAction) => void;
  /** Leave a finished run for the select grid. Gameover only. */
  backToMenu: () => void;
  /**
   * Send a deterministic command to the active runtime. Returns false when that
   * game does not implement the command, so a test can tell "not handled" from
   * "handled and did nothing".
   *
   * Reserved for sibling tickets: they declare their commands by merging into
   * `ArcadeCommandMap` from their own module, so adding one never edits this
   * file.
   */
  command: <K extends ArcadeCommandName>(
    name: K,
    payload: ArcadeCommandMap[K],
  ) => boolean;
  /** Deterministic hook: move Gary to lane n. */
  __setLane: (n: number) => void;
  /** Deterministic hook: force a collision -> gameover. */
  __forceCollision: () => void;
  /**
   * Deterministic hook: spawn a collectible friend in Gary's lane, just ahead
   * of him. No-op outside a run. Bypasses the spawn cadence and the RNG, but
   * goes through the real field + collision path, and cycles the roster so
   * repeated calls introduce different characters.
   */
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
    get entities() {
      return hooks.entityCount();
    },
    get nearestAhead() {
      return hooks.nearestAhead();
    },
    get nearMisses() {
      return hooks.nearMissCount();
    },
    get conga() {
      return hooks.congaLength();
    },
    get highScore() {
      return hooks.highScore();
    },
    get particles() {
      return hooks.particleCount();
    },
    get dying() {
      return hooks.dying();
    },
    get game() {
      return store.getState().selectedGame;
    },
    get games() {
      return GAME_IDS;
    },
    get snapshot() {
      return hooks.snapshot();
    },
    get highScores() {
      return hooks.highScores();
    },
    start() {
      store.start();
    },
    selectGame(id: GameId) {
      hooks.selectGame(id);
    },
    input(action: ArcadeAction) {
      hooks.input(action);
    },
    backToMenu() {
      hooks.backToMenu();
    },
    command(name, payload) {
      return hooks.command(name, payload);
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
