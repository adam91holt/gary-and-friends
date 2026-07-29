/**
 * Collision math. Pure — no three.js, no meshes, no DOM.
 *
 * Deliberately mesh-independent: a hit is decided from lane + Z ranges, so the
 * exact same predicate that ends a run in the browser runs in Vitest in
 * microseconds. The renderer never gets a vote on whether something was hit.
 *
 * Two tiers, because the game needs both:
 *   - `sameLaneOverlap` — the cheap 1D test used by the traffic sweep (the
 *     player and traffic are always lane-snapped, so lane equality + Z overlap
 *     is exact and fast).
 *   - `aabbOverlap` — the 2D box test used when X is continuous (Gary mid-lerp
 *     between lanes, or ticket 03's friends drifting across lanes).
 */
import type { Entity } from './entity.ts';

/** The player's collidable footprint. X is continuous so mid-lerp hits count. */
export interface Collider {
  /** Continuous world X (Gary lerps, so this is not always a lane centre). */
  x: number;
  /** World Z (Gary stays at 0; kept explicit so friends can reuse this). */
  z: number;
  /** Lane index the player is considered to occupy. */
  lane: number;
  halfWidth: number;
  halfDepth: number;
}

/** 1D interval overlap on Z. */
export function overlapsZ(
  aZ: number,
  aHalfDepth: number,
  bZ: number,
  bHalfDepth: number,
): boolean {
  return Math.abs(aZ - bZ) < aHalfDepth + bHalfDepth;
}

/**
 * Swept 1D overlap: did the entity's hitbox cross the collider's at ANY point
 * while moving from `fromZ` to `toZ`?
 *
 * This is the anti-tunnelling test. Traffic closes at up to ~65 units/sec, so a
 * 60fps frame advances it ~1.1 units and a hitched frame far more — comfortably
 * past a 1-unit-deep box. A point-in-time check would let cars pass through
 * Gary at top speed; sweeping the interval makes a hit at speed as reliable as
 * one at a crawl.
 */
export function sweptOverlapsZ(
  colliderZ: number,
  colliderHalfDepth: number,
  fromZ: number,
  toZ: number,
  entityHalfDepth: number,
): boolean {
  const reach = colliderHalfDepth + entityHalfDepth;
  const lo = Math.min(fromZ, toZ);
  const hi = Math.max(fromZ, toZ);
  // The entity's centre swept [lo, hi]; a hit happens if that interval comes
  // within `reach` of the collider's centre.
  return hi > colliderZ - reach && lo < colliderZ + reach;
}

/** Lane-snapped hit test: same lane AND swept-overlapping Z ranges. */
export function sameLaneOverlap(collider: Collider, entity: Entity): boolean {
  if (collider.lane !== entity.lane) return false;
  return sweptOverlapsZ(
    collider.z,
    collider.halfDepth,
    entity.prevZ,
    entity.z,
    entity.halfDepth,
  );
}

/**
 * Continuous 2D (X/Z) box test, swept along Z. `entityX` is supplied by the
 * caller because the lane -> X mapping is world geometry, not collision's job.
 */
export function aabbOverlap(
  collider: Collider,
  entity: Entity,
  entityX: number,
): boolean {
  return (
    Math.abs(collider.x - entityX) < collider.halfWidth + entity.halfWidth &&
    sweptOverlapsZ(
      collider.z,
      collider.halfDepth,
      entity.prevZ,
      entity.z,
      entity.halfDepth,
    )
  );
}

/**
 * First active entity of `kind` hitting the collider, or null. Reused verbatim
 * by ticket 03: traffic asks for 'traffic' (-> gameOver), friends ask for
 * 'friend' (-> addFriends + despawn).
 */
export function findHit(
  entities: readonly Entity[],
  collider: Collider,
  kind: string,
  laneToX: (lane: number) => number,
): Entity | null {
  for (const entity of entities) {
    if (!entity.active || entity.kind !== kind) continue;
    if (aabbOverlap(collider, entity, laneToX(entity.lane))) return entity;
  }
  return null;
}
