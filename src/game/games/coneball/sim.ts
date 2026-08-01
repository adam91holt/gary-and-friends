/**
 * Bartholocone's Big Bounce — the simulation.
 *
 * Pure: no three.js, no DOM, no `window`. It owns the board, the ball, the wall
 * of hazard drums, the rally, the lives and the wave, and it talks to the world
 * only through `GameStore` actions and a small event bag. The view in
 * `src/scene/games/coneball/` reads this and draws it; it decides nothing.
 *
 * ── Why fixed substeps ──────────────────────────────────────────────────────
 * The other two games in the cabinet resolve their whole mechanic on a discrete
 * input (a lane index, a drop). A ball is continuous, so its behaviour must not
 * depend on how long the browser happened to take between frames: a rally that
 * bounces differently at 30fps than at 120fps is not a rally, it is a lottery.
 * So `update(dt)` only accumulates time, and the simulation always advances in
 * `FIXED_STEP` slices. Sixty frames of 1/60 and one frame of 1.0 leave the ball
 * in the same place, and `sim.test.ts` asserts that.
 *
 * ── Why the sweep on top of that ────────────────────────────────────────────
 * A fixed step bounds how far the ball moves per slice, but "bounded" is not
 * "small": at BALL_SPEED_MAX the ball crosses a good fraction of the board's
 * depth in a slice, and the drums are thinner still. So every slice resolves
 * through the continuous circle/box sweep in `sweep.ts` — first contact,
 * reflect, spend the remainder of the slice along the new heading, repeat. The
 * ball can therefore never be on one side of a surface at the start of a slice
 * and the other side at the end without the contact being resolved.
 */
import type { ArcadeSnapshot } from '../../arcade/contracts.ts';
import { createRng, randomRange, type Rng } from '../../entities/rng.ts';
import type { GameStatus, GameStore } from '../../state.ts';
import {
  ARENA_FAR_Z,
  ARENA_HALF_X,
  BALL_RADIUS,
  MAX_RETURN_ANGLE,
  MAX_SERVE_ANGLE,
  MISS_Z,
  PADDLE_HALF_DEPTH,
  PADDLE_HALF_WIDTH,
  PADDLE_LAMBDA,
  PADDLE_STEP,
  PADDLE_Z,
  RETURN_SCORE,
  SERVE_SWING,
  SERVE_SWING_RATE,
  SERVE_Z,
  START_LIVES,
  TARGET_HALF_DEPTH,
  TARGET_HALF_WIDTH,
  TARGET_ROW_Z,
  WAVE_CLEAR_SCORE,
  ballSpeedFor,
  clampBallX,
  clampPaddleX,
  targetFormation,
  targetScore,
  type ConeballTarget,
} from './arena.ts';
import { reflect, sweepCircleAabb, type Aabb, type Vec2 } from './sweep.ts';

/** The simulation slice. 120Hz: fine enough to be smooth, cheap enough to be free. */
export const FIXED_STEP = 1 / 120;

/**
 * Most slices one `update` may run. At the shell's 0.1s frame clamp this is
 * never reached in practice; it exists so a pathological dt (a backgrounded tab
 * handing us a whole second) cannot lock the main thread catching up.
 */
const MAX_STEPS_PER_UPDATE = 32;

/** Contacts resolved within a single slice before we give up and just move. */
const MAX_CONTACTS_PER_STEP = 6;

/**
 * How far a resolved contact parks the ball off the surface. Large enough to
 * survive float error (so the very next sweep does not see the ball still
 * overlapping and reflect it straight back in), small enough to be invisible.
 */
const CONTACT_SKIN = 1e-4;

/**
 * While a freshly-dropped wall is settling, the ball must be clear of this Z
 * before drums become solid again. Without it, the ball that smashed the LAST
 * drum of a wave is standing exactly where a new drum materialises, and would
 * chain-smash two or three of them for free the instant they appear.
 */
const WAVE_ARM_Z = TARGET_ROW_Z[TARGET_ROW_Z.length - 1] + 1.6;

/**
 * The least fraction of its speed the ball must always be spending on travel
 * ALONG the court. Roughly 17°, which is shallow enough to still read as a
 * wicked angle and steep enough that the ball is always going somewhere.
 * See `enforceCourtProgress`.
 */
const MIN_COURT_FRACTION = 0.3;

