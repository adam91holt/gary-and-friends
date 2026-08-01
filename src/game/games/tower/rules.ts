/**
 * Stack Attack's rulebook: every number and every decision the tower makes,
 * as pure functions of pure data.
 *
 * No three.js, no DOM, no `window` — this is the game-logic side of the seam,
 * so the whole of the game's *fairness* (what counts as a landing, what counts
 * as centred, how fast the trolley is allowed to get) is unit-tested in node at
 * whatever timestep the test likes.
 *
 * The mechanic in one paragraph: a trolley runs back and forth along a gantry
 * above the tower carrying a member of the cast. Dropping releases them; they
 * fall straight down and come to rest on top of the stack. Whatever hangs over
 * the edge is sheared off, so a sloppy landing narrows the tower and makes the
 * next one harder — and a landing with no overlap at all is the end of the run.
 * There is NO steering: the only input is *when*, which is what makes this a
 * timing game rather than a second lane-dodger.
 */
import { friendProfile } from '../../friends/roster.ts';

/**
 * Width of the concrete pad the tower is built on (world units).
 *
 * Deliberately close to a stacked piece's own height: a pad much wider than
 * that would make the opening drops nearly unmissable and, worse, would make
 * every piece read as a plate rather than as a cone. The tower has to look like
 * a tower from the first landing.
 */
export const TOWER_BASE_WIDTH = 1.15;
/** Height of that pad. The first real piece lands on top of it. */
export const TOWER_BASE_HEIGHT = 0.5;

/**
 * How far either side of centre the trolley runs (world units).
 *
 * Deliberately wider than the base pad: the rails have to reach far enough that
 * a genuine, unrecoverable miss is physically possible from the opening drop.
 * If the trolley could never leave the footprint of the tower, the game could
 * not be lost, and a game that cannot be lost has no timing in it.
 */
export const CARRIER_SPAN = 2.1;

/**
 * How high above the top of the stack the carried cone hangs.
 *
 * This is a *reaction budget*, not a decoration: it is how long the player has
 * between committing and finding out, and at DROP_SPEED it works out at about
 * a fifth of a second. Long enough that the drop is an event you watch, short
 * enough that it never becomes dead air between the decision and the result.
 */
export const CARRIER_HEIGHT = 1.5;

/** Trolley speed on the opening drop (world units/sec). */
export const BASE_CARRIER_SPEED = 1.5;
/** Extra trolley speed per piece already stacked. */
export const CARRIER_SPEED_STEP = 0.12;
/**
 * The ceiling on trolley speed.
 *
 * A ramp with no ceiling stops being a difficulty curve and becomes a coin
 * flip: past roughly this speed the trolley crosses the whole perfect window in
 * less than two frames, so landing a centred drop would be luck rather than
 * timing. Reached at 25 pieces, which is already a very good run.
 */
export const MAX_CARRIER_SPEED = 4.5;

/** How fast a released cone falls (world units/sec). Constant — no gravity
 *  ramp, because the drop has to read the same at height 1 and at height 30. */
export const DROP_SPEED = 11;

/**
 * How far off-centre a landing may be and still count as PERFECT (world units,
 * measured centre to centre).
 *
 * Perfect landings shear nothing off, so a player who keeps hitting this window
 * never narrows their tower — the skill ceiling is "play forever", and the
 * ramp comes entirely from the trolley getting quicker underneath them.
 */
export const PERFECT_WINDOW = 0.1;

/**
 * The least overlap that still counts as standing on something. A knife-edge
 * landing of a few millimetres would leave a sliver nobody could ever land on
 * again, which reads as a bug rather than as a brutal-but-fair result.
 */
export const MIN_OVERLAP = 0.06;

/** Roster heights are road-cone sized; the tower wants a chunkier proportion. */
export const PIECE_HEIGHT_SCALE = 0.55;

/** Points for getting a cone to stay up at all. */
export const LANDING_SCORE = 10;
/** Extra for a centred landing. Comfortably more than the landing itself, so
 *  precision is the thing the score is actually about. */
