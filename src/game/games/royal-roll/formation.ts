/**
 * The rack: who stands where in the royal formation, and what they are worth.
 *
 * Pure data + one builder. Kept out of `simulation.ts` so the arrangement can
 * be read (and re-read on a re-rack) without touching the solver, and so the
 * three.js lane can build its cones from exactly the same table the physics
 * collides against — a target can never be drawn somewhere it isn't.
 *
 * The shape is the pitch of the game: four ranks of guards in a widening
 * wedge, with the King (Sir Cones-a-lot, the only cone in the cast who wears a
 * topper) standing alone behind them. The crown is the prize and the wedge is
 * what is in the way, which is why the deep ranks pay more than the near ones.
 */
import { randomRange, type Rng } from '../../entities/rng.ts';

/** One cone standing on the lane deck, before anything has hit it. */
export interface TargetSpec {
  /** Stable identity, so a knocked cone can be matched to its mesh. */
  readonly id: number;
  /** Home position on the deck (lane-local: x lateral, z down-lane). */
  readonly x: number;
  readonly z: number;
  /** Collision radius. */
  readonly radius: number;
  /** Heavier cones absorb more of a hit and pass on less. */
  readonly mass: number;
  /** Points this cone pays when it goes down. */
  readonly value: number;
  /** Index into `FRIENDS` / `FRIEND_TINTS` — who this cone actually is. */
  readonly variant: number;
  /** The King wears the crown, is worth the most, and stands alone. */
  readonly royal: boolean;
}

/** Lane half-width. Barriers stand here; the roller reflects off them. */
export const LANE_HALF_WIDTH = 3;
/** The launch line, and the sandbags at the far end. */
export const LANE_MIN_Z = 0;
export const LANE_MAX_Z = 11.4;

/** Standard cone radius/mass, and the King's (bigger, heavier, harder to move). */
export const TARGET_RADIUS = 0.34;
export const TARGET_MASS = 1;
export const KING_RADIUS = 0.42;
export const KING_MASS = 1.5;

/**
 * The four guard ranks: how many stand in each, how far down the lane they are,
 * how far apart they stand, and what each cone in that rank pays.
 *
 * Values rise with depth because depth is difficulty: the front cone is a
 * gift, the back rank has three ranks of guards in front of it, and the game
 * should pay for the line that gets through rather than for the tap that
 * doesn't.
 */
const RANKS: readonly {
  readonly count: number;
  readonly z: number;
  readonly spacing: number;
  readonly value: number;
}[] = [
  { count: 1, z: 5.9, spacing: 0, value: 80 },
  { count: 2, z: 6.85, spacing: 0.92, value: 120 },
  { count: 3, z: 7.8, spacing: 0.92, value: 160 },
  { count: 4, z: 8.75, spacing: 0.92, value: 220 },
];

/** Where the crown stands, and what it pays. Alone, behind everyone. */
const KING_Z = 9.9;
export const KING_VALUE = 500;

/** Sir Cones-a-lot's index in the roster — the one with the topper. */
const KING_VARIANT = 2;
/** The guards, drawn from the rest of the cast in rank order. */
const GUARD_VARIANTS = [0, 1, 3, 4] as const;

/**
 * How far a cone's mark may be jittered from perfect, in world units.
 *
 * Deliberately tiny and deliberately SEEDED: a machine-perfect rack makes every
 * run play out identically from the same aim, which drains the game of the "one
 * degree left" tension it is built on. The jitter is far smaller than a cone
 * radius, so it changes the chain reaction without ever changing whether a line
 * is legal.
 */
const JITTER = 0.045;

/**
 * Build the full rack. Same `rng` sequence -> same rack, forever, which is what
 * makes a replay (and an E2E assertion) meaningful.
 */
export function buildFormation(rng: Rng): TargetSpec[] {
  const targets: TargetSpec[] = [];
  let id = 0;
  RANKS.forEach((rank, rankIndex) => {
    const offset = ((rank.count - 1) * rank.spacing) / 2;
    for (let i = 0; i < rank.count; i++) {
      targets.push({
        id: id++,
        x: i * rank.spacing - offset + randomRange(rng, -JITTER, JITTER),
        z: rank.z + randomRange(rng, -JITTER, JITTER),
        radius: TARGET_RADIUS,
        mass: TARGET_MASS,
        value: rank.value,
        variant: GUARD_VARIANTS[rankIndex % GUARD_VARIANTS.length],
        royal: false,
      });
    }
  });
  targets.push({
    id: id++,
    x: randomRange(rng, -JITTER, JITTER),
    z: KING_Z,
    radius: KING_RADIUS,
    mass: KING_MASS,
    value: KING_VALUE,
    variant: KING_VARIANT,
    royal: true,
  });
  return targets;
}

/** How many cones a full rack holds. Read by the HUD, the tests and the view. */
export const FORMATION_SIZE = RANKS.reduce((n, rank) => n + rank.count, 0) + 1;
