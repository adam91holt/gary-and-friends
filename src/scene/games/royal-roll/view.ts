/**
 * The Royal Roll view: everything the player looks at, and nothing they play.
 *
 * Rendering-side only. It reads the pure `RoyalRoll` simulation once a frame
 * and places meshes; it never writes a number back. Lane, cast, aim guide,
 * trail and particles are separate modules — this file is the wiring between
 * them and the solver.
 *
 * ── How a cone falls ────────────────────────────────────────────────────────
 * The solver only knows `standing: false`. Tipping it over is presentation, and
 * it is driven by the direction the cone was actually shoved (its displacement
 * from its mark), so a cone hit from the left falls to the right. Once the
 * throw settles the solver drops felled cones from its list; the view keeps
 * their meshes lying on the deck as wreckage until the rack is rebuilt, because
 * a lane that visibly accumulates damage is the whole reward of a ten-throw run.
 */
import { Group, MathUtils, type Object3D } from 'three';
import {
  KING_RADIUS,
  TARGET_RADIUS,
} from '../../../game/games/royal-roll/formation.ts';
import {
  ROLLER_RADIUS,
  type RoyalRoll,
  type RoyalRollTarget,
} from '../../../game/games/royal-roll/simulation.ts';
import { createGuard, createKing, createRoller, type Roller } from './cast.ts';
import { RoyalFx } from './fx.ts';
import { DECK_Y, laneZ, RoyalLane } from './lane.ts';
import { AimGuide } from './aimGuide.ts';
import { RollerTrail } from './trail.ts';

/** Seconds a cone takes to go from upright to flat on the deck. */
const FALL_DURATION = 0.42;

/** One cone on the deck: its mesh, and how far over it currently is. */
interface Slot {
  readonly id: number;
  readonly group: Group;
  readonly royal: boolean;
  readonly variant: number;
  /** 0 = upright, 1 = flat. Eased toward `falling ? 1 : 0`. */
  tip: number;
  /** Unit direction the cone was shoved, so it falls the way it was hit. */
  tipX: number;
  tipZ: number;
  falling: boolean;
}

export class RoyalRollView {
  readonly group = new Group();

  readonly lane = new RoyalLane();
  readonly fx = new RoyalFx();
  readonly guide = new AimGuide();
  readonly trail = new RollerTrail(ROLLER_RADIUS);
  readonly roller: Roller = createRoller(ROLLER_RADIUS);

  /** Live cones, keyed by the simulation's own id. */
  private readonly slots = new Map<number, Slot>();
  /** Cones the solver has retired. Still drawn, lying where they landed. */
  private readonly wreckage: Slot[] = [];
  /** Live cone count last frame — a rise means the rack was rebuilt. */
  private previousLive = 0;
  /** Eased visibility of the aim guide (1 while aiming, 0 once committed). */
  private guideShown = 1;
  /** Roll angle accumulated from the solver's own speed. */
  private rollAngle = 0;

  constructor() {
    this.group.name = 'RoyalRollView';
    this.group.add(
      this.lane.group,
      this.guide.group,
      this.trail.group,
      this.fx.group,
      this.roller.root,
    );
  }

  /**
   * Draw the current state of the simulation.
   *
   * @param game          the live simulation (read-only here)
   * @param dt            frame delta
   * @param time          shared clock
   * @param reducedMotion honoured throughout: nothing sweeps, nothing pulses,
   *                      and cones snap to their fallen pose instead of tipping
   */
  sync(game: RoyalRoll, dt: number, time: number, reducedMotion: boolean): void {
    // ── The rack ────────────────────────────────────────────────────────────
    const live = new Set<number>();
    for (const target of game.targets) {
      live.add(target.id);
      this.syncTarget(target, dt, reducedMotion);
    }
    // A cone the solver has dropped becomes wreckage: it keeps its transform
    // and stops being updated.
    for (const [id, slot] of this.slots) {
      if (live.has(id)) continue;
      this.slots.delete(id);
      slot.falling = true;
      slot.tip = 1;
      this.applyTip(slot, reducedMotion);
      this.wreckage.push(slot);
    }
    // The rack grew: a fresh formation was racked, so the deck is swept.
    if (live.size > this.previousLive) this.sweepWreckage();
    this.previousLive = live.size;

    // ── The roller ──────────────────────────────────────────────────────────
    const speed = Math.hypot(game.roller.vx, game.roller.vz);
    this.roller.root.position.set(
      game.roller.x,
      DECK_Y + ROLLER_RADIUS * 0.92,
      laneZ(game.roller.z),
    );
    // Spun at the rate its own speed implies, so the roll never skates: one
    // revolution per circumference travelled.
    if (!reducedMotion) {
      this.rollAngle += (speed / ROLLER_RADIUS) * dt;
      this.roller.spin.rotation.z = this.rollAngle;
    }
    // Aimed along its velocity while moving; back down the lane once at rest,
    // so the next throw starts square rather than sideways.
    const heading = speed > 0.05 ? Math.atan2(game.roller.vx, game.roller.vz) : game.aimAngle;
    this.roller.root.rotation.y = reducedMotion
      ? heading
      : MathUtils.damp(this.roller.root.rotation.y, heading, 9, dt);

    this.trail.update(
      dt,
      game.roller.x,
      laneZ(game.roller.z),
      speed,
      game.phase === 'rolling' && !reducedMotion,
    );
    if (!reducedMotion && game.phase === 'rolling') {
      this.fx.scuff(dt, game.roller.x, laneZ(game.roller.z), speed);
    }
    this.fx.update(dt);

    // ── Instruments ─────────────────────────────────────────────────────────
    // The guide belongs to the aiming phase and fades out the instant the throw
    // is committed — an aim line still drawn under a moving roller would be a
    // promise the game already broke.
    const wanted = game.phase === 'aiming' && game.status === 'playing' ? 1 : 0;
    this.guideShown = reducedMotion
      ? wanted
      : MathUtils.damp(this.guideShown, wanted, 9, dt);
    this.guide.update(game.aimAngle, this.guideShown, time, reducedMotion);

    this.lane.update(
      Math.max(0, game.throwLimitCount - game.throwsTaken),
      game.targetsDown,
      time,
      reducedMotion,
    );
  }

