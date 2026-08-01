/**
 * Input normalisation and routing. Pure: it takes key names and gesture
 * deltas — never a KeyboardEvent, never a TouchEvent — and returns intent.
 *
 * Two layers, deliberately separate:
 *
 *  1. MAPPING (`actionForKey`, `actionForSwipe`) turns a device signal into an
 *     `ArcadeAction`. This is where "A is left" and "34px of horizontal travel
 *     is a swipe" live.
 *  2. ROUTING (`routeAction`) decides what an action MEANS given the current
 *     status. This is where "Space on the menu opens a game, but Space during a
 *     run is the game's own verb" lives.
 *
 * Keeping them apart is what makes the whole thing testable in node, and it is
 * why `src/main.ts` contains no `switch (e.key)` any more.
 */
import type { GameStatus } from '../state.ts';
import type { ArcadeAction } from './contracts.ts';

/**
 * Keyboard map. Keyed on `KeyboardEvent.key` values, lowercased for letters so
 * Caps Lock and Shift never break steering.
 *
 * WASD sits alongside the arrows because half the cabinet is two-axis, and
 * Enter joins Space as `primary` so a keyboard-only player can activate a menu
 * card with whichever key they reach for.
 */
const KEY_ACTIONS: Readonly<Record<string, ArcadeAction>> = {
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  ' ': 'primary',
  spacebar: 'primary', // legacy key name, still emitted by some IMEs
  enter: 'primary',
  escape: 'back',
  esc: 'back', // legacy key name
};

/** Map a `KeyboardEvent.key` to an action, or null if we don't own that key. */
export function actionForKey(key: string): ArcadeAction | null {
  return KEY_ACTIONS[key.toLowerCase()] ?? null;
}

/** Horizontal/vertical travel (px) that commits a swipe rather than a tap. */
export const SWIPE_THRESHOLD = 34;

/** Travel (px) under which a gesture is still a tap, on either axis. */
export const TAP_SLOP = 10;

/**
 * Map a finished (or in-flight) gesture to an action.
 *
 * A swipe resolves on its DOMINANT axis so a sloppy diagonal never fires two
 * directions, and a gesture that never passes `SWIPE_THRESHOLD` on its dominant
 * axis is not a swipe at all. Taps are `actionForTap`, not this — a zero-travel
 * gesture is a distinct intent, not a degenerate swipe.
 */
export function actionForSwipe(dx: number, dy: number): ArcadeAction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay) {
    if (ax < SWIPE_THRESHOLD) return null;
    return dx < 0 ? 'left' : 'right';
  }
  if (ay < SWIPE_THRESHOLD) return null;
  return dy < 0 ? 'up' : 'down';
}

/** Has this gesture travelled far enough to stop being a tap? */
export function isTapTravel(dx: number, dy: number): boolean {
  return Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP;
}

/** A tap is the `primary` intent — the same verb as Space/Enter. */
export function actionForTap(): ArcadeAction {
  return 'primary';
}

/**
 * Where a normalized action goes, once the shell knows what screen we're on.
 *
 *  - `menu`     — the select grid consumes it (move the cursor, open a game).
 *  - `runtime`  — forward it to the active game.
 *  - `start`    — begin/restart a run.
 *  - `back`     — leave the run and return to the select menu.
 *  - `ignore`   — this status has no meaning for this action; drop it.
 */
export type ActionRoute = 'menu' | 'runtime' | 'start' | 'back' | 'ignore';

/**
 * Status-aware routing. The rules, in full:
 *
 *  - **menu**: every action belongs to the grid. Directions move the roving
 *    cursor; `primary` opens the focused card; `back` is inert (there is
 *    nowhere above the menu to go).
 *  - **playing**: directions are the running game's, and so is `primary` — this
 *    is exactly why Space can never both start a run and fire an in-game
 *    action: by the time the game is `playing`, `primary` has already stopped
 *    meaning "start". `back` abandons the run to the menu.
 *  - **gameover**: `primary` restarts (the card's own CTA verb), `back` returns
 *    to the menu, and directions are dropped so a reflexive dodge on the
 *    game-over card cannot move a cone that is no longer running.
 */
export function routeAction(
  status: GameStatus,
  action: ArcadeAction,
): ActionRoute {
  switch (status) {
    case 'menu':
      return action === 'back' ? 'ignore' : 'menu';
    case 'playing':
      return action === 'back' ? 'back' : 'runtime';
    case 'gameover':
      if (action === 'primary') return 'start';
      if (action === 'back') return 'back';
      return 'ignore';
  }
}

/**
 * Move a roving cursor across a row-major grid.
 *
 * Both axes wrap, which is the right behaviour for a small fixed grid: with
 * four cards, a dead end at the edge is just an input the player has to
 * remember not to make. Horizontal wrap moves within the row (so ← from the
 * left card lands on the right card of the SAME row, not the previous row) —
 * that keeps the 2×2 legible as two rows rather than one snaking list.
 *
 * Returns the new index, or the current one when the action isn't directional.
 */
export function moveCursor(
  index: number,
  count: number,
  columns: number,
  action: ArcadeAction,
): number {
  if (count <= 0) return 0;
  const safe = Math.min(Math.max(0, Math.trunc(index)), count - 1);
  const cols = Math.max(1, columns);
  const row = Math.floor(safe / cols);
  const col = safe % cols;

  switch (action) {
    case 'left':
    case 'right': {
      // Width of THIS row — the last row may be short.
      const rowStart = row * cols;
      const rowWidth = Math.min(cols, count - rowStart);
      const delta = action === 'left' ? -1 : 1;
      return rowStart + ((col + delta + rowWidth) % rowWidth);
    }
    case 'up':
    case 'down': {
      const rows = Math.ceil(count / cols);
      const delta = action === 'up' ? -1 : 1;
      // Walk rows until we find one that actually has this column. With a
      // ragged last row, ↓ from a column past its end should reach the top
      // rather than land on nothing.
      for (let step = 1; step <= rows; step++) {
        const candidateRow = (row + delta * step + rows * step) % rows;
        const candidate = candidateRow * cols + col;
        if (candidate < count) return candidate;
      }
      return safe;
    }
    default:
      return safe;
  }
}
