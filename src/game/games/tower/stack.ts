/**
 * `TowerGame` — the Stack Attack simulation.
 *
 * Pure, in exactly the sense `src/game/gameplay/run.ts` is pure: it owns the
 * trolley, the cone in the air and the stack itself, and it talks to the world
 * only through `GameStore` actions. No `three`, no DOM, no `window`, so the
 * entire game is exercised under Vitest in the node environment at whatever
 * timestep the test likes.
 *
 * The renderer does exactly two things with this: calls `update(dt)` once a
 * frame, and reads `stackEntries` / `fallingCone` / `carrierX` to place meshes.
 * It never decides anything — not where a cone lands, not how wide it ends up,
 * not whether the run is over.
 *
 * ── Why the trolley freezes while a cone is in the air ──────────────────────
 * The only input in this game is WHEN, so the moment between release and
 * landing is the only moment the player is being judged. Leaving the trolley
 * sweeping through it would put a second, irrelevant thing in motion at exactly
 * the instant the player needs to read the result of the first.
 */
import { createRng, randomIndex, type Rng } from '../../entities/rng.ts';
import type { GameStatus, GameStore } from '../../state.ts';
import {
  CARRIER_HEIGHT,
  CARRIER_SPAN,
  DROP_SPEED,
  TOWER_BASE_HEIGHT,
  TOWER_BASE_WIDTH,
  carrierSpeedForHeight,
  landingScore,
  pieceHeight,
  resolveLanding,
  type LandingResult,
} from './rules.ts';

/**
 * The order pieces are handed to the trolley, as a weighted bag.
 *
 * Tiny and Big Dave appear twice each because they are the two silhouettes that
 * make a tower worth looking at: Tiny is a half-height sliver and Big Dave is
 * the biggest cone in the cast, so a stack that alternates them has genuine
 * rhythm rather than being a column of identical blocks. Indexes are roster
 * indexes (src/game/friends/roster.ts) — this bag never duplicates a dimension
 * or a tint, it only says who is up next.
 */
export const TOWER_CAST_BAG: readonly number[] = [3, 4, 3, 4, 0, 1, 2];

/** Default seed. Fixed seed => byte-identical cast sequence, forever. */
export const TOWER_SEED = 0x7a1e;

/** One piece resting in the tower. Positions are world-space, Y is its base. */
export interface StackEntry {
  /** Monotonic id, so a renderer can key a mesh to a piece across frames. */
  readonly id: number;
  /** Roster index — who this is (silhouette, tint, name). */
  readonly variant: number;
  /** Centre of the piece across the yard. */
  readonly x: number;
  /** Footprint width after any overhang was sheared off. */
  readonly width: number;
  /** World Y of the piece's underside. */
  readonly y: number;
  /** How tall it stands. */
  readonly height: number;
  /** Whether it was landed dead centre. Drives the perfect-drop flourish. */
  readonly perfect: boolean;
}

/** The cone currently in the air, between release and landing. */
export interface FallingCone {
  readonly variant: number;
  readonly x: number;
  /** World Y of its underside, descending at DROP_SPEED. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a drop did, handed to presentation so it can react without inferring. */
export interface DropOutcome {
  readonly landed: boolean;
  readonly perfect: boolean;
  /** Where the landing happened, across the yard. */
  readonly x: number;
  /** World Y of the landing plane. */
  readonly y: number;
  /** Signed centre-to-centre error. */
  readonly offset: number;
  /** How much footprint was sheared off (0 on a perfect drop). */
  readonly trimmed: number;
  /** Consecutive perfect landings after this one. */
  readonly combo: number;
  /** Points this drop paid. */
  readonly points: number;
  /** Who was dropped. */
  readonly variant: number;
}

export interface TowerOptions {
  /** Seed for the cast sequence and re-entry side. Fixed => identical run. */
  seed?: number;
  /** Called the instant a drop resolves — landed or not. */
  onDrop?: (outcome: DropOutcome) => void;
}

export class TowerGame {
  /** The stack, base first. The pad itself is entry 0 and never moves. */
  private readonly stack: StackEntry[] = [];
  private falling: FallingCone | null = null;

  private carrier = -CARRIER_SPAN;
  private direction: 1 | -1 = 1;
  private carried = 0;
  private comboCount = 0;
  private nextId = 1;
  private rng: Rng;
  private readonly seed: number;
  private readonly onDrop: ((outcome: DropOutcome) => void) | null;

