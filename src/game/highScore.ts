/**
 * The persisted high score.
 *
 * Pure logic + an injected storage port, which is the whole point: the *rule*
 * (is this a new best?) and the *sanitising* (what do we do with a corrupt or
 * absent stored value?) are plain functions unit-tested under Vitest in node,
 * while the only thing that touches `localStorage` is a tiny adapter the
 * renderer supplies. No `window` reference lives in this file, so it stays on
 * the game-logic side of the seam.
 *
 * ── Per-game bests ──────────────────────────────────────────────────────────
 * The cabinet keeps one persisted best PER GAME, under its own key. The highway
 * deliberately keeps the original un-namespaced `gary.highScore.v1`, so a
 * player who has been playing since before the arcade existed keeps their
 * record across the upgrade rather than being silently reset to zero.
 *
 * The un-suffixed `loadHighScore` / `submitHighScore` remain as highway-shaped
 * compatibility wrappers over the per-game functions.
 */
import { type GameId } from './arcade/contracts.ts';

/** Where the HIGHWAY's best is kept. Versioned so a shape change is clean. */
export const HIGH_SCORE_KEY = 'gary.highScore.v1';

/**
 * The storage key for a game's best.
 *
 * `highway` is special-cased to the legacy key on purpose — see the file
 * header. Everything else is namespaced by id, in the same `gary.highScore.*`
 * family and at the same `.v1` version, so the whole set migrates together if
 * the shape ever changes.
 */
export function highScoreKey(game: GameId): string {
  return game === 'highway' ? HIGH_SCORE_KEY : `gary.highScore.${game}.v1`;
}

/** The minimum surface of `localStorage` this module needs. */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Coerce a stored string into a usable score.
 *
 * Anything that isn't a finite, non-negative number — missing key, `"NaN"`,
 * someone's hand-edited `"999999999999999999999"`, a half-written value — reads
 * as 0. A corrupt high score must never be able to break the menu.
 */
export function parseHighScore(raw: string | null): number {
  if (raw === null) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * Is `score` a new best? Strictly greater, so replaying to exactly your
 * previous best doesn't claim a record you didn't beat.
 */
export function isNewBest(score: number, best: number): boolean {
  return Number.isFinite(score) && score > best;
}

/** The result of finishing a run. */
export interface HighScoreResult {
  /** The best score after considering this run. */
  readonly best: number;
  /** Whether this run set it. */
  readonly isNew: boolean;
}

/**
 * Fold a finished run into a previous best. Pure — `submitHighScore` below is
 * the only thing that writes, and it's a thin shell over this.
 */
export function resolveHighScore(score: number, best: number): HighScoreResult {
  return isNewBest(score, best)
    ? { best: Math.floor(score), isNew: true }
    : { best, isNew: false };
}

/**
 * Read one game's stored best. Never throws: private-mode / disabled-storage
 * browsers make `localStorage` access itself throw, and a game must still be
 * playable there — it just won't remember.
 */
export function loadGameHighScore(
  storage: StoragePort | null,
  game: GameId,
): number {
  if (storage === null) return 0;
  try {
    return parseHighScore(storage.getItem(highScoreKey(game)));
  } catch {
    return 0;
  }
}

/**
 * Persist `score` under `game` if it beats `best`, returning the resolved
 * outcome. Same never-throws contract as `loadGameHighScore`: a failed write
 * degrades to an in-memory best for the session rather than ending the run with
 * an exception.
 */
export function submitGameHighScore(
  storage: StoragePort | null,
  game: GameId,
  score: number,
  best: number,
): HighScoreResult {
  const result = resolveHighScore(score, best);
  if (!result.isNew || storage === null) return result;
  try {
    storage.setItem(highScoreKey(game), String(result.best));
  } catch {
    // Storage unavailable — keep the session best, forget it on reload.
  }
  return result;
}

/**
 * Every game's best, as a record. This is what the select grid draws on the
 * cards, and what `window.__GARY__.highScores` projects — one read of storage,
 * one shape, so two surfaces can never disagree about a number.
 */
export function loadAllHighScores(
  storage: StoragePort | null,
  games: readonly GameId[],
): Record<GameId, number> {
  const out = {} as Record<GameId, number>;
  for (const game of games) out[game] = loadGameHighScore(storage, game);
  return out;
}

/**
 * Read the highway's best. Compatibility wrapper over `loadGameHighScore` —
 * kept because it is the un-namespaced original and the shape every
 * pre-arcade caller and test expects.
 */
export function loadHighScore(storage: StoragePort | null): number {
  return loadGameHighScore(storage, 'highway');
}

/** Persist a highway run. Compatibility wrapper over `submitGameHighScore`. */
export function submitHighScore(
  storage: StoragePort | null,
  score: number,
  best: number,
): HighScoreResult {
  return submitGameHighScore(storage, 'highway', score, best);
}