  /** A cone went over: throw its own sparks from where it actually stands. */
  knockFx(target: RoyalRollTarget, reducedMotion: boolean): void {
    if (reducedMotion) return;
    const y = DECK_Y + (target.royal ? KING_RADIUS : TARGET_RADIUS) * 1.6;
    if (target.royal) this.fx.royal(target.x, y, laneZ(target.z));
    else this.fx.knock(target.x, y, laneZ(target.z), target.variant);
  }

  /** A resolved contact anywhere on the deck. */
  impactFx(x: number, z: number, strength: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    this.fx.impact(x, DECK_Y + 0.3, laneZ(z), strength);
  }

  /** The roller hit a barrier. */
  barrierFx(x: number, z: number, strength: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    this.fx.barrier(x, laneZ(z), strength);
  }

  /** Back to a clean lane: full rack upright, no wreckage, no trail, no sparks. */
  reset(): void {
    for (const slot of this.slots.values()) this.group.remove(slot.group);
    this.slots.clear();
    this.sweepWreckage();
    this.previousLive = 0;
    this.guideShown = 1;
    this.rollAngle = 0;
    this.roller.spin.rotation.z = 0;
    this.roller.root.rotation.y = 0;
    this.trail.clear();
    this.fx.clear();
  }

  /** How many meshes this view is currently drawing cones with. */
  get coneCount(): number {
    return this.slots.size + this.wreckage.length;
  }

  private syncTarget(target: RoyalRollTarget, dt: number, reducedMotion: boolean): void {
    let slot = this.slots.get(target.id);
    if (!slot) {
      const group = target.royal
        ? createKing(target.variant, target.radius)
        : createGuard(target.variant, target.radius);
      slot = {
        id: target.id,
        group,
        royal: target.royal,
        variant: target.variant,
        tip: 0,
        tipX: 0,
        tipZ: 1,
        falling: false,
      };
      this.slots.set(target.id, slot);
      this.group.add(group);
    }

    slot.group.position.set(target.x, DECK_Y, laneZ(target.z));

    if (!target.standing && !slot.falling) {
      slot.falling = true;
      // Fall the way it was shoved. Its displacement from its mark IS that
      // direction, which is why the mark is taken at launch.
      const dx = target.x - target.markX;
      const dz = target.z - target.markZ;
      const length = Math.hypot(dx, dz);
      if (length > 1e-4) {
        slot.tipX = dx / length;
        slot.tipZ = dz / length;
      }
    }
    const wanted = slot.falling ? 1 : 0;
    slot.tip = reducedMotion
      ? wanted
      : MathUtils.damp(slot.tip, wanted, 1 / FALL_DURATION + 4, dt);
    this.applyTip(slot, reducedMotion);
  }

  /**
   * Lay a cone over by `tip`, about the axis perpendicular to the direction it
   * was pushed. Rotation only — the cone's base stays where the physics put it.
   */
  private applyTip(slot: Slot, reducedMotion: boolean): void {
    const amount = reducedMotion ? (slot.falling ? 1 : 0) : slot.tip;
    const angle = amount * (Math.PI / 2) * 0.98;
    // Sim +z is scene -z, so the push direction is mirrored on the way in.
    slot.group.rotation.set(-slot.tipZ * angle, 0, slot.tipX * angle);
  }

  private sweepWreckage(): void {
    for (const slot of this.wreckage) this.group.remove(slot.group);
    this.wreckage.length = 0;
  }
}

/** The subtree the runtime hands the shell. */
export type RoyalRollRoot = Object3D;
