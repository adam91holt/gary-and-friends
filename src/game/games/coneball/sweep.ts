/**
 * Continuous collision for a moving circle against a static box.
 *
 * Pure math — no three.js, no DOM. This is Big Bounce's answer to the same
 * question the highway answered with `sweptOverlapsZ`: a fast object must not
 * be able to teleport through a thin one between two samples. The highway only
 * ever needed a 1D sweep because its traffic moved along a single axis; a ball
 * moves in the plane, so the test here is a real 2D sweep and it returns *when*
 * the hit happened, not merely whether it did — the step loop needs the time of
 * impact to place the ball on the surface and spend the rest of the frame
 * travelling along the reflected path.
 *
 * ── The method ──────────────────────────────────────────────────────────────
 * Minkowski: sweeping a circle of radius r against a box is the same problem as
 * sweeping a POINT against that box expanded by r — a rounded rectangle. So:
 *
 *   1. Slab-test the ray against the box expanded by r. That is exact for the
 *      four faces and conservative at the four corners (it tests the square
 *      corner rather than the rounded one).
 *   2. If the entry point lies in a corner region, redo that corner exactly as
 *      a ray/circle intersection against a radius-r circle on the box vertex.
 *
 * Step 2 is what stops a ball that passes diagonally *near* a drum's corner
 * from being deflected by a phantom square shoulder that isn't there.
 */

/** A point/vector in the court's XZ plane. */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** An axis-aligned box in the court's XZ plane. */
export interface Aabb {
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
}

/** Where and when a sweep struck, and which way the surface faces. */
export interface SweepHit {
  /** Fraction of the attempted movement travelled before contact, in [0, 1]. */
  readonly t: number;
  /** Unit surface normal at the contact point, pointing back at the mover. */
  readonly normal: Vec2;
}

/** Distance below which a movement vector is treated as no movement at all. */
const EPSILON = 1e-9;

/**
 * Sweep a circle of `radius` from `from` along `delta` against `box`.
 *
 * Returns the first contact, or null if the circle finishes the movement clear
 * of the box. A circle that STARTS overlapping reports `t = 0` with the
 * shallowest separating normal, so a solver can always push it back out rather
 * than letting it sink further in on the following frame.
 */
export function sweepCircleAabb(
  from: Vec2,
  delta: Vec2,
  radius: number,
  box: Aabb,
): SweepHit | null {
  const hw = box.halfWidth + radius;
  const hd = box.halfDepth + radius;

  // Movement in the box's frame.
  const px = from.x - box.x;
  const pz = from.z - box.z;

  // Already overlapping the expanded box: separate along the shallowest axis.
  if (Math.abs(px) < hw && Math.abs(pz) < hd) {
    const depthX = hw - Math.abs(px);
    const depthZ = hd - Math.abs(pz);
    const normal: Vec2 =
      depthX < depthZ
        ? { x: px >= 0 ? 1 : -1, z: 0 }
        : { x: 0, z: pz >= 0 ? 1 : -1 };
    return { t: 0, normal };
  }

  if (Math.abs(delta.x) < EPSILON && Math.abs(delta.z) < EPSILON) return null;

  const slabX = slab(px, delta.x, hw);
  const slabZ = slab(pz, delta.z, hd);
  if (slabX === null || slabZ === null) return null;

  const enter = Math.max(slabX.enter, slabZ.enter);
  const exit = Math.min(slabX.exit, slabZ.exit);
  if (enter > exit || enter > 1 || exit < 0) return null;

  const t = Math.max(0, enter);
  const hitX = px + delta.x * t;
  const hitZ = pz + delta.z * t;

  // Which slab produced the entry decides the candidate face.
  const onXFace = slabX.enter >= slabZ.enter;

  // A face hit is only genuine if the contact point sits within the box's REAL
  // extent on the other axis; past that we are in a rounded corner.
  if (onXFace && Math.abs(hitZ) <= box.halfDepth) {
    return { t, normal: { x: hitX >= 0 ? 1 : -1, z: 0 } };
  }
  if (!onXFace && Math.abs(hitX) <= box.halfWidth) {
    return { t, normal: { x: 0, z: hitZ >= 0 ? 1 : -1 } };
  }

  // Corner: solve the ray against the radius-r circle on the box's vertex.
  const cornerX = hitX >= 0 ? box.halfWidth : -box.halfWidth;
  const cornerZ = hitZ >= 0 ? box.halfDepth : -box.halfDepth;
  const cornerT = rayCircle(px, pz, delta.x, delta.z, cornerX, cornerZ, radius);
  if (cornerT === null || cornerT > 1) return null;

  const contactX = px + delta.x * cornerT - cornerX;
  const contactZ = pz + delta.z * cornerT - cornerZ;
  const length = Math.hypot(contactX, contactZ);
  if (length < EPSILON) {
    // Degenerate: dead centre on the vertex. Fall back to the entry face.
    return { t: cornerT, normal: { x: cornerX >= 0 ? 1 : -1, z: 0 } };
  }
  return {
    t: cornerT,
    normal: { x: contactX / length, z: contactZ / length },
  };
}

/**
 * The interval of the ray that lies inside one slab (|position| <= half), as
 * fractions of `delta`. Null when the ray runs parallel to the slab and starts
 * outside it — it can never enter.
 */
function slab(
  position: number,
  delta: number,
  half: number,
): { enter: number; exit: number } | null {
  if (Math.abs(delta) < EPSILON) {
    return Math.abs(position) <= half
      ? { enter: -Infinity, exit: Infinity }
      : null;
  }
  const inverse = 1 / delta;
  const a = (-half - position) * inverse;
  const b = (half - position) * inverse;
  return { enter: Math.min(a, b), exit: Math.max(a, b) };
}

/**
 * First intersection of a ray with a circle, as a fraction of the ray, or null.
 * Only forward hits (t >= 0) count — a ball already past a corner has not just
 * hit it from behind.
 */
function rayCircle(
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  centerX: number,
  centerZ: number,
  radius: number,
): number | null {
  const ox = originX - centerX;
  const oz = originZ - centerZ;
  const a = dirX * dirX + dirZ * dirZ;
  if (a < EPSILON) return null;
  const b = 2 * (ox * dirX + oz * dirZ);
  const c = ox * ox + oz * oz - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t0 = (-b - root) / (2 * a);
  if (t0 >= 0) return t0;
  const t1 = (-b + root) / (2 * a);
  return t1 >= 0 ? t1 : null;
}

/** Reflect `velocity` about a unit `normal`. Plain mirror; no restitution. */
export function reflect(velocity: Vec2, normal: Vec2): Vec2 {
  const dot = velocity.x * normal.x + velocity.z * normal.z;
  return {
    x: velocity.x - 2 * dot * normal.x,
    z: velocity.z - 2 * dot * normal.z,
  };
}