export const PERFECT_BONUS = 25;
/** Extra per consecutive perfect landing beyond the first. */
export const COMBO_STEP = 10;
/** Where the combo bonus stops growing (steps, not points). */
export const MAX_COMBO_STEPS = 8;

/**
 * Trolley speed once `stacked` pieces are up. Monotonic in height and bounded
 * by MAX_CARRIER_SPEED, which is exactly what the tests pin: the ramp is the
 * difficulty, the ceiling is the fairness.
 */
export function carrierSpeedForHeight(stacked: number): number {
  const pieces = stacked > 0 ? stacked : 0;
  const speed = BASE_CARRIER_SPEED + pieces * CARRIER_SPEED_STEP;
  return speed > MAX_CARRIER_SPEED ? MAX_CARRIER_SPEED : speed;
}

/** How tall the cast member `variant` stands when stacked. */
export function pieceHeight(variant: number): number {
  return friendProfile(variant).height * PIECE_HEIGHT_SCALE;
}

/** What happened when a dropped cone met the top of the stack. */
export interface LandingResult {
  /** Whether it stayed up. False ends the run. */
  readonly landed: boolean;
  /** Whether it was centred inside PERFECT_WINDOW (nothing sheared off). */
  readonly perfect: boolean;
  /** Centre of the piece after trimming. Meaningless when `landed` is false. */
  readonly x: number;
  /** Width after trimming (or the full carried width on a perfect drop). */
  readonly width: number;
  /** How much of the carried cone was actually over the block below. */
  readonly overlap: number;
  /** Signed centre-to-centre error, for feedback and scoring. */
  readonly offset: number;
}

/**
 * Resolve a drop against the block below it.
 *
 * The overhang is genuinely removed rather than merely penalised: the piece
 * that ends up in the stack IS the intersection of the two footprints, so the
 * tower you can see is exactly the tower the next drop has to hit. A centred
 * landing is exempt — that is the reward, and it is what stops a long run from
 * being ground down to a sliver by rounding error alone.
 */
export function resolveLanding(
  topX: number,
  topWidth: number,
  dropX: number,
  dropWidth: number,
): LandingResult {
  const left = Math.max(topX - topWidth / 2, dropX - dropWidth / 2);
  const right = Math.min(topX + topWidth / 2, dropX + dropWidth / 2);
  const overlap = right - left;
  const offset = dropX - topX;

  if (!(overlap > MIN_OVERLAP)) {
    return { landed: false, perfect: false, x: dropX, width: 0, overlap: overlap > 0 ? overlap : 0, offset };
  }

  if (Math.abs(offset) <= PERFECT_WINDOW) {
    // Snapped dead centre. Snapping (rather than keeping the sub-window error)
    // is what makes a perfect run stay perfect instead of drifting off the
    // tower a millimetre at a time.
    return { landed: true, perfect: true, x: topX, width: dropWidth, overlap: dropWidth, offset };
  }

  return {
    landed: true,
    perfect: false,
    x: (left + right) / 2,
    width: overlap,
    overlap,
    offset,
  };
}

/**
 * Points for a landing.
 *
 * `combo` is the number of consecutive perfect landings INCLUDING this one, so
 * the first perfect pays the flat bonus and each one after it pays more, up to
 * MAX_COMBO_STEPS. A scruffy landing still pays, scaled by how much of the cone
 * actually stayed on — tidy is always worth more than lucky.
 */
export function landingScore(
  result: LandingResult,
  combo: number,
  carriedWidth: number,
): number {
  if (!result.landed) return 0;
  if (result.perfect) {
    const steps = Math.min(Math.max(combo - 1, 0), MAX_COMBO_STEPS);
    return LANDING_SCORE + PERFECT_BONUS + steps * COMBO_STEP;
  }
  const ratio = carriedWidth > 0 ? result.overlap / carriedWidth : 0;
  return LANDING_SCORE + Math.round(LANDING_SCORE * ratio);
}
