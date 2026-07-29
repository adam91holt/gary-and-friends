/**
 * Gary's comedic death, as a pure timing function.
 *
 * The joke has to be *timed*, and timing is logic, so it lives here rather than
 * as magic numbers scattered through the render loop. `deathPose(t)` maps
 * seconds-since-impact to a scale triple plus a hop height and a spin — the
 * renderer applies it and does no arithmetic of its own.
 *
 * ── The beat sheet ──────────────────────────────────────────────────────────
 *   0.00–0.09  SQUASH   flattened wide, the impact frame. Held long enough to
 *                       read as a pose (a single frame reads as a glitch).
 *   0.09–0.30  STRETCH  overshoots tall and thin, launched upward — the
 *                       cartoon rebound that sells the hit as comic, not grim.
 *   0.30–0.75  TUMBLE   gravity wins; he arcs back down, still spinning.
 *   0.75–1.05  SETTLE   two decaying wobbles into a flattened wreck pose.
 *
 * Squash and stretch conserve volume (x·y·z ≈ 1) so he never looks like he
 * simply changed size — the classic animation rule, and the reason a squashed
 * cone reads as *squashed* rather than as a rendering bug.
 */

/** Total length of the death animation, seconds. */
export const DEATH_DURATION = 1.05;
/** When the impact squash is at its flattest. */
const SQUASH_END = 0.09;
/** When the rebound stretch peaks. */
const STRETCH_END = 0.3;
/** When he lands from the rebound. */
const TUMBLE_END = 0.75;
/** Flattest vertical scale at full squash. */
const SQUASH_Y = 0.42;
/** Stable flattened scale retained on the game-over screen. */
const WRECK_Y = 0.58;
/** Tallest vertical scale at full stretch. */
const STRETCH_Y = 1.42;
/** Peak height of the comedy hop (world units). */
const HOP_HEIGHT = 1.15;
/**
 * How far the impact punts Gary back toward the camera (world units).
 *
 * Not decoration — it is what makes the wreck *visible*. The vehicle that
 * killed him occupies his exact lane and depth, so a Gary who dies in place
 * dies hidden inside a truck, and the punchline of the entire game plays behind
 * a box. Being knocked clear is also simply funnier than being absorbed.
 */
const KNOCKBACK = 3.4;
/** Sideways scatter on the punt, so he doesn't slide down a perfect rail. */
const KNOCK_SIDE = 0.75;
/**
 * Total spin over the animation (radians). A little short of a full turn, so he
 * comes to rest yawed toward the front-left wreck camera rather than square to
 * the road — both because a wreck that lands perfectly aligned looks placed
 * rather than thrown, and because this is the angle that leaves his face
 * pointed at the shot the game-over card is composed in.
 */
const SPIN = Math.PI * 2 - 0.8;
/**
 * How far he tips over by the end (radians). A shade under 90°, so he ends on
 * his BACK with his googly eyes tilted up toward the camera. Which way he falls
 * is the whole gag: face-down is a dead prop, face-up is a character who has
 * had a day — and the game-over card is looking straight at him.
 */
const TIP = 1.35;

export interface DeathPose {
  /** Non-uniform scale, volume-preserving. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  /** Height above the road. */
  readonly y: number;
  /** How far he has been punted back toward the camera (world units, +Z). */
  readonly z: number;
  /** Lateral scatter on the punt (world units, added to his crash X). */
  readonly x: number;
  /** Yaw, radians. */
  readonly spin: number;
  /** Backward tip, radians. Ends flat. */
  readonly tip: number;
  /** True once the animation has fully settled. */
  readonly done: boolean;
}

const WRECK_LATERAL = 1 / Math.sqrt(WRECK_Y);
const REST: DeathPose = {
  scaleX: WRECK_LATERAL,
  scaleY: WRECK_Y,
  scaleZ: WRECK_LATERAL,
  y: 0,
  z: KNOCKBACK,
  x: KNOCK_SIDE,
  spin: SPIN,
  tip: TIP,
  done: true,
};

/** Ease out cubic. */
function outCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Ease in-out on a normalised 0..1 span. */
function inOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Normalise `value` into 0..1 across [from, to]. */
function span(value: number, from: number, to: number): number {
  const t = (value - from) / (to - from);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * The pose `t` seconds after impact.
 *
 * Defined for every t: negative reads as rest-before-impact, past the end reads
 * as the settled pose, so a renderer can call it unconditionally.
 */
export function deathPose(t: number): DeathPose {
  if (t <= 0) {
    return {
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      y: 0,
      z: 0,
      x: 0,
      spin: 0,
      tip: 0,
      done: false,
    };
  }
  if (t >= DEATH_DURATION) return REST;

  let scaleY: number;
  let y: number;

  if (t < SQUASH_END) {
    // Impact: slam flat, fast.
    scaleY = 1 + (SQUASH_Y - 1) * outCubic(span(t, 0, SQUASH_END));
    y = 0;
  } else if (t < STRETCH_END) {
    // Rebound: overshoot tall while launching upward.
    const k = span(t, SQUASH_END, STRETCH_END);
    scaleY = SQUASH_Y + (STRETCH_Y - SQUASH_Y) * outCubic(k);
    y = HOP_HEIGHT * inOut(k);
  } else if (t < TUMBLE_END) {
    // Fall: relax the stretch on the way down, land with a little squash.
    const k = span(t, STRETCH_END, TUMBLE_END);
    scaleY = STRETCH_Y + (0.72 - STRETCH_Y) * inOut(k);
    y = HOP_HEIGHT * (1 - k * k);
  } else {
    // Settle: wobble from the landing squash into the stable flattened wreck.
    const k = span(t, TUMBLE_END, DEATH_DURATION);
    const base = 0.72 + (WRECK_Y - 0.72) * outCubic(k);
    const wobble = Math.sin(k * Math.PI * 4) * 0.12 * (1 - k) ** 2;
    scaleY = base + wobble;
    y = 0;
  }

  // Volume preservation: the horizontal axes take back whatever Y gave up.
  const lateral = 1 / Math.sqrt(scaleY);
  const progress = span(t, 0, DEATH_DURATION);
  // The punt decelerates hard — struck, then skidding to a stop — rather than
  // travelling linearly, which would read as him walking away from the crash.
  const knock = outCubic(progress);
  return {
    scaleX: lateral,
    scaleY,
    scaleZ: lateral,
    y,
    z: KNOCKBACK * knock,
    x: KNOCK_SIDE * knock,
    spin: SPIN * outCubic(progress),
    tip: TIP * inOut(span(t, SQUASH_END, TUMBLE_END)),
    done: false,
  };
}