  constructor(
    private readonly store: GameStore,
    options: TowerOptions = {},
  ) {
    this.seed = options.seed ?? TOWER_SEED;
    this.rng = createRng(this.seed);
    this.onDrop = options.onDrop ?? null;
    this.reset();
  }

  /* ── Readable state (the renderer and the test API project these) ───────── */

  /** Where the trolley is, across the yard. */
  get carrierX(): number {
    return this.carrier;
  }

  /** Which way it is running: +1 right, -1 left. */
  get carrierDirection(): 1 | -1 {
    return this.direction;
  }

  /** How fast it is running right now (world units/sec). */
  get carrierSpeed(): number {
    return carrierSpeedForHeight(this.stackHeight);
  }

  /** The cone in the air, or null when the trolley is still holding it. */
  get fallingCone(): FallingCone | null {
    return this.falling;
  }

  /** The whole tower, base pad first. */
  get stackEntries(): readonly StackEntry[] {
    return this.stack;
  }

  /** How many pieces the player has actually stacked (the pad doesn't count). */
  get stackHeight(): number {
    return this.stack.length - 1;
  }

  /** World Y of the surface the next cone has to land on. */
  get towerTop(): number {
    const top = this.stack[this.stack.length - 1];
    return top.y + top.height;
  }

  /** Consecutive perfect landings. Broken by any scruffy or missed drop. */
  get combo(): number {
    return this.comboCount;
  }

  /** The run's score. Mirrors the store, which is the source of truth. */
  get score(): number {
    return this.store.getState().score;
  }

  /** The run's status, projected from the store. Never a second copy. */
  get status(): GameStatus {
    return this.store.getState().status;
  }

  /** Who the trolley is holding right now. */
  get carriedVariant(): number {
    return this.carried;
  }

  /** World Y of the underside of the carried cone. */
  get carrierY(): number {
    return this.towerTop + CARRIER_HEIGHT;
  }

