/**
 * `EntityField` — the reusable spawn + recycle pool that every moving world
 * object rides on. Pure (no three.js / DOM), so the whole spawn cadence and
 * recycling policy is unit-testable under Vitest.
 *
 * ── How to reuse this (ticket 03: friends) ────────────────────────────────────
 * Don't write a second pool. Construct another field with a different
 * `spawn` callback and drive it from the same loop:
 *
 * ```ts
 * const friends = new EntityField({
 *   capacity: 12,
 *   rng: createRng(seed),
 *   // Cadence: seconds between spawns, given the current forward speed.
 *   interval: (speed) => 90 / speed,
 *   // Build one entity. `occupiedLanes` lists lanes already taken at the
 *   // spawn line this tick, so a friend never spawns inside a car.
 *   spawn: (rng, occupiedLanes) => {
 *     const lane = pickFreeLane(rng, occupiedLanes);
 *     return lane === null ? null : { kind: 'friend', lane, z: SPAWN_Z, ... };
 *   },
 * });
 *
 * friends.update(dt, state.speed);
 * const hit = findHit(friends.entities, garyCollider, 'friend', laneToX);
 * if (hit) { friends.despawn(hit); store.addFriends(); }
 * ```
 *
 * Both fields share the collision helpers in `./collision.ts`, so a friend is
 * collected by the exact predicate that flattens Gary — just a different `kind`
 * and a different consequence.
 */
import type { Entity, EntitySpec } from './entity.ts';
import type { Rng } from './rng.ts';

/**
 * Build one entity for this spawn beat, or return null to skip the beat (e.g.
 * every lane is already blocked). `occupiedLanes` holds the lanes taken near
 * the spawn line, so callers can guarantee a passable gap.
 */
export type SpawnFn = (
  rng: Rng,
  occupiedLanes: readonly number[],
) => EntitySpec | null;

export interface EntityFieldOptions {
  /** Max simultaneous live entities. The pool never allocates beyond this. */
  capacity: number;
  /** Deterministic randomness source (see ./rng.ts). */
  rng: Rng;
  /**
   * Seconds until the next spawn beat at a given forward speed. Cadence scales
   * here. The rng is passed in so jitter stays on the seeded path (never
   * Math.random), keeping whole runs reproducible.
   */
  interval: (speed: number, rng: Rng) => number;
  /** Produces the next entity (or null to skip this beat). */
  spawn: SpawnFn;
  /** Entities are recycled once they pass this Z (behind the camera). */
  recycleZ?: number;
  /** Lanes within this Z distance of the spawn line count as occupied. */
  spawnGuardDepth?: number;
  /** Z at which entities are considered "at the spawn line" for guarding. */
  spawnZ?: number;
}

const DEFAULT_RECYCLE_Z = 16;
const DEFAULT_SPAWN_GUARD_DEPTH = 14;
const DEFAULT_SPAWN_Z = -140;

export class EntityField {
  /** Live view over the pool. Read-only to callers; slots are reused in place. */
  readonly entities: readonly Entity[];

  private readonly pool: Entity[] = [];
  private readonly options: Required<EntityFieldOptions>;
  private readonly occupied: number[] = [];
  private timer = 0;
  /** Delay for the next beat, drawn once per beat. Null = not yet drawn. */
  private nextInterval: number | null = null;
  private nextId = 1;

  constructor(options: EntityFieldOptions) {
    this.options = {
      recycleZ: DEFAULT_RECYCLE_Z,
      spawnGuardDepth: DEFAULT_SPAWN_GUARD_DEPTH,
      spawnZ: DEFAULT_SPAWN_Z,
      ...options,
    };
    for (let i = 0; i < this.options.capacity; i++) {
      this.pool.push({
        id: 0,
        kind: '',
        lane: 0,
        z: 0,
        prevZ: 0,
        speed: 0,
        halfWidth: 0,
        halfDepth: 0,
        variant: 0,
        active: false,
      });
    }
    this.entities = this.pool;
  }

  /** How many slots are currently live. */
  get activeCount(): number {
    let n = 0;
    for (const e of this.pool) if (e.active) n++;
    return n;
  }

