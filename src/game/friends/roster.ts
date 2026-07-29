/**
 * The cast. Five named cone-friends Gary can pick up, as pure data.
 *
 * No three.js, no DOM — a friend is a name, a silhouette and a hitbox, and both
 * sides of the seam index this table by `variant`: the simulation reads the
 * half-extents for collision, the renderer reads the radius/height/tint to
 * build the mesh, and the HUD reads the name. One table means a friend can
 * never be drawn as a different cone from the one you collided with.
 *
 * Characterisation is carried by SILHOUETTE first (the same decision traffic
 * makes) — tall and slim vs. short and wide reads instantly at speed, where a
 * hue shift alone would not. Tints are accent-family warms drawn from the token
 * layer (src/theme.ts), so the convoy reads as Gary's people and never competes
 * with the cool grey traffic he is dodging.
 */
import { FRIEND_TINTS } from '../../theme.ts';

export interface FriendProfile {
  /** Full name — shown in the collect flourish. */
  readonly name: string;
  /** Roster-rail label; the rail is narrow and full names would wrap. */
  readonly short: string;
  /** Cone radius at the road (world units). Drives the drawn mesh. */
  readonly baseRadius: number;
  /** Cone height (world units). */
  readonly height: number;
  /** Collision half-extent across the road. */
  readonly halfWidth: number;
  /** Collision half-extent along the road. */
  readonly halfDepth: number;
  /** Shell colour, from the shared token layer. */
  readonly tint: number;
  /** White reflective bands, as fractions of the cone height. */
  readonly bands: readonly number[];
  /** Sir Cones-a-lot wears a little topper. Nobody else does. */
  readonly topper: boolean;
}

/**
 * Pickup boxes are padded relative to the drawn cone. Collectibles should be
 * generous where obstacles are tight: missing a friend you clearly drove over
 * feels broken, whereas a hitbox slightly larger than the art just feels kind.
 */
const PICKUP_PAD = 0.2;

function profile(
  name: string,
  short: string,
  baseRadius: number,
  height: number,
  tint: number,
  bands: readonly number[],
  topper = false,
): FriendProfile {
  return {
    name,
    short,
    baseRadius,
    height,
    halfWidth: baseRadius + PICKUP_PAD,
    halfDepth: baseRadius + PICKUP_PAD,
    tint,
    bands,
    topper,
  };
}

/**
 * `variant` indexes this array. Order is stable and load-bearing: the HUD
 * roster rail, the deterministic `__spawnFriend()` cycle and the CSS chip
 * tokens (--friend-1..5) all count from the same place.
 */
export const FRIENDS: readonly FriendProfile[] = [
  // Coneelia — tall and slender, the elegant one. Two high bands.
  profile('Coneelia', 'Coneelia', 0.32, 1.6, FRIEND_TINTS[0], [0.58, 0.84]),
  // Bartholocone — squat and very broad, unbothered. One fat central band.
  profile('Bartholocone', 'Bartholo', 0.6, 0.8, FRIEND_TINTS[1], [0.48]),
  // Sir Cones-a-lot — narrow, the tallest, and wears a topper nobody else has.
  profile('Sir Cones-a-lot', 'Sir Cones', 0.27, 1.95, FRIEND_TINTS[2], [0.4, 0.66, 0.88], true),
  // Tiny — half the height of anyone else. Easy to almost miss, hard to forget.
  profile('Tiny', 'Tiny', 0.22, 0.5, FRIEND_TINTS[3], [0.56]),
  // Big Dave — the largest cone on the road, wide AND tall.
  profile('Big Dave', 'Big Dave', 0.72, 1.4, FRIEND_TINTS[4], [0.42, 0.74]),
];

/** How many named friends exist. */
export const FRIEND_COUNT = FRIENDS.length;

/** Look up a profile, clamping junk rather than returning undefined. */
export function friendProfile(variant: number): FriendProfile {
  const i = Math.round(variant);
  if (Number.isNaN(i) || i < 0) return FRIENDS[0];
  return FRIENDS[Math.min(FRIEND_COUNT - 1, i)];
}
