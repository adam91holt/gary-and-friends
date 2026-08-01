/**
 * Big Bounce's arena: the fixed geometry, the tuning constants and the pure
 * rules derived from them.
 *
 * No three.js, no DOM, no `window` — the court is numbers, and both sides of
 * the seam read the SAME numbers: the simulation collides against them and the
 * view in `src/scene/games/coneball/` builds its meshes from them. That is what
 * makes "the ball visibly bounced off the barrier" and "the ball collided with
 * the barrier" the same statement rather than two drifting approximations.
 *
 * ── The court, looking down it from behind Bartholocone ─────────────────────
 *
 *      z = ARENA_FAR_Z          ── the gantry wall Coneelia serves from
 *          │  ▓▓  ▓▓  ▓▓  ▓▓    ── three rows of hazard drums (the targets)
 *          │  ▓▓  ▓▓  ▓▓  ▓▓
 *          │  ▓▓  ▓▓  ▓▓  ▓▓
 *          │        ●          ── the ball, continuous position
 *          │      ▄▄▄▄▄        ── Bartholocone, at PADDLE_Z, sliding in X
 *      z = MISS_Z               ── past here is a life
 *
 * X is lateral and bounded by the barriers at ±ARENA_HALF_X; Z runs from the
 * far gantry (negative) toward the player (positive).
 */

/** Half the court's width. The side barriers stand here. */
export const ARENA_HALF_X = 4.2;
/** The far wall the ball rebounds off, behind the target formation. */
export const ARENA_FAR_Z = -8.4;
/** Where Bartholocone's board sits along the court. */
export const PADDLE_Z = 3.2;
/** Half the board's depth. Thin, but never thin enough to tunnel (see sweep.ts). */
export const PADDLE_HALF_DEPTH = 0.28;
/** Half the board's width. Wide enough to be fair, narrow enough to be a skill. */
export const PADDLE_HALF_WIDTH = 1.05;
/**
 * Past this Z the ball is gone and a life is spent. Deliberately well behind
 * the board rather than flush with it, so a ball that clips the paddle's back
 * edge still reads as "it got past you" instead of vanishing on contact.
 */
export const MISS_Z = 4.9;
/** The ball's collision radius. The drawn orb matches it exactly. */
export const BALL_RADIUS = 0.3;

/** How far one left/right press slides the board's target position. */
export const PADDLE_STEP = 1.15;
/**
 * How hard the board chases its target position. High enough that the board is
 * where you asked within ~a fifth of a second, low enough that the slide is a
 * visible move rather than a teleport — you are supposed to be able to see
 * Bartholocone lean.
 */
export const PADDLE_LAMBDA = 16;

/** Lives a fresh run starts with. */
export const START_LIVES = 3;

/** Ball speed on the opening serve of the first wave. */
export const BALL_SPEED_BASE = 7.2;
/** Added per successful return. The rally is the difficulty curve. */
export const BALL_SPEED_PER_RALLY = 0.42;
/** Added per cleared wave, so a new wall of drums arrives quicker than the last. */
export const BALL_SPEED_PER_WAVE = 0.9;
/**
 * The hard ceiling. Above this the ball crosses the court faster than a player
 * can read its line, which stops being difficulty and starts being a coin flip.
 * The swept solver is tested at exactly this speed with a 100ms frame.
 */
export const BALL_SPEED_MAX = 15.5;

/**
 * Widest angle (radians, off the court's axis) a return can leave the board at,
 * measured at the very edge of the board. Bounded well under 90° so a rally can
 * never devolve into a ball crawling sideways across the court.
 */
export const MAX_RETURN_ANGLE = 1.02;
/** Widest angle Coneelia will serve at. Gentler than a return: the serve is a
 *  gift, not a trick. */
export const MAX_SERVE_ANGLE = 0.42;

/**
 * Where the ball waits in Coneelia's hands.
 *
 * Deliberately on the PLAYER's side of the drum wall, not back at the gantry.
 * Serving from behind the wall would put the ball inside the back row before it
 * had travelled a centimetre: every serve would smash a free drum and rebound
 * away from the player, and the rally would begin with a ball the player never
 * got a chance at. So Coneelia stands mid-court in front of the hazard wall and
 * serves down the open half toward Bartholocone — the drums are what the RETURN
 * is aimed at, which is the whole shape of the game.
 */
