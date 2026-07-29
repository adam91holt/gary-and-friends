/**
 * The difficulty curve: how fast Gary is going, and how many points a metre of
 * road is worth. Pure functions of distance travelled — no three.js, no DOM, no
 * time-of-day, no hidden mutable state — so the whole ramp is unit-testable and
 * a given distance always maps to exactly one speed.
 */
import { BASE_SPEED } from '../state.ts';

/** Speed is never allowed past this, or the road out-scrolls the fog. */
export const MAX_SPEED = BASE_SPEED * 2.25;

/**
 * World units after which the ramp has closed ~63% of the gap between
 * BASE_SPEED and MAX_SPEED. Tuned so the first ~15 seconds feel forgiving and
 * the run is properly quick by a minute in.
 */
export const RAMP_DISTANCE = 900;

/** Points awarded per world unit travelled. */
export const POINTS_PER_UNIT = 1;

/**
 * Forward speed after travelling `distance` world units.
 *
 * An exponential ease toward MAX_SPEED rather than a linear ramp: the early
 * acceleration is felt strongly (each second is noticeably faster than the
 * last) while the top end tapers instead of becoming unplayable. Monotonically
 * increasing and bounded, which is what the tests pin.
 */
export function speedForDistance(distance: number): number {
  const travelled = distance > 0 ? distance : 0;
  const progress = 1 - Math.exp(-travelled / RAMP_DISTANCE);
  return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * progress;
}

/** Score earned by travelling `distance` world units. Integer, monotonic. */
export function scoreForDistance(distance: number): number {
  if (distance <= 0) return 0;
  return Math.floor(distance * POINTS_PER_UNIT);
}

/**
 * 0..1 progress along the difficulty curve — how close to top speed the run is.
 * The HUD's throttle bar reads this, so the instrument and the simulation agree
 * on what "flat out" means.
 */
export function intensityForSpeed(speed: number): number {
  const span = MAX_SPEED - BASE_SPEED;
  if (span <= 0) return 1;
  const t = (speed - BASE_SPEED) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