/** Where the ball is and where it is going. Plain data; the view reads it. */
export interface ConeballBall {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Waiting on Coneelia's serve, or live in the rally. */
export type ConeballServeState = 'serving' | 'live';

/** What the runtime reports. `ArcadeSnapshot` plus everything Big Bounce owns. */
export interface ConeballSnapshot extends ArcadeSnapshot {
  readonly game: 'coneball';
  /** Mirrors the store, so a test can read one object rather than two. */
  readonly status: GameStatus;
  /** Returns banked this run. Never resets mid-run — it is the score's engine. */
  readonly rally: number;
  /** Lives left. Reaching 0 ends the run. */
  readonly lives: number;
  /** Walls of drums cleared, plus the one in progress. 1-based. */
  readonly wave: number;
  /** Drums still standing in the current wall. */
  readonly targetsRemaining: number;
  /**
   * The current wall, smashed drums included (`active: false`).
   *
   * Deliberately the simulation's own live array rather than a per-frame copy:
   * the snapshot is read every frame by the HUD, and rebuilding fifteen objects
   * sixty times a second to hand out data nobody mutates would be waste. It is
   * replaced wholesale on a reset or a wave clear, so a holder can never end up
   * looking at a formation the solver has moved on from.
   */
  readonly targets: readonly Readonly<ConeballTarget>[];
  /** Whether Coneelia is still holding the ball. */
  readonly serving: boolean;
  /** The ball, as of this frame. */
  readonly ball: Readonly<ConeballBall>;
  /** The board's drawn position. */
  readonly paddleX: number;
  /** The board's commanded position. Differs while the slide is in flight. */
  readonly paddleTargetX: number;
  /** The ball's current speed. Bounded by BALL_SPEED_MAX at all times. */
  readonly ballSpeed: number;
}

/**
 * What the simulation tells the view. Same contract as the highway's `Run`:
 * the simulation reports *what happened*, presentation decides how it feels.
 */
export interface ConeballEvents {
  /** Coneelia let go. */
  onServe?: (ball: Readonly<ConeballBall>) => void;
  /** Bartholocone returned it. `rally` is the count including this return. */
  onReturn?: (x: number, rally: number) => void;
  /** The ball hit a barrier or the far gantry, at this point. */
  onWall?: (x: number, z: number) => void;
  /** A drum was smashed. */
  onTarget?: (target: ConeballTarget, points: number) => void;
  /** The wall was cleared; a fresh one has already been placed. */
  onWaveClear?: (wave: number) => void;
  /** The ball got past the board. `lives` is what remains. */
  onMiss?: (x: number, lives: number) => void;
}

export interface ConeballOptions {
  /** Seed for serve angles. Same seed => byte-identical run. */
  seed?: number;
  readonly events?: ConeballEvents;
}

const DEFAULT_SEED = 0x60fb;

export class ConeballSim {
  /** The current wall of drums, smashed ones included (`active: false`). */
  targets: ConeballTarget[] = targetFormation();

  /** The board's drawn X. Damped toward `paddleTargetX`. */
  paddleX = 0;
  /** The board's commanded X. Moved by input, clamped to the barriers. */
  paddleTargetX = 0;

  /** The ball. Position is continuous; `serving` parks it in Coneelia's hands. */
  readonly ball: ConeballBall = { x: 0, z: SERVE_Z, vx: 0, vz: 0 };

  /** The ball's collision radius. Exposed so the view cannot disagree with it. */
  readonly ballRadius = BALL_RADIUS;

  serveState: ConeballServeState = 'serving';
  rally = 0;
  lives = START_LIVES;
  /** 1-based: the first wall of drums is wave 1. */
  wave = 1;

  /** Coneelia's wind-up phase. Drives her drift, and therefore the serve spot. */
  private servePhase = 0;
  /** True while a freshly-dropped wall is still settling (see WAVE_ARM_Z). */
  private waveSettling = false;
  /** Unconsumed real time, in seconds. Keeps the slice size exactly fixed. */
  private accumulator = 0;
  private readonly seed: number;
  private rng: Rng;
  private readonly events: ConeballEvents;

  constructor(
    private readonly store: GameStore,
    options: ConeballOptions = {},
  ) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = createRng(this.seed);
    this.events = options.events ?? {};
    this.parkBallForServe();
  }

  /** The run's status, projected from the store. */
  get status(): GameStatus {
    return this.store.getState().status;
  }

  /** The ball's speed. Read by tests to prove the ramp stays under its ceiling. */
  get ballSpeed(): number {
    return Math.hypot(this.ball.vx, this.ball.vz);
  }