  /**
   * Advance one tick: move every live entity toward the player, recycle the
   * ones that passed, then run the spawn cadence for the elapsed time.
   *
   * @param dt    seconds since the last tick
   * @param speed the player's forward speed (world-units/sec)
   */
  update(dt: number, speed: number): void {
    if (dt <= 0) return;

    for (const entity of this.pool) {
      if (!entity.active) continue;
      // Closing speed = the world rushing past + the entity's own approach.
      // prevZ is captured first so collision can sweep the step (see
      // ./collision.ts) instead of sampling a single instant and tunnelling.
      entity.prevZ = entity.z;
      entity.z += (speed + entity.speed) * dt;
      if (entity.z > this.options.recycleZ) entity.active = false;
    }

    this.tickSpawns(dt, speed);
  }

  /**
   * Force one spawn beat immediately, ignoring the cadence timer. Returns the
   * entity, or null if the pool is full or the spawner declined the beat.
   */
  spawnNow(): Entity | null {
    this.collectOccupiedLanes();
    const spec = this.options.spawn(this.options.rng, this.occupied);
    if (spec === null) return null;
    return this.inject(spec);
  }

  /**
   * Place an entity with exact, caller-chosen values — bypassing the spawn rule
   * entirely. This is the deterministic path the test hooks use:
   * `__forceCollision()` injects a vehicle on top of Gary, and ticket 03's
   * `__spawnFriend()` will inject a friend in a known lane. Returns null only
   * if the pool is full.
   */
  inject(spec: EntitySpec): Entity | null {
    const slot = this.pool.find((e) => !e.active);
    if (!slot) return null;

    slot.id = this.nextId++;
    slot.kind = spec.kind;
    slot.lane = spec.lane;
    slot.z = spec.z;
    // A fresh spawn has swept nothing yet: prevZ === z means the swept test
    // degenerates to a point test on its first tick, which is correct.
    slot.prevZ = spec.z;
    slot.speed = spec.speed;
    slot.halfWidth = spec.halfWidth;
    slot.halfDepth = spec.halfDepth;
    slot.variant = spec.variant;
    slot.active = true;
    return slot;
  }

  /** Retire one entity (a collected friend, a consumed obstacle). */
  despawn(entity: Entity): void {
    entity.active = false;
  }

  /** Clear the field and the cadence timer — used by start()/reset(). */
  clear(): void {
    for (const entity of this.pool) entity.active = false;
    this.timer = 0;
    this.nextInterval = null;
  }

  /**
   * Run the cadence for `dt`. The interval shrinks as speed grows, so traffic
   * arrives more often the faster Gary goes — density ramps with difficulty
   * rather than staying flat. Loops (rather than spawning at most once) so a
   * long frame can't silently swallow a beat.
   */
  private tickSpawns(dt: number, speed: number): void {
    if (speed <= 0) return;
    this.timer += dt;
    let guard = this.options.capacity;
    for (;;) {
      // The next beat's delay is drawn once and held, so a jittered interval is
      // a stable deadline rather than a value that re-rolls every frame.
      if (this.nextInterval === null) {
        this.nextInterval = Math.max(
          0.05,
          this.options.interval(speed, this.options.rng),
        );
      }
      if (this.timer < this.nextInterval) break;
      this.timer -= this.nextInterval;
      this.nextInterval = null;
      this.spawnNow();
      if (--guard <= 0) {
        this.timer = 0;
        break;
      }
    }
  }

  /**
   * Lanes blocked between the spawn line and `spawnGuardDepth` in FRONT of it
   * (i.e. already travelled toward the player), so a beat can leave a way
   * through. Deliberately one-sided: nothing is ever further out than the spawn
   * line, and looking "behind" it would only ever count nothing.
   */
  private collectOccupiedLanes(): void {
    this.occupied.length = 0;
    const { spawnZ, spawnGuardDepth } = this.options;
    for (const entity of this.pool) {
      if (!entity.active) continue;
      const travelled = entity.z - spawnZ;
      if (travelled >= 0 && travelled <= spawnGuardDepth) {
        this.occupied.push(entity.lane);
      }
    }
  }
}
