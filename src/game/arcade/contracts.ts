/**
 * The arcade shell's shared vocabulary. Pure: no `three`, no DOM, no `window`.
 *
 * Everything in here is a *name* the shell, the runtimes, the HUD and the test
 * API all agree on. It is deliberately the smallest file in the epic, because
 * four sibling tickets import it and none of them may need to edit it.
 */

/**
 * Every game in the cabinet. The order is load-bearing: it is the order the
 * catalog is declared in, which is the order the select grid lays cards out in,
 * which is the order arrow-key navigation walks.
 */
export const GAME_IDS = ['highway', 'tower', 'coneball', 'royal-roll'] as const;

/** A game's stable identity. Used as a store field, a storage-key fragment and
 *  a DOM `data-game` value, so it must stay lower-kebab and URL-safe. */
export type GameId = (typeof GAME_IDS)[number];

/** The game the cabinet boots into, and the one legacy `start()` runs. */
export const DEFAULT_GAME: GameId = 'highway';

/** Narrow an untrusted string (a stored value, a test-API argument) to a GameId. */
export function isGameId(value: unknown): value is GameId {
  return (
    typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value)
  );
}

/**
 * The normalized input vocabulary. Every device — keyboard, tap, swipe — is
 * flattened to one of these six before anything game-shaped sees it, so a
 * runtime never learns whether the player used a key or a thumb.
 *
 * `primary` is the confirm/act verb (Space, Enter, tap). `back` is the
 * cancel/leave verb (Escape).
 */
export const ARCADE_ACTIONS = [
  'left',
  'right',
  'up',
  'down',
  'primary',
  'back',
] as const;

export type ArcadeAction = (typeof ARCADE_ACTIONS)[number];

/** Narrow an untrusted string to an ArcadeAction (the test API takes one). */
export function isArcadeAction(value: unknown): value is ArcadeAction {
  return (
    typeof value === 'string' &&
    (ARCADE_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * The one headline number a game shows *besides* score — friends for the
 * highway, height for the tower, rallies for coneball. The HUD renders this
 * slot generically, so a new game gets an instrument for free by naming one.
 */
export interface ArcadeMetric {
  /** Short instrument label, e.g. "Friends". Shown uppercase by the HUD. */
  readonly label: string;
  /** The value to draw. Integers only — the HUD uses tabular numerals. */
  readonly value: number;
}

/**
 * What a runtime reports about itself, every frame, to anything that isn't it:
 * the HUD, the test API, the e2e suite. Runtimes never push; the shell pulls.
 */
export interface ArcadeSnapshot {
  /** Which game produced this. Guards against reading a stale snapshot. */
  readonly game: GameId;
  /** The run's score. Mirrors `GameState.score` for store-backed games. */
  readonly score: number;
  /** Live simulation entities. 0 for a game that has no field. */
  readonly entities: number;
  /** The game-specific headline metric, or null if the game has none. */
  readonly metric: ArcadeMetric | null;
}

/**
 * Deterministic per-game test commands.
 *
 * This is the extension point siblings use INSTEAD of editing `src/testApi.ts`:
 * a game module declares its own commands by merging into this interface from
 * its own file —
 *
 * ```ts
 * declare module '../../game/arcade/contracts.ts' {
 *   interface ArcadeCommandMap {
 *     'tower:drop': { readonly lane: number };
 *   }
 * }
 * ```
 *
 * — and implements `handleCommand` on its runtime. `window.__GARY__.command()`
 * is typed off this map, so the payload is checked at the call site and no
 * shared file changes hands.
 */
export interface ArcadeCommandMap {
  /**
   * Reserved. Always handled by the shell itself and always a no-op, so the
   * command channel has a member (and a test) before any game declares one.
   */
  'shell:noop': undefined;
}

/** Every declared command name. Grows by declaration merging, never by edit. */
export type ArcadeCommandName = keyof ArcadeCommandMap & string;