  /** Drums still standing. */
  get targetsRemaining(): number {
    let remaining = 0;
    for (const target of this.targets) if (target.active) remaining++;
    return remaining;
  }

  /** Where Coneelia is standing right now. The view places her from this. */
  get serverX(): number {
    return clampBallX(Math.sin(this.servePhase) * SERVE_SWING);
  }

  /** Whether a freshly-dropped wall is still settling in. The view fades it in. */
  get waveDropping(): boolean {
    return this.waveSettling;
  }

  /**
   * Back to a clean, playable court: board centred, a full wall of drums, three
   * lives, no rally, and the ball back in Coneelia's hands. The RNG is re-seeded
   * too, so a restart is genuinely the same game again rather than a
   * continuation of the last one's random stream.
   */
  reset(): void {
    this.targets = targetFormation();
    this.paddleX = 0;
    this.paddleTargetX = 0;
    this.serveState = 'serving';
    this.rally = 0;
    this.lives = START_LIVES;
    this.wave = 1;
    this.servePhase = 0;
    this.waveSettling = false;
    this.accumulator = 0;
    this.rng = createRng(this.seed);
    this.parkBallForServe();
  }

  /** Slide the board one step. `direction` is -1 (left) or +1 (right). */
  moveBoard(direction: number): void {
    if (this.status !== 'playing') return;
    const sign = direction < 0 ? -1 : 1;
    this.paddleTargetX = clampPaddleX(this.paddleTargetX + sign * PADDLE_STEP);
  }

  /**
   * Let the ball go, from wherever Coneelia currently is. No-op unless a serve
   * is actually pending, so a mashed primary during a rally does nothing.
   *
   * The direction is a seeded angle biased gently back toward the middle of the
   * court, so a serve from the far edge still crosses the court rather than
   * immediately kissing a barrier. Both terms are bounded by `MAX_SERVE_ANGLE`,
   * and the ball always leaves travelling toward the player.
   */
  serve(): boolean {
    if (this.status !== 'playing') return false;
    if (this.serveState !== 'serving') return false;

    const centreBias = -(this.ball.x / ARENA_HALF_X) * MAX_SERVE_ANGLE * 0.6;
    const spread = randomRange(this.rng, -MAX_SERVE_ANGLE, MAX_SERVE_ANGLE);
    const angle = clampAngle(centreBias + spread, MAX_SERVE_ANGLE);
    const speed = ballSpeedFor(this.rally, this.wave - 1);

    this.ball.vx = Math.sin(angle) * speed;
    // Toward the player: the court runs from the far gantry (-Z) to the board.
    this.ball.vz = Math.cos(angle) * speed;
    this.serveState = 'live';
    this.events.onServe?.(this.ball);
    return true;
  }

