/**
 * The shared entity shape for everything that travels down the highway toward
 * Gary — oncoming traffic today, collectible friends next (ticket 03).
 *
 * Pure data: an entity is a lane, a Z position, a size and a closing speed. It
 * knows nothing about three.js. The renderer projects these numbers onto meshes
 * (see src/scene/traffic.ts); the simulation only ever reads/writes the numbers.
 */

/** A pooled world object. Mutable by design — slots are recycled, not realloc'd. */
export interface Entity {
  /** Monotonic per-field id. Stable for the lifetime of one spawn. */
  id: number;
  /** What this is ('traffic', 'friend', ...). Lets one field host several kinds. */
  kind: string;
  /** Lane index (0..LANE_COUNT-1) this entity occupies. */
  lane: number;
  /** World Z. Negative is ahead of Gary; it grows toward him each tick. */
  z: number;
  /**
   * Z at the START of the current tick. Closing speeds reach ~65 units/sec, so
   * a single frame can step further than a hitbox is deep — collision must test
   * the swept interval [prevZ, z], never just the endpoint, or fast traffic
   * tunnels straight through Gary. Maintained by EntityField.update().
   */
  prevZ: number;
  /** Own closing speed, added to the player's forward speed (0 = static prop). */
  speed: number;
  /** Half-extent across the road (world units), for AABB tests. */
  halfWidth: number;
  /** Half-extent along the road (world units), for AABB tests. */
  halfDepth: number;
  /** Free-form renderer hint (mesh/colour variant). The simulation ignores it. */
  variant: number;
  /** False while the slot sits in the pool waiting to be reused. */
  active: boolean;
}

/** What a caller supplies to spawn one entity into a field. */
export interface EntitySpec {
  kind: string;
  lane: number;
  z: number;
  speed: number;
  halfWidth: number;
  halfDepth: number;
  variant: number;
}
