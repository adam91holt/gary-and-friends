/**
 * `Run` — the gameplay simulation. Pure: it owns the traffic field, the
 * distance/score/speed ramp and the collision sweep, and it talks to the world
 * only through `GameStore` actions. No three.js, no DOM, no `window`, so the
 * entire core loop is exercised in Vitest at whatever timestep the test likes.
 *
 * The renderer (src/main.ts) does exactly two things with this: calls
 * `update(dt)` once a frame, and reads `traffic.entities` / `friends.entities`
 * / `conga.members` to place meshes. It never decides anything.
 *
 * Two entity fields ride the same pool abstraction and the same swept collision
 * predicate — only the `kind` and the consequence differ: a vehicle ends the
 * run, a friend joins the conga line behind Gary.
 */
import { LANE_WIDTH, laneToX } from '../entities/lanes.ts';
import { findHit, type Collider } from '../entities/collision.ts';
import type { EntityField } from '../entities/field.ts';
import {
  createFriendField,
  FRIEND_KIND,
  friendScore,
  friendSpec,
} from '../entities/friends.ts';
import {
  createTrafficField,
  TRAFFIC_KIND,
  TRAFFIC_VARIANTS,
} from '../entities/traffic.ts';
import { CongaLine } from '../friends/conga.ts';
import { FRIEND_COUNT, friendProfile } from '../friends/roster.ts';
import { LANE_COUNT, type GameStore } from '../state.ts';
import { scoreForDistance, speedForDistance } from './difficulty.ts';

/** Gary's hitbox. Slightly tighter than his cone looks — near-misses should
 *  feel like near-misses, and a generous-to-the-player box is the difference
 *  between "that was close" and "that was unfair". */
export const GARY_HALF_WIDTH = 0.42;
export const GARY_HALF_DEPTH = 0.55;
/** Gary holds world Z 0; the road scrolls past him. */
export const GARY_Z = 0;

/**
 * Seconds of invulnerability at the start of a run. Traffic spawns far out, so
 * this is belt-and-braces: a restart can never drop the player straight into a
 * car that a previous frame left mid-air.
 */
export const SPAWN_GRACE = 0.35;

/**
 * Lateral gap (world units, edge to edge) under which a passing vehicle counts
 * as a near miss. Smaller than a lane width, so it only fires when Gary is
 * genuinely tucked alongside something rather than merely in the next lane.
 */
export const NEAR_MISS_GAP = 0.55;

/** Points for threading a gap. Dodging closely is the skill; pay it. */
export const NEAR_MISS_BONUS = 25;

/**
 * How far ahead of Gary a vehicle starts counting as a "close approach" for
 * near-miss purposes. Roughly the length of a late swerve at speed.
 */
export const NEAR_MISS_WINDOW = 12;

/**
 * Where `__spawnFriend()` drops its friend: close enough that a test collects
 * within a frame or two at any speed, far enough that the cone is genuinely
 * visible arriving (so the e2e screenshot shows a pickup, not a teleport).
 */
export const TEST_FRIEND_SPAWN_Z = -12;

/** What the renderer is told about a friend the moment Gary collects them. */
export interface FriendPickup {
  /** Roster index (see ../friends/roster.ts). */
  readonly variant: number;
  /** The friend's name, for the HUD flourish. */
  readonly name: string;
  /** Points this pickup was worth (base + convoy bonus). */
  readonly points: number;
  /** How long the conga line is now, including this arrival. */
  readonly total: number;
}

export interface RunOptions {
  /** Seed for traffic spawning. Fixed seed => byte-identical run. */
  seed?: number;
  /**
   * Called when Gary squeezes past a vehicle. The renderer turns this into
   * feedback (whoosh + HUD flash); the simulation stays presentation-free.
   */
  onNearMiss?: () => void;
  /**
   * Called when Gary picks a friend up. Same contract as `onNearMiss`: the
   * simulation reports *what happened*, the renderer decides how it feels.
   */
  onFriend?: (pickup: FriendPickup) => void;
}

export class Run {
  /** The traffic pool. Read by the renderer to place meshes; owned here. */
  readonly traffic: EntityField;

  /** The collectible-friend pool. Same abstraction, different consequence. */
  readonly friends: EntityField;

  /** The tail of collected friends trailing Gary. Placed by the renderer. */
  readonly conga = new CongaLine();