  /**
   * Advance the simulation. No-op unless playing, which is what makes game-over
   * stop the world: the ball freezes exactly where it was lost.
   *
   * `dt` is only ever accumulated — every bit of physics happens in `step()` at
   * exactly `FIXED_STEP`.
   */
  update(dt: number): void {
    if (this.status !== 'playing' || dt <= 0 || !Number.isFinite(dt)) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_UPDATE) {
      this.accumulator -= FIXED_STEP;
      this.step(FIXED_STEP);
      steps++;
    }
    // Hitting the cap means we are hopelessly behind; drop the backlog rather
    // than carrying a debt that would fast-forward the next dozen frames.
    if (steps >= MAX_STEPS_PER_UPDATE) this.accumulator = 0;
  }

  /** One fixed slice: board, Coneelia, then the ball. */
  private step(dt: number): void {
    this.paddleX = damp(this.paddleX, this.paddleTargetX, PADDLE_LAMBDA, dt);
    // She keeps pacing the gantry through a rally too — she is a character
    // waiting for the ball to come back, not a spawner that switches off.
    this.servePhase += dt * SERVE_SWING_RATE;

    if (this.serveState === 'serving') {
      this.parkBallForServe();
      return;
    }
    // A settling wall arms again once the ball is clear of the drop zone.
    if (this.waveSettling && this.ball.z > WAVE_ARM_Z) this.waveSettling = false;
    this.advanceBall(dt);
  }

  /** The ball riding in Coneelia's hands, wherever she has drifted to. */
  private parkBallForServe(): void {
    this.ball.x = this.serverX;
    this.ball.z = SERVE_Z;
    this.ball.vx = 0;
    this.ball.vz = 0;
  }

  /**
   * Move the ball through one slice, resolving every surface it meets on the
   * way rather than only where it happens to land.
   */
  private advanceBall(dt: number): void {
    let remaining = dt;

    for (let contact = 0; contact < MAX_CONTACTS_PER_STEP; contact++) {
      if (remaining <= 0) break;
      const delta: Vec2 = {
        x: this.ball.vx * remaining,
        z: this.ball.vz * remaining,
      };
      const hit = this.firstContact(delta);
      if (hit === null) {
        this.ball.x += delta.x;
        this.ball.z += delta.z;
        break;
      }

      // Travel to the contact point, then hand the surface its consequence.
      this.ball.x += delta.x * hit.t;
      this.ball.z += delta.z * hit.t;
      remaining *= 1 - hit.t;
      this.resolve(hit);
    }

    this.checkMiss();
  }

  /** The earliest surface this displacement meets, if any. */
  private firstContact(delta: Vec2): ResolvedContact | null {
    let best: ResolvedContact | null = this.sweepBarriers(delta);
    best = earlier(best, this.sweepFarWall(delta));
    best = earlier(best, this.sweepBox(delta, this.paddleBox(), PADDLE_SURFACE));

    if (!this.waveSettling) {
      for (const target of this.targets) {
        if (!target.active) continue;
        best = earlier(
          best,
          this.sweepBox(
            delta,
            {
              x: target.x,
              z: target.z,
              halfWidth: TARGET_HALF_WIDTH,
              halfDepth: TARGET_HALF_DEPTH,
            },
            { kind: 'target', target },
          ),
        );
      }
    }
    return best;
  }

  /** The side barriers, as two planes. */
  private sweepBarriers(delta: Vec2): ResolvedContact | null {
    const limit = ARENA_HALF_X - BALL_RADIUS;
    const plane = planeCross(this.ball.x, delta.x, limit);
    if (plane === null) return null;
    return { t: plane.t, normal: { x: plane.sign, z: 0 }, kind: 'wall' };
  }

  /** The far gantry wall, as one plane. The ball never leaves past it. */
  private sweepFarWall(delta: Vec2): ResolvedContact | null {
    const limit = ARENA_FAR_Z + BALL_RADIUS;
    if (delta.z >= 0) return null;
    if (this.ball.z + delta.z > limit) return null;
    const t = clamp01((limit - this.ball.z) / delta.z);
    return { t, normal: { x: 0, z: 1 }, kind: 'wall' };
  }

  private paddleBox(): Aabb {
    return {
      x: this.paddleX,
      z: PADDLE_Z,
      halfWidth: PADDLE_HALF_WIDTH,
      halfDepth: PADDLE_HALF_DEPTH,
    };
  }

  private sweepBox(
    delta: Vec2,
    box: Aabb,
    surface: ContactSurface,
  ): ResolvedContact | null {
    const hit = sweepCircleAabb(this.ball, delta, BALL_RADIUS, box);
    if (hit === null) return null;
    return { ...surface, t: hit.t, normal: hit.normal };
  }

  /** Apply a contact: nudge clear of the surface, then pay its consequence. */
  private resolve(contact: ResolvedContact): void {
    // Always separate first. A ball parked exactly ON a surface would be seen as
    // overlapping by the next sweep and reflected a second time.
    this.ball.x += contact.normal.x * CONTACT_SKIN;
    this.ball.z += contact.normal.z * CONTACT_SKIN;

    switch (contact.kind) {
      case 'wall': {
        this.bounce(contact.normal);
        this.events.onWall?.(this.ball.x, this.ball.z);
        return;
      }
      case 'target': {
        contact.target.active = false;
        const points = targetScore(this.rally);
        this.store.addScore(points);
        this.bounce(contact.normal);
        this.events.onTarget?.(contact.target, points);
        if (this.targetsRemaining === 0) this.clearWave();
        return;
      }
      case 'paddle':
        this.resolvePaddle(contact);
        return;
    }
  }

  /** Plain mirror off a surface, preserving speed. */
  private bounce(normal: Vec2): void {
    // The VELOCITY is what mirrors. `ConeballBall` carries position and
    // velocity in one object, so this deliberately builds the vector rather
    // than handing the ball over and reflecting its position by accident.
    const bounced = reflect({ x: this.ball.vx, z: this.ball.vz }, normal);
    this.ball.vx = bounced.x;
    this.ball.vz = bounced.z;
    this.enforceCourtProgress();
  }

  /**
   * Guarantee the ball is always making progress ALONG the court.
   *
   * A clean corner clip off a drum can convert almost all of the ball's forward
   * motion into lateral motion, at which point it skates side to side between
   * the barriers at a fixed depth — a rally the player can neither lose nor
   * influence, which is the worst state a ball game can reach. So a bounce that
   * leaves the ball nearly flat is tilted back to `MIN_COURT_FRACTION` of its
   * speed along Z, at the SAME speed: it is a redirection, never a boost.
   */
  private enforceCourtProgress(): void {
    const speed = this.ballSpeed;
    if (speed <= 0) return;
    const minZ = speed * MIN_COURT_FRACTION;
    if (Math.abs(this.ball.vz) >= minZ) return;
    // Preserve the heading where there is one; a dead-flat ball is sent back up
    // the court, which is the direction that keeps the drums in play.
    const sign = this.ball.vz === 0 ? -1 : Math.sign(this.ball.vz);
    const vz = sign * minZ;
    const vx = Math.sign(this.ball.vx || 1) * Math.sqrt(
      Math.max(0, speed * speed - vz * vz),
    );
    this.ball.vx = vx;
    this.ball.vz = vz;
  }

  /**
   * The board's contact rule — the one place in the game where the player's
   * position is an *aim* rather than a save.
   *
   * Where on the board the ball lands decides the angle it leaves at: dead
   * centre sends it straight back up the court, the edges throw it wide. That
   * is what makes the board a tool for reaching the outer columns of drums
   * rather than a wall you cower behind, and it is why the rally is worth
   * keeping alive.
   *
   * A contact on the board's BACK face (the player slid it over a ball that had
   * already beaten them) is a plain bounce: it must not resurrect a lost rally,
   * and it must not count toward the rally counter.
   */
  private resolvePaddle(contact: ResolvedContact): void {
    if (contact.normal.z > 0) {
      this.bounce(contact.normal);
      return;
    }

    this.rally++;
    const offset = clampUnit((this.ball.x - this.paddleX) / PADDLE_HALF_WIDTH);
    const angle = offset * MAX_RETURN_ANGLE;
    const speed = ballSpeedFor(this.rally, this.wave - 1);
    this.ball.vx = Math.sin(angle) * speed;
    // Back up the court, toward the drums.
    this.ball.vz = -Math.cos(angle) * speed;
    // Park it clear of the front face so the next slice starts in open court —
    // an edge contact can leave the ball level with the board's flank, and a
    // ball that is still beside the board when the player slides it is a ball
    // that gets hit twice.
    this.ball.z = Math.min(
      this.ball.z,
      PADDLE_Z - PADDLE_HALF_DEPTH - BALL_RADIUS - CONTACT_SKIN,
    );

    this.store.addScore(RETURN_SCORE);
    this.events.onReturn?.(this.ball.x, this.rally);
  }

  /** A cleared wall: score it, stand a fresh one up, and keep the rally alive. */
  private clearWave(): void {
    this.wave++;
    this.targets = targetFormation();
    this.waveSettling = true;
    this.store.addScore(WAVE_CLEAR_SCORE);
    // The next wall is quicker. Re-derive from the ramp rather than scaling the
    // current velocity, so speed stays a pure function of rally and wave.
    const speed = ballSpeedFor(this.rally, this.wave - 1);
    const current = this.ballSpeed;
    if (current > 0) {
      this.ball.vx = (this.ball.vx / current) * speed;
      this.ball.vz = (this.ball.vz / current) * speed;
    }
    this.events.onWaveClear?.(this.wave);
  }

  /** Past the board and gone: spend a life, and end the run at zero. */
  private checkMiss(): void {
    if (this.serveState !== 'live') return;
    if (this.ball.z - BALL_RADIUS <= MISS_Z) return;

    this.lives--;
    const x = this.ball.x;
    if (this.lives <= 0) {
      this.lives = 0;
      this.ball.vx = 0;
      this.ball.vz = 0;
      this.events.onMiss?.(x, 0);
      this.store.gameOver();
      return;
    }
    // A life costs the rally: the run's multiplier is the thing you were
    // protecting, so losing the ball has to cost more than a number of tries.
    this.rally = 0;
    this.serveState = 'serving';
    this.parkBallForServe();
    this.events.onMiss?.(x, this.lives);
  }

  /**
   * Deterministic test hook: place the ball (and optionally the board) and let
   * the NORMAL rules resolve whatever happens next.
   *
   * It sets up a situation; it never asserts an outcome. The ball still has to
   * genuinely reach the board through the swept solver to count as a return,
   * still has to genuinely reach a drum to smash it, and still has to genuinely
   * cross `MISS_Z` to cost a life — which is exactly what makes the e2e
   * lifecycle a test of the game rather than of the hook.
   */
  placeBall(placement: ConeballPlacement): boolean {
    if (this.status !== 'playing') return false;
    if (
      !Number.isFinite(placement.x) ||
      !Number.isFinite(placement.z) ||
      !Number.isFinite(placement.vx) ||
      !Number.isFinite(placement.vz)
    ) {
      return false;
    }
    if (placement.paddleX !== undefined) {
      this.paddleTargetX = clampPaddleX(placement.paddleX);
      this.paddleX = this.paddleTargetX;
    }
    this.ball.x = clampBallX(placement.x);
    this.ball.z = Math.min(
      Math.max(placement.z, ARENA_FAR_Z + BALL_RADIUS),
      MISS_Z,
    );
    this.ball.vx = placement.vx;
    this.ball.vz = placement.vz;
    this.serveState = 'live';
    // A placed ball is in open court by definition; nothing is settling.
    this.waveSettling = false;
    return true;
  }

  /** Everything the runtime needs to report itself, in one read. */
  snapshot(score: number): ConeballSnapshot {
    return {
      game: 'coneball',
      score,
      // Live things on the court: the standing drums plus the ball itself.
      entities: this.targetsRemaining + (this.serveState === 'live' ? 1 : 0),
      // The HUD renders exactly one metric slot, so the label carries the
      // lives: "Rally ●●○" reads as one instrument at a glance and never
      // reduces a life to a number you have to translate. The dots are the
      // shell's own dot characters, not an icon from a second set.
      metric: { label: `Rally  ${livesPips(this.lives)}`, value: this.rally },
      status: this.status,
      rally: this.rally,
      lives: this.lives,
      wave: this.wave,
      targetsRemaining: this.targetsRemaining,
      targets: this.targets,
      serving: this.serveState === 'serving',
      ball: { ...this.ball },
      paddleX: this.paddleX,
      paddleTargetX: this.paddleTargetX,
      ballSpeed: this.ballSpeed,
    };
  }
}

