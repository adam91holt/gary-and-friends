/**
 * `Run` — the gameplay simulation. Pure: it owns the traffic field, the
 * distance/score/speed ramp and the collision sweep, and it talks to the world
 * only through `GameStore` actions. No three.js, no DOM, no `window`, so the
 * entire core loop is exercised in Vitest at whatever timestep the test likes.
 *
 * The renderer (src/main.ts) does exactly two things with this: calls
 * `update(dt)` once a frame, and reads `traffic.entities` to place meshes. It
 * never decides anything.
 *
 * Ticket 03 hooks in here: add a second `EntityField` for friends beside
 * `traffic`, tick it in `update()`, and resolve it with the same `findHit`
 * helper — `store.addFriends()` on a hit instead of `store.gameOver()`.
 */
import { LANE_WIDTH, laneToX } from '../entities/lanes.ts';
import { findHit, type Collider } from '../entities/collision.ts';
import type { EntityField } from '../entities/field.ts';
import {
  createTrafficField,
  TRAFFIC_KIND,
  TRAFFIC_VARIANTS,
} from '../entities/traffic.ts';
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
export const NEAR_MISS_WINDOW = 8;

export interface RunOptions {
  /** Seed for traffic spawning. Fixed seed => byte-identical run. */
  seed?: number;
  /**
   * Called when Gary squeezes past a vehicle. The renderer turns this into
   * feedback (whoosh + HUD flash); the simulation stays presentation-free.
   */
  onNearMiss?: () => void;
}

export class Run {
  /** The traffic pool. Read by the renderer to place meshes; owned here. */
  readonly traffic: EntityField;

  /** World units travelled this run. Drives both score and the speed ramp. */
  private distance = 0;
  /** Points awarded outside the distance rule (near misses). Score only. */
  private bonus = 0;
  private grace = 0;
  /** Gary's continuous X, so a hit lands mid-lane-change too. */
  private garyX: number;
  private readonly collider: Collider;
  private readonly onNearMiss: (() => void) | null;
  /** Tightest gap seen so far per approaching entity id. */
  private readonly closest = new Map<number, number>();
  /** Near misses credited this run. */
  private nearMissCount = 0;

  constructor(
    private readonly store: GameStore,
    options: RunOptions = {},
  ) {
    this.onNearMiss = options.onNearMiss ?? null;
    this.traffic = createTrafficField(options.seed ?? 1337);
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
    this.closest.clear();
    this.distance = 0;
    this.bonus = 0;
    this.nearMissCount = 0;
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

    // 3. Move + recycle + spawn traffic at the *new* speed.
    this.traffic.update(dt, this.store.getState().speed);

    // 4. Resolve collisions.
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    this.collider.x = this.garyX;
    this.collider.lane = this.store.getState().lane;
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