export const SERVE_Z = -2.4;
/** How far Coneelia drifts either side of centre while winding up. */
export const SERVE_SWING = 2.35;
/** How fast she drifts (radians/sec). Slow enough to time your board to. */
export const SERVE_SWING_RATE = 0.85;

/** The target grid. */
export const TARGET_COLUMNS = 5;
export const TARGET_ROWS = 3;
export const TARGET_HALF_WIDTH = 0.62;
export const TARGET_HALF_DEPTH = 0.34;
/** Column pitch, derived so the wall spans the court with a barrier margin. */
export const TARGET_COLUMN_PITCH = (ARENA_HALF_X * 2 - 0.9) / TARGET_COLUMNS;
/** Row depths, nearest row last. */
export const TARGET_ROW_Z: readonly number[] = [-6.9, -5.75, -4.6];

/** Points a drum is worth before the rally bonus. */
export const TARGET_BASE_SCORE = 50;
/** Extra points per rally already banked when the drum went. */
export const TARGET_RALLY_BONUS = 10;
/** Rally count past which the bonus stops growing. Skill, not attrition. */
export const TARGET_RALLY_BONUS_CAP = 12;
/** Points for a clean return. Small: returning is the price of scoring. */
export const RETURN_SCORE = 5;
/** Points for clearing a whole wall of drums. */
export const WAVE_CLEAR_SCORE = 250;

/** One hazard drum suspended over the court. */
export interface ConeballTarget {
  /** Stable id — the view keys its meshes off this, so a drum never swaps mesh. */
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Grid row (0 = furthest away). Drives the drum's tint in the view. */
  readonly row: number;
  /** Grid column (0 = leftmost). */
  readonly column: number;
  /** False once it has been smashed. Smashed drums stay in the array. */
  active: boolean;
}

/**
 * Build a full wall of drums. Returns fresh objects every call, so a reset can
 * never hand the simulation the previous run's (mutated) formation.
 */
export function targetFormation(): ConeballTarget[] {
  const targets: ConeballTarget[] = [];
  const spread = (TARGET_COLUMNS - 1) / 2;
  for (let row = 0; row < TARGET_ROWS; row++) {
    for (let column = 0; column < TARGET_COLUMNS; column++) {
      targets.push({
        id: row * TARGET_COLUMNS + column,
        x: (column - spread) * TARGET_COLUMN_PITCH,
        z: TARGET_ROW_Z[row],
        row,
        column,
        active: true,
      });
    }
  }
  return targets;
}

/** How many drums a full wall holds. */
export const TARGET_COUNT = TARGET_COLUMNS * TARGET_ROWS;

/**
 * The ball's speed for a given rally and wave, capped at `BALL_SPEED_MAX`.
 * A pure function of the two counters, exactly like the highway's speed ramp:
 * it is impossible for the ramp to drift out of sync with the run.
 */
export function ballSpeedFor(rally: number, wave: number): number {
  const raw =
    BALL_SPEED_BASE +
    Math.max(0, rally) * BALL_SPEED_PER_RALLY +
    Math.max(0, wave) * BALL_SPEED_PER_WAVE;
  return Math.min(BALL_SPEED_MAX, raw);
}

/**
 * What a drum pays. The rally multiplier is the whole risk/reward argument of
 * the game: a long rally makes every drum worth more, and a long rally is
 * exactly what a fast ball makes hard to keep alive.
 */
export function targetScore(rally: number): number {
  const banked = Math.min(Math.max(0, Math.floor(rally)), TARGET_RALLY_BONUS_CAP);
  return TARGET_BASE_SCORE + banked * TARGET_RALLY_BONUS;
}

/** Keep the board inside the barriers, whatever the input asked for. */
export function clampPaddleX(x: number): number {
  const limit = ARENA_HALF_X - PADDLE_HALF_WIDTH;
  if (Number.isNaN(x)) return 0;
  if (x < -limit) return -limit;
  if (x > limit) return limit;
  return x;
}

/** Keep a served/placed ball inside the playable box on the lateral axis. */
export function clampBallX(x: number): number {
  const limit = ARENA_HALF_X - BALL_RADIUS;
  if (Number.isNaN(x)) return 0;
  if (x < -limit) return -limit;
  if (x > limit) return limit;
  return x;
}
