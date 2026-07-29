/**
 * The persisted high score.
 *
 * Pure logic + an injected storage port, which is the whole point: the *rule*
 * (is this a new best?) and the *sanitising* (what do we do with a corrupt or
 * absent stored value?) are plain functions unit-tested under Vitest in node,
 * while the only thing that touches `localStorage` is a tiny adapter the
 * renderer supplies. No `window` reference lives in this file, so it stays on
 * the game-logic side of the seam.
 */

/** Where the best score is kept. Versioned so a future shape change is clean. */
export const HIGH_SCORE_KEY = 'gary.highScore.v1';

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
  if (!Number.isFinite(value) || value <= 0) return 0;
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
 * Read the stored best. Never throws: private-mode / disabled-storage browsers
 * make `localStorage` access itself throw, and a game must still be playable
 * there — it just won't remember.
 */
export function loadHighScore(storage: StoragePort | null): number {
  if (storage === null) return 0;
  try {
    return parseHighScore(storage.getItem(HIGH_SCORE_KEY));
  } catch {
    return 0;
  }
}

/**
 * Persist `score` if it beats `best`, returning the resolved outcome. Same
 * never-throws contract as `loadHighScore`: a failed write degrades to an
 * in-memory best for the session rather than ending the run with an exception.
 */
export function submitHighScore(
  storage: StoragePort | null,
  score: number,
  best: number,
): HighScoreResult {
  const result = resolveHighScore(score, best);
  if (!result.isNew || storage === null) return result;
  try {
    storage.setItem(HIGH_SCORE_KEY, String(result.best));
  } catch {
    // Storage unavailable — keep the session best, forget it on reload.
  }
  return result;
}
