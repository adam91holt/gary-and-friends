/**
 * Camera shake, as pure math.
 *
 * A *trauma* model rather than a per-event tween: events add trauma (0..1),
 * trauma decays continuously, and the actual offset is `trauma²` times an
 * amplitude. Squaring is the whole trick — it makes a small knock (a near miss)
 * feel like a nudge while a big one (a crash) feels violent, and it makes the
 * tail of every shake settle rather than stopping dead.
 *
 * Offsets are driven by summed sines at incommensurate frequencies, which is
 * cheap, deterministic (no RNG, so a screenshot at time t is reproducible) and
 * doesn't loop visibly within the fraction of a second a shake lasts.
 *
 * No three.js: the renderer adds the returned offsets to its camera after the
 * rig damping, so shake never fights the framing logic.
 */

/** Trauma added when Gary threads a gap. Felt, not disorienting. */
export const NEAR_MISS_TRAUMA = 0.36;
/** Trauma added on a crash. The one moment the whole frame is allowed to lurch. */
export const CRASH_TRAUMA = 1;
/** Trauma added when a friend joins the line — a happy little bump. */
export const PICKUP_TRAUMA = 0.16;
/** How fast trauma bleeds off, per second. */
export const TRAUMA_DECAY = 1.9;
/** Peak positional offset at full trauma (world units). */
export const SHAKE_AMPLITUDE = 0.34;
/** Peak roll at full trauma (radians). Small: a rolling horizon reads as nausea. */
export const SHAKE_ROLL = 0.05;

export interface ShakeOffset {
  readonly x: number;
  readonly y: number;
  readonly roll: number;
}

const NONE: ShakeOffset = { x: 0, y: 0, roll: 0 };

/** Add trauma, clamped to 1 so stacked events can't compound into a seizure. */
export function addTrauma(current: number, amount: number): number {
  const next = (current > 0 ? current : 0) + (amount > 0 ? amount : 0);
  return next > 1 ? 1 : next;
}

/**
 * Below this, trauma snaps to exactly 0. Floating-point subtraction can leave a
 * 1e-16 residue that would otherwise keep the shake maths running forever for
 * no visible benefit.
 */
const TRAUMA_EPSILON = 1e-4;

/** Bleed trauma off over `dt` seconds. Never goes negative. */
export function decayTrauma(
  current: number,
  dt: number,
  rate: number = TRAUMA_DECAY,
): number {
  if (current <= 0 || dt <= 0) return current > 0 ? current : 0;
  const next = current - rate * dt;
  return next > TRAUMA_EPSILON ? next : 0;
}

/**
 * The offset to add to the camera this frame.
 *
 * @param trauma    0..1
 * @param time      seconds since boot (drives the noise phase)
 * @param amplitude peak offset at full trauma
 */
export function shakeOffset(
  trauma: number,
  time: number,
  amplitude: number = SHAKE_AMPLITUDE,
): ShakeOffset {
  if (trauma <= 0) return NONE;
  const t = trauma > 1 ? 1 : trauma;
  // Squared: quiet knocks stay quiet, big ones dominate.
  const power = t * t;
  return {
    x: power * amplitude * wobble(time, 37.1, 11.3),
    y: power * amplitude * 0.8 * wobble(time, 29.7, 17.9),
    roll: power * SHAKE_ROLL * wobble(time, 23.3, 7.7),
  };
}

/** Two detuned sines: bounded to [-1, 1] and non-repeating at these ratios. */
function wobble(time: number, fast: number, slow: number): number {
  return 0.62 * Math.sin(time * fast) + 0.38 * Math.sin(time * slow + 1.7);
}
