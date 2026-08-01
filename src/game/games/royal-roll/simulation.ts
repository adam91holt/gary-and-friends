/**
 * Royal Roll — the whole game, as pure logic.
 *
 * No `three`, no DOM, no `window`, no `Math.random()`: every decision is either
 * arithmetic or comes out of a seeded `Rng`, so the entire game runs (and is
 * unit-tested) in the Vitest node environment, and the three.js lane in
 * `src/scene/games/royal-roll/` is a pure projection of the numbers below.
 *
 * ── The loop ────────────────────────────────────────────────────────────────
 *
 *   aiming    ← the player sweeps the launch angle inside a bounded arc
 *   rolling   ← `primary` commits it; the solver runs to a genuine standstill
 *   settling  ← a beat to read the result (and for the view to swing the
 *               result camera in) before the next throw is armed
 *
 * Ten throws make a run. A throw that leaves nothing standing pays a strike
 * bonus and re-racks the formation; otherwise the survivors stay exactly where
 * the last throw shoved them, so a run is a conversation with a rack you are
 * progressively wrecking.
 *
 * ── Why a throw always ends ─────────────────────────────────────────────────
 * `frictionSpeed` is strictly decreasing and snaps to zero below `REST_SPEED`,
 * so every body reaches exact rest in finite time — the settle check is a real
 * "is everything stopped?", never a timer pretending to be one. `MAX_ROLL_TIME`
 * exists only as a bound against a pathological solve, and is far beyond the
 * ~3s a maximum-speed throw actually takes to stop.
 */
import { createRng, type Rng } from '../../entities/rng.ts';
import {
  buildFormation,
  FORMATION_SIZE,
  LANE_HALF_WIDTH,
  LANE_MAX_Z,
  LANE_MIN_Z,
  type TargetSpec,
} from './formation.ts';
import {
  applyFriction,
  bounceOffWalls,
  collide,
  integrate,
  speedOf,
  type Disc,
} from './physics.ts';
import { scoreThrow, type ThrowResult } from './scoring.ts';

/** What the game is doing right now. */
export type RoyalRollPhase = 'aiming' | 'rolling' | 'settling';

/** Whether the run is still going. The shell's `GameStore` mirrors this. */
export type RoyalRollStatus = 'playing' | 'gameover';

/** Throws in a run. Ten rounds, one rack — the arcade default. */
export const THROWS_PER_RUN = 10;

/** How far off straight the aim may be swung, in radians (about ±21°). */
export const MAX_AIM = 0.36;
/** One press of left/right. 24 distinct aims across the arc. */
export const AIM_STEP = 0.03;

/**
 * Launch speed, in world units/sec. Fixed rather than a power meter: the ticket
 * is an AIM game, and a second axis of input would dilute the one decision the
 * player is actually making. Tuned so a clean straight throw only just reaches
 * the King — every cone you clip on the way costs you the back of the rack.
 */
export const LAUNCH_SPEED = 9.5;

/** Where the roller sits on the launch line. */
export const ROLLER_START_Z = 0.6;
export const ROLLER_RADIUS = 0.44;
export const ROLLER_MASS = 2.2;

/**
 * How far a cone must be shoved off its mark before it counts as knocked over.
 *
 * A displacement rule rather than an impact-force rule, because it is the one
 * the player can actually see: if the cone visibly left its spot, it went down.
 * Three quarters of a radius is past "grazed and wobbled" and short of "you'd
 * swear that one fell".
 */
export const KNOCK_DISPLACEMENT = 0.75;

/** Fixed solver substep. Small enough that a fast roller cannot tunnel a cone. */
export const SUBSTEP = 1 / 240;

/** Seconds the result is held before the next throw is armed. */
export const SETTLE_DURATION = 1.15;

/** Safety bound on one throw's solve (see the file header). */
export const MAX_ROLL_TIME = 12;

/** A cone on the deck: its spec, its live body, and whether it still stands. */
export interface RoyalRollTarget extends Disc {
  readonly id: number;
  readonly value: number;
  readonly variant: number;
  readonly royal: boolean;
  /** False once this throw shoved it off its mark. Cleared away on settle. */
  standing: boolean;
  /** Where it stood when the current throw was launched. */
  markX: number;
  markZ: number;
}