/** Payload for the deterministic placement hook. */
export interface ConeballPlacement {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Optional: snap the board here first (both drawn and commanded position). */
  readonly paddleX?: number;
}

/** Which surface a contact was with, and what it carries. */
type ContactSurface =
  | { readonly kind: 'wall' }
  | { readonly kind: 'paddle' }
  | { readonly kind: 'target'; readonly target: ConeballTarget };

type ResolvedContact = ContactSurface & {
  readonly t: number;
  readonly normal: Vec2;
};

const PADDLE_SURFACE: ContactSurface = { kind: 'paddle' };

/**
 * Lives as filled/hollow pips, for the HUD's single metric label.
 *
 * The shell renders exactly one metric slot per game (see ArcadeMetric), and
 * the rally is the number worth watching — so the lives ride in the LABEL,
 * where three pips read as a state at a glance rather than as a second number
 * competing with the score. Typographic characters, not emoji and not a second
 * icon set: they inherit the label's own colour and weight.
 */
function livesPips(lives: number): string {
  const safe = Math.max(0, Math.min(START_LIVES, Math.floor(lives)));
  return '●'.repeat(safe) + '○'.repeat(START_LIVES - safe);
}

/** The earlier of two candidate contacts. */
function earlier(
  a: ResolvedContact | null,
  b: ResolvedContact | null,
): ResolvedContact | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.t < a.t ? b : a;
}

/**
 * Frame-rate independent exponential approach — the same rule three's
 * `MathUtils.damp` implements, reproduced here because this module may not
 * import three.
 */
export function damp(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Where a 1D position crosses ±limit within this displacement, if it does. */
function planeCross(
  position: number,
  delta: number,
  limit: number,
): { t: number; sign: number } | null {
  if (delta > 0 && position + delta > limit) {
    return { t: clamp01((limit - position) / delta), sign: -1 };
  }
  if (delta < 0 && position + delta < -limit) {
    return { t: clamp01((-limit - position) / delta), sign: 1 };
  }
  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < -1) return -1;
  return value > 1 ? 1 : value;
}

function clampAngle(value: number, limit: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < -limit) return -limit;
  return value > limit ? limit : value;
}
