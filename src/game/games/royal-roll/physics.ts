/**
 * The Royal Roll disc solver: a deliberately tiny 2D physics kernel.
 *
 * Pure — no three.js, no DOM, no `window`, no npm dependency. Everything the
 * game needs is here in ~120 lines because the game only ever asks four
 * questions: how fast is this disc still going, has it hit a barrier, has it
 * hit another disc, and where is it now.
 *
 * ── Why hand-rolled rather than a physics package ───────────────────────────
 * A general engine buys features this game never uses (rotation, joints,
 * sleeping islands, broadphase) and costs the one property the game *does*
 * need: bit-for-bit repeatability. Everything below is fixed-substep and
 * allocation-free, so the same aim launched twice produces the same rack —
 * which is what makes the E2E lifecycle assertable and a replay honest.
 *
 * Coordinates are lane-local: `x` is lateral (0 = centre lane), `z` runs down
 * the lane away from the launch line. The renderer maps them into world space;
 * nothing in here knows which way three.js points.
 */

/** A moving circle on the lane deck. Mutated in place — no per-step garbage. */
export interface Disc {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Collision radius (world units). */
  readonly radius: number;
  /** Heavier discs shrug off impacts and give up less of their momentum. */
  readonly mass: number;
}

/**
 * Below this speed a disc is considered stopped and is snapped to rest.
 * Without it, exponential damping leaves a body creeping forever and the
 * "everything has settled" test never fires.
 */
export const REST_SPEED = 0.08;

/**
 * Two independent losses, because a rolling cone loses speed in two ways and
 * only modelling one of them feels wrong at a different end of the roll:
 *
 *  - `DAMPING` is proportional (air + deck scrub). It dominates while fast, and
 *    is what keeps a hard throw from crossing the whole lane at launch speed.
 *  - `ROLL_DECEL` is constant (the drag of a cone that isn't quite a wheel). It
 *    dominates once slow, and is what actually brings a dribbler to a stop in
 *    finite time instead of asymptotically.
 */
export const DAMPING = 0.55;
export const ROLL_DECEL = 1.4;

/**
 * How much of the approach speed survives a barrier bounce, and a disc-on-disc
 * hit. The barrier is deadened royal timber; cone-on-cone is livelier, because
 * the chain reaction down the rack is the whole payoff of a good line.
 */
export const BARRIER_RESTITUTION = 0.45;
export const DISC_RESTITUTION = 0.62;

/** The speed of a disc, as a plain number. */
export function speedOf(disc: Disc): number {
  return Math.hypot(disc.vx, disc.vz);
}

/**
 * The speed remaining after `dt` seconds of friction.
 *
 * Split out as a scalar function on purpose: it is the one rule the whole
 * "does a throw ever end?" guarantee rests on, so it is unit-tested directly
 * for monotonicity and for reaching exactly zero.
 */
export function frictionSpeed(speed: number, dt: number): number {
  if (speed <= 0 || dt <= 0) return speed > 0 ? speed : 0;
  const damped = speed * Math.exp(-DAMPING * dt) - ROLL_DECEL * dt;
  return damped > REST_SPEED ? damped : 0;
}

/** Scale a disc's velocity down to whatever friction left it. */
export function applyFriction(disc: Disc, dt: number): void {
  const speed = speedOf(disc);
  if (speed <= 0) {
    disc.vx = 0;
    disc.vz = 0;
    return;
  }
  const next = frictionSpeed(speed, dt);
  if (next <= 0) {
    disc.vx = 0;
    disc.vz = 0;
    return;
  }
  const scale = next / speed;
  disc.vx *= scale;
  disc.vz *= scale;
}

/** Advance a disc by its velocity. Position only — friction is a separate step
 *  so a test can hold one still and exercise the other. */
export function integrate(disc: Disc, dt: number): void {
  disc.x += disc.vx * dt;
  disc.z += disc.vz * dt;
}

/**
 * Keep a disc inside the lane. Barriers reflect (this lane has no gutter — the
 * royal roadworks are fenced), the launch line behind the player is solid, and
 * the sandbags at the far end absorb most of what reaches them.
 *
 * Returns the impact speed when a barrier was struck, 0 otherwise, so the view
 * can spark exactly as hard as the hit deserved.
 */
export function bounceOffWalls(
  disc: Disc,
  halfWidth: number,
  minZ: number,
  maxZ: number,
): number {
  let impact = 0;
  const limitX = halfWidth - disc.radius;
  if (disc.x < -limitX) {
    disc.x = -limitX;
    impact = Math.max(impact, Math.abs(disc.vx));
    disc.vx = Math.abs(disc.vx) * BARRIER_RESTITUTION;
  } else if (disc.x > limitX) {
    disc.x = limitX;
    impact = Math.max(impact, Math.abs(disc.vx));
    disc.vx = -Math.abs(disc.vx) * BARRIER_RESTITUTION;
  }

  const nearZ = minZ + disc.radius;
  const farZ = maxZ - disc.radius;
  if (disc.z < nearZ) {
    disc.z = nearZ;
    impact = Math.max(impact, Math.abs(disc.vz));
    disc.vz = Math.abs(disc.vz) * BARRIER_RESTITUTION;
  } else if (disc.z > farZ) {
    disc.z = farZ;
    impact = Math.max(impact, Math.abs(disc.vz));
    // Sandbags, not timber: the far end kills a throw rather than returning it.
    disc.vz = -Math.abs(disc.vz) * BARRIER_RESTITUTION * 0.5;
  }
  return impact;
}

/**
 * Resolve a circle/circle contact between two discs.
 *
 * Positional correction first (split by inverse mass so the heavy roller barges
 * through rather than being shoved aside), then a normal impulse. Tangential
 * velocity is untouched — cones slide past each other, they don't grip — which
 * keeps the solve one line of algebra and, more importantly, keeps a glancing
 * blow reading as a glancing blow.
 *
 * Returns the closing speed that was resolved (0 when they weren't touching, or
 * were already separating), which doubles as the impact strength for fx.
 */
export function collide(a: Disc, b: Disc): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minDistance = a.radius + b.radius;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq >= minDistance * minDistance) return 0;

  // Perfectly coincident centres have no normal to push along; nudge them apart
  // along the lane axis so the solve stays defined instead of producing NaN.
  const distance = Math.sqrt(distanceSq);
  const nx = distance > 1e-6 ? dx / distance : 0;
  const nz = distance > 1e-6 ? dz / distance : 1;

  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const invSum = invA + invB;

  const overlap = minDistance - distance;
  a.x -= nx * overlap * (invA / invSum);
  a.z -= nz * overlap * (invA / invSum);
  b.x += nx * overlap * (invB / invSum);
  b.z += nz * overlap * (invB / invSum);

  const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (closing >= 0) return 0; // already separating

  const impulse = (-(1 + DISC_RESTITUTION) * closing) / invSum;
  a.vx -= impulse * nx * invA;
  a.vz -= impulse * nz * invA;
  b.vx += impulse * nx * invB;
  b.vz += impulse * nz * invB;
  return -closing;
}