  /** World units travelled this run. Drives both score and the speed ramp. */
  private distance = 0;
  /** Points awarded outside the distance rule (near misses). Score only. */
  private bonus = 0;
  private grace = 0;
  /** Gary's continuous X, so a hit lands mid-lane-change too. */
  private garyX: number;
  private readonly collider: Collider;
  private readonly onNearMiss: (() => void) | null;
  private readonly onFriend: ((pickup: FriendPickup) => void) | null;
  /** Tightest gap seen so far per approaching entity id. */
  private readonly closest = new Map<number, number>();
  /** Near misses credited this run. */
  private nearMissCount = 0;
  /**
   * Rotates the roster for the deterministic `__spawnFriend()` hook, so an e2e
   * test that collects five in a row meets five different characters rather
   * than five Tinys.
   */
  private injectCursor = 0;

  constructor(
    private readonly store: GameStore,
    options: RunOptions = {},
  ) {
    this.onNearMiss = options.onNearMiss ?? null;
    this.onFriend = options.onFriend ?? null;
    this.traffic = createTrafficField(options.seed ?? 1337);
    // Offset seed: friends and traffic must not draw the same lane sequence,
    // or every friend would materialise in lockstep with a vehicle.
    this.friends = createFriendField((options.seed ?? 1337) * 7 + 11);
    this.garyX = laneToX(store.getState().lane);
    this.collider = {
      x: this.garyX,
      z: GARY_Z,
      lane: store.getState().lane,
      halfWidth: GARY_HALF_WIDTH,
      halfDepth: GARY_HALF_DEPTH,
    };
  }

  /** Distance travelled this run (world units). */
  get travelled(): number {
    return this.distance;
  }

  /** Vehicles threaded this run. Projected onto the test API. */
  get nearMisses(): number {
    return this.nearMissCount;
  }

  /**
   * Wipe the field and the run counters back to a clean, playable state. Call
   * on every menu|gameover -> playing transition; `GameStore.start()` resets
   * score/speed/lane, this resets everything the store doesn't own.
   */
  reset(): void {
    this.traffic.clear();
    this.friends.clear();
    this.conga.clear();
    this.closest.clear();
    this.distance = 0;
    this.bonus = 0;
    this.nearMissCount = 0;
    this.injectCursor = 0;
    this.grace = SPAWN_GRACE;
    this.garyX = laneToX(this.store.getState().lane);
    this.collider.x = this.garyX;
    this.collider.lane = this.store.getState().lane;
  }

  /**
   * Report Gary's rendered X so collision matches what the player can see. The
   * renderer damps him toward his lane; if collision used the lane index alone,
   * a lane change would teleport the hitbox ahead of the visible cone.
   */
  setGaryX(x: number): void {
    this.garyX = x;
  }

  /**
   * Advance the simulation one frame. No-op unless playing, which is what makes
   * game-over stop the world: traffic freezes, distance stops, score holds.
   */
  update(dt: number): void {
    const state = this.store.getState();
    if (state.status !== 'playing' || dt <= 0) return;

    // 1. Difficulty ramp — speed is a pure function of distance travelled, so
    //    it is impossible for the ramp to drift out of sync with the run.
    this.distance += state.speed * dt;
    this.store.setSpeed(speedForDistance(this.distance));

    // 2. Score follows distance (also pure), plus any near-miss bonus already
    //    banked; the store only ever sees the delta it hasn't been told about.
    const target = scoreForDistance(this.distance) + this.bonus;
    const delta = target - state.score;
    if (delta > 0) this.store.addScore(delta);

    // 3. Move + recycle + spawn both fields at the *new* speed. Friends already
    //    use traffic as external occupancy. Traffic keeps its seeded lane stream,
    //    then yields any exact cross-field overlap to the collectible so a reward
    //    can never arrive hidden inside a fatal hitbox.
    const speed = this.store.getState().speed;
    this.traffic.update(dt, speed);
    this.separateCrossFieldSpawns();
    this.friends.update(dt, speed, this.traffic.entities);

    // 4. Drag the conga line along Gary's path. Done every tick (not only on a
    //    pickup) so the tail keeps flowing through lane changes.
    this.conga.advance(dt, speed * dt, this.garyX);

    this.collider.x = this.garyX;
    this.collider.lane = this.store.getState().lane;

    // 5. Collect friends. Deliberately OUTSIDE the grace window: grace exists
    //    so a restart can't drop the player into a car, and there is no reason
    //    a reward should be unavailable for the first third of a second.
    this.collectFriends();

    // 6. Resolve collisions.
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    const hit = findHit(
      this.traffic.entities,
      this.collider,
      TRAFFIC_KIND,
      laneToX,
    );
    if (hit) {
      this.store.gameOver();
      return;
    }

    this.scoreNearMisses();
  }

