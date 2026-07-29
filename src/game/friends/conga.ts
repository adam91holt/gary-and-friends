/**
 * The conga line: how collected friends trail Gary.
 *
 * Pure math — no three.js, no DOM — so the whole follow behaviour is unit
 * tested at any timestep. The renderer only reads `members` and places meshes.
 *
 * ── How it works ────────────────────────────────────────────────────────────
 * This is a *path* follow, not a chain of springs pulling at each other. Every
 * frame the leader (Gary) drops a breadcrumb of `{ distance travelled, x }`.
 * Member i then targets the point on that recorded path a fixed distance back
 * — `(i + 1) * spacing` — and eases toward it.
 *
 * Sampling a shared history rather than chaining member-to-member springs is
 * the load-bearing choice: a chain low-passes the leader's motion once per
 * link, so by the fifth friend a lane change has been smoothed into a barely
 * visible wobble. Path-following makes every member perform the *same* swerve
 * Gary did, just later — which is what a conga line actually looks like, and
 * what makes a lane change read as a wave running down the tail.
 *
 * The easing on top of the sampled target is what keeps it alive: it lets the
 * line cut the corner slightly and settle, so the tail whips rather than
 * tracing a rigid rail.
 */

/** Ideal gap between friends when the line is short (world units). */
export const CONGA_MAX_SPACING = 1.3;
/**
 * Floor on the gap once the line is long. Sized past the base radius of the
 * widest friend (Big Dave), because below this the cones interpenetrate and
 * the line stops reading as a queue of characters.
 */
export const CONGA_MIN_SPACING = 0.68;
/**
 * The tail is held to roughly this total length, compressing the gaps as the
 * line grows. Without it the twentieth friend would be somewhere behind the
 * chase camera, and the reward for playing well would be *less* to look at.
 */
export const CONGA_TAIL_LENGTH = 7.2;
/** Damping rate for a member easing onto its sampled target. Higher = tighter. */
export const CONGA_FOLLOW_LAMBDA = 9;

/** One collected friend, positioned in Gary's wake. */
export interface CongaMember {
  /** Roster index (see ../friends/roster.ts). Picks the mesh and the name. */
  readonly variant: number;
  /** The friend's name, carried from the spawn that produced them. */
  readonly name: string;
  /** Continuous world X, eased toward the sampled path. */
  x: number;
  /** World Z (positive = behind Gary, toward the chase camera). */
  z: number;
  /** Per-member hop offset so the line bounces as a travelling wave. */
  readonly phase: number;
  /** Seconds since joining. The renderer pops new arrivals in with this. */
  age: number;
}

/** One recorded point on the leader's path. */
interface Breadcrumb {
  /** Cumulative distance travelled when it was dropped. */
  s: number;
  /** The leader's X at that moment. */
  x: number;
}

/** Exponential damping, frame-rate independent (same curve as MathUtils.damp). */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/**
 * Gap between friends for a line of `count`. Shrinks as the line grows so the
 * whole convoy stays in frame, but never below the width of a cone.
 */
export function congaSpacing(count: number): number {
  if (count <= 1) return CONGA_MAX_SPACING;
  const fitted = CONGA_TAIL_LENGTH / count;
  if (fitted > CONGA_MAX_SPACING) return CONGA_MAX_SPACING;
  if (fitted < CONGA_MIN_SPACING) return CONGA_MIN_SPACING;
  return fitted;
}

export class CongaLine {
  private readonly line: CongaMember[] = [];
  private readonly trail: Breadcrumb[] = [];
  /** Cumulative distance the leader has travelled since the last clear(). */
  private travelled = 0;
  private leaderX = 0;
  /** Bumped per join so hop phases never coincide. */
  private joins = 0;

  /** The line, nearest-to-Gary first. Read by the renderer; owned here. */
  get members(): readonly CongaMember[] {
    return this.line;
  }

  /** How many friends are in the line. */
  get length(): number {
    return this.line.length;
  }

  /** Current gap between members (world units). */
  get spacing(): number {
    return congaSpacing(this.line.length);
  }

  /** Total length of the tail (world units) — what the camera pulls back for. */
  get tailLength(): number {
    return this.line.length * this.spacing;
  }

  /**
   * Add a friend to the BACK of the line, already standing where it belongs.
   * Placing it on the sampled path (rather than at the origin) means a pickup
   * never fires a cone across the road to catch up.
   */
  join(variant: number, name: string): CongaMember {
    const index = this.line.length;
    const spacing = congaSpacing(index + 1);
    const member: CongaMember = {
      variant,
      name,
      x: this.sampleX(this.travelled - (index + 1) * spacing),
      z: (index + 1) * spacing,
      phase: (this.joins++ * 0.37) % 1,
      age: 0,
    };
    this.line.push(member);
    return member;
  }

  /**
   * Advance the line one frame.
   *
   * @param dt       seconds elapsed
   * @param distance world units the leader travelled this frame
   * @param leaderX  the leader's current world X
   */
  advance(dt: number, distance: number, leaderX: number): void {
    if (dt <= 0) return;
    this.leaderX = leaderX;
    if (distance > 0) {
      this.travelled += distance;
      this.trail.push({ s: this.travelled, x: leaderX });
      this.prune();
    }

    const spacing = this.spacing;
    for (let i = 0; i < this.line.length; i++) {
      const member = this.line[i];
      const targetX = this.sampleX(this.travelled - (i + 1) * spacing);
      const targetZ = (i + 1) * spacing;
      member.x = damp(member.x, targetX, CONGA_FOLLOW_LAMBDA, dt);
      member.z = damp(member.z, targetZ, CONGA_FOLLOW_LAMBDA, dt);
      member.age += dt;
    }
  }

  /** Empty the line and forget the path. Called on start()/reset(). */
  clear(): void {
    this.line.length = 0;
    this.trail.length = 0;
    this.travelled = 0;
    this.joins = 0;
  }

  /**
   * The leader's X when it had travelled `s` units. Linearly interpolated
   * between breadcrumbs; clamped to the ends of the recorded path so a line
   * longer than the history (the first moments of a run) still resolves.
   */
  sampleX(s: number): number {
    if (this.trail.length === 0) return this.leaderX;
    const first = this.trail[0];
    if (s <= first.s) return first.x;
    const last = this.trail[this.trail.length - 1];
    if (s >= last.s) return last.x;

    // Walk back from the newest crumb: the sample is always near the tail of
    // the history, so this is a handful of steps rather than a scan.
    for (let i = this.trail.length - 1; i > 0; i--) {
      const b = this.trail[i];
      const a = this.trail[i - 1];
      if (s >= a.s && s <= b.s) {
        const span = b.s - a.s;
        if (span <= 0) return b.x;
        const t = (s - a.s) / span;
        return a.x + (b.x - a.x) * t;
      }
    }
    return first.x;
  }

  /** Drop breadcrumbs older than the longest tail we could ever sample. */
  private prune(): void {
    const horizon = this.travelled - (CONGA_TAIL_LENGTH + CONGA_MAX_SPACING * 2);
    let drop = 0;
    while (drop + 1 < this.trail.length && this.trail[drop + 1].s < horizon) {
      drop++;
    }
    if (drop > 0) this.trail.splice(0, drop);
  }
}