/** What the view wants to know the moment something happens. */
export interface RoyalRollEvents {
  /** The player committed a throw at `angle` radians. */
  onLaunch?(angle: number): void;
  /** A cone went over. `impact` is the closing speed that did it. */
  onKnock?(target: RoyalRollTarget, impact: number): void;
  /** Any resolved contact, cone-on-cone or roller-on-cone. */
  onImpact?(x: number, z: number, strength: number): void;
  /** The roller struck a barrier at `strength` world units/sec. */
  onBarrier?(x: number, z: number, strength: number): void;
  /** Everything stopped moving; here is what the throw was worth. */
  onSettled?(result: ThrowResult): void;
  /** The tenth throw settled. The run is over. */
  onGameOver?(score: number): void;
}

export interface RoyalRollOptions {
  /** Seed for the rack jitter. Same seed -> same rack, forever. */
  readonly seed?: number;
  /** Throws in a run. Defaults to `THROWS_PER_RUN`. */
  readonly throws?: number;
  readonly events?: RoyalRollEvents;
}

const DEFAULT_SEED = 0x0be11;

/** Clamp the aim into the legal arc. */
export function clampAim(angle: number): number {
  if (Number.isNaN(angle)) return 0;
  if (angle < -MAX_AIM) return -MAX_AIM;
  if (angle > MAX_AIM) return MAX_AIM;
  return angle;
}

export class RoyalRoll {
  /** The roller: Gary, on his side, doing his best. */
  readonly roller: Disc = {
    x: 0,
    z: ROLLER_START_Z,
    vx: 0,
    vz: 0,
    radius: ROLLER_RADIUS,
    mass: ROLLER_MASS,
  };

  private readonly seed: number;
  private readonly throwLimit: number;
  private readonly events: RoyalRollEvents;
  private rng: Rng;

  private targetList: RoyalRollTarget[] = [];
  private phaseValue: RoyalRollPhase = 'aiming';
  private statusValue: RoyalRollStatus = 'playing';
  private aim = 0;
  private throwIndex = 0;
  private scoreValue = 0;
  private rollTime = 0;
  private settleTime = 0;
  private accumulator = 0;
  private downThisThrow: number[] = [];
  private lastThrowResult: ThrowResult | null = null;
  /** Cones felled across the whole run — the HUD's second instrument. */
  private downTotal = 0;

  constructor(options: RoyalRollOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.throwLimit = Math.max(1, Math.trunc(options.throws ?? THROWS_PER_RUN));
    this.events = options.events ?? {};
    this.rng = createRng(this.seed);
    this.reset();
  }

  // ── Read-only projections ─────────────────────────────────────────────────

  get phase(): RoyalRollPhase {
    return this.phaseValue;
  }

  get status(): RoyalRollStatus {
    return this.statusValue;
  }

  /** The launch angle in radians. 0 is straight down the lane. */
  get aimAngle(): number {
    return this.aim;
  }

  /** Which throw is being played (1-based). Equals the limit on the last one. */
  get throwNumber(): number {
    return Math.min(this.throwIndex + 1, this.throwLimit);
  }

  /** Throws in a run. */
  get throwLimitCount(): number {
    return this.throwLimit;
  }

  /** Throws already resolved. */
  get throwsTaken(): number {
    return this.throwIndex;
  }

  get score(): number {
    return this.scoreValue;
  }

  /** Every cone on the deck, standing or falling. The view maps one mesh each. */
  get targets(): readonly RoyalRollTarget[] {
    return this.targetList;
  }

  /** How many cones are still on their feet. */
  get standingCount(): number {
    let n = 0;
    for (const target of this.targetList) if (target.standing) n++;
    return n;
  }

  /** Cones felled across the run so far. */
  get targetsDown(): number {
    return this.downTotal;
  }

  /** The last resolved throw, or null before the first one settles. */
  get lastResult(): ThrowResult | null {
    return this.lastThrowResult;
  }

