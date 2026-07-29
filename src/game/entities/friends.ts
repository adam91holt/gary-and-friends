/**
 * Friend spawn rules: *where and when* a collectible cone appears on the road.
 *
 * Pure (no three.js) and built on the shared `EntityField`, exactly as the
 * foundation intended — friends are the entity layer's second consumer, not a
 * parallel implementation. `src/scene/friends.ts` decides what they look like;
 * `src/game/friends/roster.ts` says who they are.
 */
import { FRIEND_COUNT, friendProfile } from '../friends/roster.ts';
import { BASE_SPEED, LANE_COUNT } from '../state.ts';
import type { EntitySpec } from './entity.ts';
import { EntityField } from './field.ts';
import { createRng, randomIndex, randomRange, type Rng } from './rng.ts';
import { TRAFFIC_APPROACH } from './traffic.ts';

/** Entity kind tag for collectible friends. Traffic uses 'traffic'. */
export const FRIEND_KIND = 'friend';

/** How far ahead of Gary a friend materialises (out past the fog). */
export const FRIEND_SPAWN_Z = -150;
/** Past this Z a friend is behind the camera and its slot is recycled. */
export const FRIEND_RECYCLE_Z = 18;
/** Ceiling on live uncollected friends. Rarity is the point; they're a treat. */
export const FRIEND_CAPACITY = 6;

/**
 * Friends close at exactly the traffic closing speed, and that is deliberate.
 *
 * The road's fairness guarantee rests on nothing overtaking anything (see
 * `traffic.ts`): a lane that was free at spawn is still free on arrival. Give
 * friends a different speed and a car catches up to one, which turns a
 * collectible into *bait* — a reward dangled inside a hitbox. Matching the
 * field's one closing speed keeps the guarantee intact for both kinds.
 */
export const FRIEND_APPROACH = TRAFFIC_APPROACH;

/** World units of road between friend beats, before jitter. */
export const FRIEND_GAP = 108;
/** Beat spacing is multiplied by a random factor in this range. */
export const FRIEND_JITTER_MIN = 0.7;
export const FRIEND_JITTER_MAX = 1.5;

/**
 * Points for collecting a friend, before the convoy bonus. Worth roughly four
 * threaded gaps: picking someone up should feel like the best thing that can
 * happen in a run, not like a scoring rounding error.
 */
export const FRIEND_BASE_SCORE = 120;
/**
 * Extra points per friend ALREADY in the line. A long convoy pays more, so the
 * incentive curve bends toward the fantasy: keep everyone alive and go get one
 * more. Bounded by how long you can survive, which is exactly the risk.
 */
export const FRIEND_CONVOY_BONUS = 30;

/** Score awarded for a pickup when `alreadyCollected` friends are in tow. */
export function friendScore(alreadyCollected: number): number {
  const carried = alreadyCollected > 0 ? Math.floor(alreadyCollected) : 0;
  return FRIEND_BASE_SCORE + carried * FRIEND_CONVOY_BONUS;
}

/**
 * Seconds between friends at a given forward speed — derived from a fixed
 * spatial gap, like traffic, so density stays constant in road terms rather
 * than drying up as the run gets fast.
 */
export function friendInterval(speed: number, jitter = 1): number {
  return (FRIEND_GAP * jitter) / Math.max(1, speed);
}

/**
 * Pick a lane for a friend among those not already taken at the spawn line.
 *
 * Unlike `pickSpawnLane` this WILL take the last free lane: a friend is a
 * reward, not an obstacle, so a friend sitting in the only gap is a gift on the
 * line the player was going to take anyway — never a wall.
 */
export function pickFriendLane(
  rng: Rng,
  occupiedLanes: readonly number[],
): number | null {
  const free: number[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    if (!occupiedLanes.includes(lane)) free.push(lane);
  }
  if (free.length === 0) return null;
  return free[randomIndex(rng, free.length)];
}

/** Build the spec for one friend of a given roster variant, in a given lane. */
export function friendSpec(lane: number, variant: number, z: number): EntitySpec {
  const profile = friendProfile(variant);
  return {
    kind: FRIEND_KIND,
    lane,
    z,
    speed: FRIEND_APPROACH,
    halfWidth: profile.halfWidth,
    halfDepth: profile.halfDepth,
    variant,
  };
}

/** The spawn rule, exported so tests can drive it without a field. */
export function spawnFriend(
  rng: Rng,
  occupiedLanes: readonly number[],
): EntitySpec | null {
  const lane = pickFriendLane(rng, occupiedLanes);
  if (lane === null) return null;
  return friendSpec(lane, randomIndex(rng, FRIEND_COUNT), FRIEND_SPAWN_Z);
}

/**
 * How far back from the spawn line to treat a lane as taken. Just over one
 * traffic beat, so a friend is never dropped on top of a car that spawned a
 * moment earlier — the only overlap the shared field can produce.
 */
export const FRIEND_SPAWN_GUARD_DEPTH =
  FRIEND_GAP * 0.35 * ((BASE_SPEED + FRIEND_APPROACH) / BASE_SPEED) + 1;

/** A friend field wired with the rules above. `seed` makes runs reproducible. */
export function createFriendField(seed = 90210): EntityField {
  return new EntityField({
    capacity: FRIEND_CAPACITY,
    rngFactory: () => createRng(seed),
    interval: (speed, rng) =>
      friendInterval(speed, randomRange(rng, FRIEND_JITTER_MIN, FRIEND_JITTER_MAX)),
    spawn: spawnFriend,
    recycleZ: FRIEND_RECYCLE_Z,
    spawnZ: FRIEND_SPAWN_Z,
    spawnGuardDepth: FRIEND_SPAWN_GUARD_DEPTH,
  });
}
