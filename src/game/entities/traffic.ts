/**
 * Oncoming traffic: the thing Gary is dodging.
 *
 * Pure spawn rules only (no three.js) — this module decides *where and when* a
 * vehicle appears; `src/scene/traffic.ts` decides what it looks like. Built on
 * the generic `EntityField`, so ticket 03's friends get the same pool, the same
 * recycling and the same collision predicate for free.
 */
import { BASE_SPEED, LANE_COUNT } from '../state.ts';
import type { EntitySpec } from './entity.ts';
import { EntityField } from './field.ts';
import { createRng, randomIndex, randomRange, type Rng } from './rng.ts';

/** Entity kind tag for vehicles. Friends will use 'friend'. */
export const TRAFFIC_KIND = 'traffic';

/** How far ahead of Gary a vehicle materialises (out past the fog). */
export const TRAFFIC_SPAWN_Z = -150;
/** Past this Z a vehicle is behind the camera and its slot is recycled. */
export const TRAFFIC_RECYCLE_Z = 18;
/** Ceiling on live vehicles; the cadence never outruns the pool. */
export const TRAFFIC_CAPACITY = 14;

/**
 * Closing speed of oncoming traffic, on top of the player's forward speed.
 *
 * Deliberately UNIFORM across variants, and that is a load-bearing decision,
 * not a missing feature. Every vehicle in the field moves at exactly the same
 * rate, so the spatial gaps present at spawn are preserved for the whole life
 * of the run. That turns the spawn-time "never take the last free lane" rule
 * into a permanent guarantee: because nothing overtakes anything, a lane that
 * was open when a group spawned is still open when it arrives.
 *
 * With mixed speeds, a fast car could catch a slow one and quietly close the
 * third lane in front of the player with no way through — an unavoidable death
 * that no amount of skill answers. Character comes from silhouette instead.
 */
export const TRAFFIC_APPROACH = 7;

/**
 * The vehicle silhouettes. `variant` indexes this table on both sides of the
 * seam: the simulation uses the half-extents for collision, the renderer uses
 * the same index to pick a mesh, so hitboxes can never drift from what's drawn.
 */
export interface TrafficVariant {
  readonly halfWidth: number;
  readonly halfDepth: number;
}

export const TRAFFIC_VARIANTS: readonly TrafficVariant[] = [
  // Hatchback — small, the easiest thing to slip past.
  { halfWidth: 0.52, halfDepth: 1.0 },
  // Saloon — the baseline car.
  { halfWidth: 0.58, halfDepth: 1.25 },
  // Box truck — wide, tall, and very much in the way.
  { halfWidth: 0.68, halfDepth: 1.9 },
];

/** World units of road between spawn beats, before jitter. */
export const SPAWN_GAP = 26;
/** Beat spacing is multiplied by a random factor in this range. */
export const SPAWN_JITTER_MIN = 0.85;
export const SPAWN_JITTER_MAX = 1.3;

/**
 * Seconds between vehicles at a given forward speed. Cadence is derived from a
 * fixed *spatial* gap, so faster play means denser traffic automatically: the
 * road ahead always holds roughly the same number of cars, they just arrive
 * sooner.
 *
 * The jitter lives HERE (in the timing) rather than in the spawn Z, which
 * matters for fairness: jittering Z independently per vehicle can shuffle two
 * beats past each other and compress three spawns into one stretch of road,
 * walling off all three lanes. Jittering the interval only ever stretches or
 * mildly compresses the gap between consecutive beats, and never reorders them.
 */
export function trafficInterval(speed: number, jitter = 1): number {
  return (SPAWN_GAP * jitter) / Math.max(1, speed);
}

/**
 * Pick a lane that is not already blocked at the spawn line, and refuse the
 * beat entirely if filling one more lane would wall the road off. This is the
 * fairness guarantee: **there is always at least one passable lane.**
 */
export function pickSpawnLane(
  rng: Rng,
  occupiedLanes: readonly number[],
): number | null {
  const free: number[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    if (!occupiedLanes.includes(lane)) free.push(lane);
  }
  // Leave a gap: never take the last open lane.
  if (free.length <= 1) return null;
  return free[randomIndex(rng, free.length)];
}

/**
 * The spawn rule, exported so tests can drive it without a field.
 *
 * Every vehicle spawns at exactly TRAFFIC_SPAWN_Z — the variety comes from the
 * jittered *interval*, not from a per-vehicle Z offset. See `trafficInterval`.
 */
export function spawnTraffic(
  rng: Rng,
  occupiedLanes: readonly number[],
): EntitySpec | null {
  const lane = pickSpawnLane(rng, occupiedLanes);
  if (lane === null) return null;

  const variant = randomIndex(rng, TRAFFIC_VARIANTS.length);
  const shape = TRAFFIC_VARIANTS[variant];
  return {
    kind: TRAFFIC_KIND,
    lane,
    z: TRAFFIC_SPAWN_Z,
    speed: TRAFFIC_APPROACH,
    halfWidth: shape.halfWidth,
    halfDepth: shape.halfDepth,
    variant,
  };
}

/**
 * How far back from the spawn line to look for blocked lanes.
 *
 * Sized at just over TWO beat-gaps (using the widest jitter, so it holds in the
 * worst case). Combined with `pickSpawnLane` refusing the last free lane, this
 * is what makes "there is always a way through" a guarantee rather than a hope:
 * any two consecutive beats are visible to the third, so three spawns can never
 * occupy all three lanes within one stretch of road.
 */
export const SPAWN_GUARD_DEPTH =
  SPAWN_GAP *
    SPAWN_JITTER_MAX *
    ((BASE_SPEED + TRAFFIC_APPROACH) / BASE_SPEED) *
    2 +
  1;

/** A traffic field wired with the rules above. `seed` makes runs reproducible. */
export function createTrafficField(seed = 1337): EntityField {
  return new EntityField({
    capacity: TRAFFIC_CAPACITY,
    rngFactory: () => createRng(seed),
    interval: (speed, rng) =>
      trafficInterval(speed, randomRange(rng, SPAWN_JITTER_MIN, SPAWN_JITTER_MAX)),
    spawn: spawnTraffic,
    recycleZ: TRAFFIC_RECYCLE_Z,
    spawnZ: TRAFFIC_SPAWN_Z,
    spawnGuardDepth: SPAWN_GUARD_DEPTH,
  });
}