  /** Fraction of the settle beat elapsed (0..1). The view eases the result cam. */
  get settleProgress(): number {
    if (this.phaseValue !== 'settling') return 0;
    return Math.min(1, this.settleTime / SETTLE_DURATION);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Back to throw one against a full rack, from the same seed. */
  reset(): void {
    this.rng = createRng(this.seed);
    this.rack();
    this.phaseValue = 'aiming';
    this.statusValue = 'playing';
    this.aim = 0;
    this.throwIndex = 0;
    this.scoreValue = 0;
    this.rollTime = 0;
    this.settleTime = 0;
    this.accumulator = 0;
    this.downThisThrow = [];
    this.lastThrowResult = null;
    this.downTotal = 0;
    this.parkRoller();
  }

  /**
   * Swing the aim by `steps` increments (-1 = left, +1 = right).
   *
   * Only while aiming: nudging the line after the throw has left your hand is
   * exactly the input a player would try, and exactly the one that must do
   * nothing. Returns whether the aim actually moved, so the view can click.
   */
  adjustAim(steps: number): boolean {
    if (this.phaseValue !== 'aiming' || this.statusValue !== 'playing') {
      return false;
    }
    const next = clampAim(this.aim + steps * AIM_STEP);
    if (next === this.aim) return false;
    this.aim = next;
    return true;
  }

  /**
   * Set the aim directly, clamped. Same `aiming`-only guard as `adjustAim` —
   * this is the deterministic path an E2E test uses to pick a line before
   * committing it through the real `launch()`.
   */
  setAim(angle: number): boolean {
    if (this.phaseValue !== 'aiming' || this.statusValue !== 'playing') {
      return false;
    }
    const next = clampAim(angle);
    if (next === this.aim) return false;
    this.aim = next;
    return true;
  }

  /**
   * Commit the throw. Legal only while aiming and only while the run is live —
   * a second `primary` during the roll must not launch a second roller, and the
   * game-over card's `primary` belongs to the shell (it restarts).
   *
   * Returns whether a throw was actually launched.
   */
  launch(): boolean {
    if (this.phaseValue !== 'aiming' || this.statusValue !== 'playing') {
      return false;
    }
    this.phaseValue = 'rolling';
    this.rollTime = 0;
    this.accumulator = 0;
    this.downThisThrow = [];
    this.roller.x = 0;
    this.roller.z = ROLLER_START_Z;
    this.roller.vx = Math.sin(this.aim) * LAUNCH_SPEED;
    this.roller.vz = Math.cos(this.aim) * LAUNCH_SPEED;
    // Every standing cone's mark is taken NOW, so "did it move?" is measured
    // against where it stood at the top of this throw rather than against a
    // pristine rack it may have been nudged out of two throws ago.
    for (const target of this.targetList) {
      target.markX = target.x;
      target.markZ = target.z;
    }
    this.events.onLaunch?.(this.aim);
    return true;
  }

  /** Advance the game. Safe to call in any phase and at any timestep. */
  update(dt: number): void {
    if (!(dt > 0)) return;
    if (this.phaseValue === 'rolling') {
      this.stepRoll(dt);
    } else if (this.phaseValue === 'settling') {
      this.settleTime += dt;
      if (this.settleTime >= SETTLE_DURATION) this.armNextThrow();
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Build a fresh formation from the current rng position. */
  private rack(): void {
    this.targetList = buildFormation(this.rng).map(toTarget);
  }

  private parkRoller(): void {
    this.roller.x = 0;
    this.roller.z = ROLLER_START_Z;
    this.roller.vx = 0;
    this.roller.vz = 0;
  }

  /** Run the solver in fixed substeps, then check whether the throw is over. */
  private stepRoll(dt: number): void {
    this.rollTime += dt;
    this.accumulator += dt;
    // Bound the catch-up so a stalled tab cannot spend a whole second of wall
    // clock re-solving a throw the player is no longer watching.
    if (this.accumulator > 0.25) this.accumulator = 0.25;
    while (this.accumulator >= SUBSTEP) {
      this.accumulator -= SUBSTEP;
      this.solve(SUBSTEP);
    }

    if (this.rollTime >= MAX_ROLL_TIME) {
      // The bound, not the rule: friction has always won long before here.
      this.roller.vx = 0;
      this.roller.vz = 0;
      for (const target of this.targetList) {
        target.vx = 0;
        target.vz = 0;
      }
    }
    if (this.atRest()) this.finishThrow();
  }

  /** One substep: friction, integration, walls, contacts, knock detection. */
  private solve(step: number): void {
    applyFriction(this.roller, step);
    integrate(this.roller, step);
    const wall = bounceOffWalls(
      this.roller,
      LANE_HALF_WIDTH,
      LANE_MIN_Z,
      LANE_MAX_Z,
    );
    if (wall > 0.4) {
      this.events.onBarrier?.(this.roller.x, this.roller.z, wall);
    }

    for (const target of this.targetList) {
      applyFriction(target, step);
      integrate(target, step);
      bounceOffWalls(target, LANE_HALF_WIDTH, LANE_MIN_Z, LANE_MAX_Z);
    }

    // Roller against every cone, then cone against cone: a felled cone stays in
    // the solve for the rest of the throw, which is what makes the chain
    // reaction through the wedge real rather than decorative.
    for (const target of this.targetList) {
      const impact = collide(this.roller, target);
      if (impact > 0) this.events.onImpact?.(target.x, target.z, impact);
    }
    for (let i = 0; i < this.targetList.length; i++) {
      for (let j = i + 1; j < this.targetList.length; j++) {
        const impact = collide(this.targetList[i], this.targetList[j]);
        if (impact > 0.35) {
          this.events.onImpact?.(
            (this.targetList[i].x + this.targetList[j].x) / 2,
            (this.targetList[i].z + this.targetList[j].z) / 2,
            impact,
          );
        }
      }
    }

    for (const target of this.targetList) {
      if (!target.standing) continue;
      const dx = target.x - target.markX;
      const dz = target.z - target.markZ;
      if (Math.hypot(dx, dz) < target.radius * KNOCK_DISPLACEMENT) continue;
      // Scored exactly once: `standing` flips here and nothing sets it back
      // until the cone is cleared away and a new rack is built.
      target.standing = false;
      this.downThisThrow.push(target.id);
      this.downTotal++;
      this.events.onKnock?.(target, speedOf(target));
    }
  }

  /** True once the roller and every cone have come to an exact stop. */
  private atRest(): boolean {
    if (this.roller.vx !== 0 || this.roller.vz !== 0) return false;
    for (const target of this.targetList) {
      if (target.vx !== 0 || target.vz !== 0) return false;
    }
    return true;
  }

  /** Score the throw, clear the deadwood, and start the result beat. */
  private finishThrow(): void {
    const knocked = this.downThisThrow;
    const values: number[] = [];
    let royal = false;
    for (const id of knocked) {
      const target = this.targetList.find((t) => t.id === id);
      if (!target) continue;
      values.push(target.value);
      if (target.royal) royal = true;
    }
    const survivors = this.targetList.filter((t) => t.standing);
    const cleared = survivors.length === 0;
    const result = scoreThrow({
      throwNumber: this.throwIndex + 1,
      knocked,
      values,
      cleared,
      royal,
    });
    this.scoreValue += result.total;
    this.lastThrowResult = result;
    this.throwIndex++;

    // Deadwood is swept; a cleared deck earns a fresh rack, so a run that keeps
    // striking keeps having something to aim at.
    this.targetList = cleared ? [] : survivors;
    this.phaseValue = 'settling';
    this.settleTime = 0;
    this.events.onSettled?.(result);
  }

  /** End the settle beat: re-rack if needed, then arm the next throw or end. */
  private armNextThrow(): void {
    if (this.targetList.length === 0) this.rack();
    this.parkRoller();
    this.aim = 0;
    if (this.throwIndex >= this.throwLimit) {
      this.phaseValue = 'aiming';
      this.statusValue = 'gameover';
      this.events.onGameOver?.(this.scoreValue);
      return;
    }
    this.phaseValue = 'aiming';
  }
}

/** A spec becomes a live body standing on its own mark. */
function toTarget(spec: TargetSpec): RoyalRollTarget {
  return {
    id: spec.id,
    x: spec.x,
    z: spec.z,
    vx: 0,
    vz: 0,
    radius: spec.radius,
    mass: spec.mass,
    value: spec.value,
    variant: spec.variant,
    royal: spec.royal,
    standing: true,
    markX: spec.x,
    markZ: spec.z,
  };
}

export { FORMATION_SIZE };