  /** The footprint the carried cone will land with — the tower never widens. */
  get carriedWidth(): number {
    return this.stack[this.stack.length - 1].width;
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Back to the opening state: an empty yard with just the pad, the trolley at
   * the left rail running right, nothing in the air, no combo, and the cast
   * sequence rewound so a restart replays identically from the same seed.
   */
  reset(): void {
    this.stack.length = 0;
    this.stack.push({
      id: 0,
      variant: -1,
      x: 0,
      width: TOWER_BASE_WIDTH,
      y: 0,
      height: TOWER_BASE_HEIGHT,
      perfect: true,
    });
    this.falling = null;
    this.carrier = -CARRIER_SPAN;
    this.direction = 1;
    this.comboCount = 0;
    this.nextId = 1;
    this.rng = createRng(this.seed);
    this.carried = this.drawVariant();
  }

  /**
   * Advance one frame.
   *
   * Game-over stops the world — the trolley freezes, the cone in the air
   * freezes, the score holds — because that screen is a still payoff and a
   * machine still running under it would read as "you can keep going".
   *
   * The MENU deliberately does not freeze: the cabinet's committed idea is that
   * the game you have highlighted is running live behind the panel, so the
   * gantry idles back and forth. Nothing is at stake there (`drop()` refuses
   * outside a run, and `reset()` re-parks the carriage on the opening rail), so
   * an idling machine is honest attract motion rather than hidden state.
   */
  update(dt: number): void {
    if (dt <= 0) return;
    const status = this.store.getState().status;
    if (status === 'gameover') return;
    if (status === 'menu') {
      this.advanceCarrier(dt);
      return;
    }
    if (this.falling !== null) {
      this.advanceFall(dt);
      return;
    }
    this.advanceCarrier(dt);
  }

  /**
   * The primary action: let go of the cone. Returns whether a cone was actually
   * released, so a runtime can tell "dropped" from "already had one in the air"
   * without reading state back.
   *
   * Note what this does NOT do: decide the outcome. It only starts a fall; the
   * landing is resolved by `update` when the cone reaches the tower, through the
   * same rule at any framerate.
   */
  drop(): boolean {
    if (this.store.getState().status !== 'playing') return false;
    if (this.falling !== null) return false;
    this.falling = {
      variant: this.carried,
      x: this.carrier,
      y: this.carrierY,
      width: this.carriedWidth,
      height: pieceHeight(this.carried),
    };
    return true;
  }

  /* ── Deterministic test hook ────────────────────────────────────────────── */

  /**
   * Park the trolley at a chosen point on the rails, running a chosen way.
   *
   * This is the whole of the e2e determinism story, and it deliberately stops
   * there: it sets up the *situation* and nothing else. The drop that follows
   * goes through `drop()` and `update()` exactly as a keypress would, so the
   * overlap rule, the trim, the perfect window, the combo and the miss are all
   * resolved by the shipping logic. A hook that forced a landing would be
   * testing itself.
   *
   * Returns false outside a run, or while a cone is already in the air (moving
   * the trolley then would be moving something the player cannot move).
   */
  placeCarrier(x: number, direction?: 1 | -1): boolean {
    if (this.store.getState().status !== 'playing') return false;
    if (this.falling !== null) return false;
    this.carrier = clamp(x, -CARRIER_SPAN, CARRIER_SPAN);
    if (direction !== undefined) this.direction = direction;
    return true;
  }

  /* ── Internals ─────────────────────────────────────────────────────────── */

  /**
   * Run the trolley along the gantry, reversing at each rail.
   *
   * The reflection loops rather than clamping once: at the top of the speed ramp
   * a hitched frame can carry the trolley past the far rail, and a single
   * reflection would leave it stranded outside the span for a frame — visibly
   * off its own rails, and unfairly out of reach of the tower.
   */
  private advanceCarrier(dt: number): void {
    let x = this.carrier + this.direction * this.carrierSpeed * dt;
    for (let guard = 0; guard < 8; guard++) {
      if (x > CARRIER_SPAN) {
        x = 2 * CARRIER_SPAN - x;
        this.direction = -1;
      } else if (x < -CARRIER_SPAN) {
        x = -2 * CARRIER_SPAN - x;
        this.direction = 1;
      } else {
        break;
      }
    }
    this.carrier = clamp(x, -CARRIER_SPAN, CARRIER_SPAN);
  }

  /** Bring the cone down, and resolve the moment it meets the tower. */
  private advanceFall(dt: number): void {
    const cone = this.falling;
    if (cone === null) return;
    const landingY = this.towerTop;
    const y = cone.y - DROP_SPEED * dt;
    if (y > landingY) {
      this.falling = { ...cone, y };
      return;
    }
    this.falling = null;
    this.land(cone, landingY);
  }

  /** Fold a landed cone into the tower — or end the run if it missed. */
  private land(cone: FallingCone, landingY: number): void {
    const top = this.stack[this.stack.length - 1];
    const result: LandingResult = resolveLanding(top.x, top.width, cone.x, cone.width);

    if (!result.landed) {
      this.comboCount = 0;
      this.emit(cone, result, landingY, 0);
      // Through the store, like every other run-ending rule in the game.
      this.store.gameOver();
      return;
    }

    this.comboCount = result.perfect ? this.comboCount + 1 : 0;
    const points = landingScore(result, this.comboCount, cone.width);

    this.stack.push({
      id: this.nextId++,
      variant: cone.variant,
      x: result.x,
      width: result.width,
      y: landingY,
      height: cone.height,
      perfect: result.perfect,
    });
    this.store.addScore(points);

    this.emit(cone, result, landingY, points);

    // Hand the trolley the next cast member and send it back in from a seeded
    // rail, so a long run never settles into one memorised rhythm.
    this.carried = this.drawVariant();
    this.direction = this.rng() < 0.5 ? 1 : -1;
    this.carrier = this.direction === 1 ? -CARRIER_SPAN : CARRIER_SPAN;
  }

  private emit(
    cone: FallingCone,
    result: LandingResult,
    landingY: number,
    points: number,
  ): void {
    this.onDrop?.({
      landed: result.landed,
      perfect: result.perfect,
      x: result.landed ? result.x : cone.x,
      y: landingY,
      offset: result.offset,
      trimmed: result.landed ? cone.width - result.width : cone.width,
      combo: this.comboCount,
      points,
      variant: cone.variant,
    });
  }

  /** Pull the next cast member out of the seeded bag. */
  private drawVariant(): number {
    return TOWER_CAST_BAG[randomIndex(this.rng, TOWER_CAST_BAG.length)];
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return 0;
  return value < min ? min : value > max ? max : value;
}