  /**
   * Separate independent beats that land a car inside a collectible. Both kinds
   * close at the same speed, so a spawn overlap would otherwise remain locked all
   * the way to Gary. Move the still-distant reward to a clear lane, preserving
   * the traffic stream and its fairness cadence; only discard the car if every
   * lane is genuinely occupied at that exact depth.
   */
  private separateCrossFieldSpawns(): void {
    for (const friend of this.friends.entities) {
      if (!friend.active || friend.kind !== FRIEND_KIND) continue;
      const overlapping = this.traffic.entities.find(
        (traffic) =>
          traffic.active &&
          traffic.kind === TRAFFIC_KIND &&
          traffic.lane === friend.lane &&
          Math.abs(traffic.z - friend.z) <=
            traffic.halfDepth + friend.halfDepth,
      );
      if (!overlapping) continue;

      let clearLane: number | null = null;
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        const occupiedByTraffic = this.traffic.entities.some(
          (traffic) =>
            traffic.active &&
            traffic.kind === TRAFFIC_KIND &&
            traffic.lane === lane &&
            Math.abs(traffic.z - friend.z) <=
              traffic.halfDepth + friend.halfDepth,
        );
        const occupiedByFriend = this.friends.entities.some(
          (other) =>
            other !== friend &&
            other.active &&
            other.kind === FRIEND_KIND &&
            other.lane === lane &&
            Math.abs(other.z - friend.z) <= other.halfDepth + friend.halfDepth,
        );
        if (!occupiedByTraffic && !occupiedByFriend) {
          clearLane = lane;
          break;
        }
      }

      if (clearLane === null) this.traffic.despawn(overlapping);
      else friend.lane = clearLane;
    }
  }

  /**
   * Credit vehicles Gary has just squeezed past. This is what makes the dodge
   * verb feel like a skill rather than an avoidance chore: threading a gap pays
   * more than sitting in an empty lane, so the optimal line is the risky one.
   *
   * The gap is tracked as the MINIMUM over the whole close approach, not
   * sampled at the instant of crossing. That matters: a late dodge — swerving
   * out as a truck arrives — is the most exciting thing a player can do, but by
   * the moment the truck draws level Gary has often already reached the safety
   * of the next lane, so an instantaneous sample scores it as a boring clean
   * pass. Minimum-over-approach measures what the player actually felt.
   *
   * Each entity crosses Gary only once; `prevZ` makes the passing tick unique.
   */
  private scoreNearMisses(): void {
    for (const entity of this.traffic.entities) {
      if (!entity.active || entity.kind !== TRAFFIC_KIND) continue;

      // Phase 2 first: has it drawn level with Gary this tick?
      const passing = entity.z >= GARY_Z && entity.prevZ < GARY_Z;

      // Phase 1: while it is within the approach window — or on the very tick
      // it passes — remember the tightest gap. Sampling on the passing tick too
      // means a vehicle that crosses the whole window in one step (a very fast
      // closing speed, or a hitched frame) is still measured rather than
      // silently scoring nothing.
      if (passing || (entity.z > -NEAR_MISS_WINDOW && entity.z < GARY_Z)) {
        const gap =
          Math.abs(this.garyX - laneToX(entity.lane)) -
          (GARY_HALF_WIDTH + entity.halfWidth);
        const best = this.closest.get(entity.id);
        if (best === undefined || gap < best) this.closest.set(entity.id, gap);
      }

      if (!passing) continue;

      // Settle up.
      const closest = this.closest.get(entity.id);
      this.closest.delete(entity.id);
      if (closest === undefined || closest > NEAR_MISS_GAP) continue;

      // Bonus is tracked separately from distance so the speed ramp stays a
      // pure function of road travelled — skilful play scores faster, it
      // doesn't secretly make the game harder.
      this.bonus += NEAR_MISS_BONUS;
      this.nearMissCount++;
      this.store.addScore(NEAR_MISS_BONUS);
      this.onNearMiss?.();
    }
  }

  /**
   * Pick up every friend overlapping Gary this tick, through the exact same
   * swept predicate that flattens him against a truck. Only the consequence
   * differs: the cone leaves the field and joins the tail instead of ending
   * the run.
   *
   * Loops until clear rather than collecting one per frame — two friends can
   * legitimately overlap Gary in the same tick at top speed, and silently
   * dropping one would be a bug the player would feel and never be able to
   * describe.
   */
  private collectFriends(): void {
    for (;;) {
      const found = findHit(
        this.friends.entities,
        this.collider,
        FRIEND_KIND,
        laneToX,
      );
      if (found === null) return;

      this.friends.despawn(found);
      const profile = friendProfile(found.variant);
      // Convoy bonus reads the line BEFORE this arrival, so the first friend
      // is worth the base and each subsequent one is worth more.
      const points = friendScore(this.conga.length);
      this.conga.join(found.variant, profile.name);

      // Banked as bonus (not distance) so the speed ramp stays a pure function
      // of road travelled — collecting friends scores faster, it never
      // secretly makes the game harder.
      this.bonus += points;
      this.store.addScore(points);
      this.store.addFriends();
      this.onFriend?.({
        variant: found.variant,
        name: profile.name,
        points,
        total: this.conga.length,
      });
    }
  }

  /**
   * Deterministic hook behind `__spawnFriend()`: place a friend directly in
   * Gary's lane, just far enough ahead to be seen arriving.
   *
   * It bypasses the cadence and the RNG entirely (so a test never waits on a
   * random beat) but goes through the normal field + collision path, so
   * collecting one exercises the real pickup rule rather than poking the store.
   * The roster cycles per call: five hook calls introduce five characters.
   */
  spawnFriend(): number | null {
    if (this.store.getState().status !== 'playing') return null;

    const variant = this.injectCursor % FRIEND_COUNT;
    if (this.friends.activeCount === this.friends.entities.length) {
      // Never make a visible, still-collectible friend vanish to service a test
      // hook. Reuse only a cone that has already passed Gary and is merely
      // waiting for the normal recycle boundary; otherwise let the caller retry.
      const passed = this.friends.entities
        .filter(
          (entity) => entity.active && entity.z - entity.halfDepth > GARY_Z,
        )
        .sort((a, b) => b.z - a.z)[0];
      if (!passed) return null;
      this.friends.despawn(passed);
    }
    const injected = this.friends.inject(
      friendSpec(this.store.getState().lane, variant, TEST_FRIEND_SPAWN_Z),
    );
    if (injected === null) return null;
    this.injectCursor++;
    return variant;
  }

  /**
   * Deterministic hook behind `__forceCollision()`: park a vehicle exactly on
   * Gary and let the normal collision path end the run. Going through the real
   * predicate (rather than calling `gameOver()` directly) means the e2e test is
   * actually testing collision, not just the state machine.
   */
  forceCollision(): void {
    if (this.store.getState().status !== 'playing') return;

    this.grace = 0;
    let lane = 0;
    for (let candidate = 1; candidate < LANE_COUNT; candidate++) {
      if (
        Math.abs(this.garyX - laneToX(candidate)) <
        Math.abs(this.garyX - laneToX(lane))
      ) {
        lane = candidate;
      }
    }

    // Ensure a slot even at capacity: this deterministic hook owns the injected
    // obstacle and must not bypass collision by directly changing store state.
    if (this.traffic.activeCount === this.traffic.entities.length) {
      const first = this.traffic.entities.find((entity) => entity.active);
      if (first) this.traffic.despawn(first);
    }
    const injected = this.traffic.inject({
      kind: TRAFFIC_KIND,
      lane,
      z: GARY_Z,
      speed: 0,
      // Gary can be exactly halfway between lanes. This test-only obstacle spans
      // half a lane so it still overlaps his rendered X during a lane change.
      halfWidth: LANE_WIDTH / 2,
      halfDepth: TRAFFIC_VARIANTS[1].halfDepth,
      variant: 1,
    });
    if (injected === null) return;

    this.collider.x = this.garyX;
    this.collider.lane = this.store.getState().lane;
    const hit = findHit(
      this.traffic.entities,
      this.collider,
      TRAFFIC_KIND,
      laneToX,
    );
    if (hit === null) {
      this.traffic.despawn(injected);
      return;
    }
    this.store.gameOver();
  }
}
