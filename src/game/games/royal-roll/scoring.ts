/**
 * What a throw is worth. Pure arithmetic, deliberately separated from the
 * solver so the payout rules can be read, argued about and tested without
 * running any physics.
 *
 * The shape of the reward is the whole design of the game: a single cone is
 * worth almost nothing, and a line that fans through the wedge is worth a lot,
 * because the interesting decision is WHERE to aim rather than whether to
 * throw. Multiplying by the number felled — rather than adding a flat bonus —
 * is what makes that gap steep enough to change how you aim.
 */

/**
 * Extra multiplier per cone beyond the first. Five cones in one throw is
 * therefore double; the full rack is triple before the strike bonus lands.
 */
export const COMBO_STEP = 0.25;
/** Ceiling on the combo, so a lucky full-rack sweep stays inside the curve. */
export const MAX_COMBO = 3;
/** Paid on top when a throw leaves nothing standing. The rack then re-racks. */
export const STRIKE_BONUS = 750;

/** The multiplier a throw earns for felling `count` cones. */
export function comboMultiplier(count: number): number {
  if (count <= 1) return 1;
  const raw = 1 + (count - 1) * COMBO_STEP;
  return raw > MAX_COMBO ? MAX_COMBO : raw;
}

/** The itemised result of one throw. The HUD and the fx layer both read it. */
export interface ThrowResult {
  /** Which throw this was (1-based). */
  readonly throwNumber: number;
  /** Ids of the cones felled by this throw, in the order they went down. */
  readonly knocked: readonly number[];
  /** Sum of the felled cones' face values, before the multiplier. */
  readonly base: number;
  /** The combo multiplier this throw earned. */
  readonly multiplier: number;
  /** The strike bonus, or 0. */
  readonly bonus: number;
  /** What actually went on the scoreboard. Always an integer. */
  readonly total: number;
  /** Whether this throw cleared the rack (and therefore re-racked it). */
  readonly cleared: boolean;
  /** Whether the King himself went over. */
  readonly royal: boolean;
}

/** Fold a throw's felled cones into a scoreboard number. */
export function scoreThrow(input: {
  readonly throwNumber: number;
  readonly knocked: readonly number[];
  readonly values: readonly number[];
  readonly cleared: boolean;
  readonly royal: boolean;
}): ThrowResult {
  const base = input.values.reduce((sum, value) => sum + value, 0);
  const multiplier = comboMultiplier(input.knocked.length);
  const bonus = input.cleared && input.knocked.length > 0 ? STRIKE_BONUS : 0;
  return {
    throwNumber: input.throwNumber,
    knocked: input.knocked,
    base,
    multiplier,
    bonus,
    total: Math.round(base * multiplier) + bonus,
    cleared: input.cleared,
    royal: input.royal,
  };
}
