/**
 * Big Bounce's view: the whole scene subtree, assembled and driven.
 *
 * Rendering-side only. It owns the court, the cast, the ball, the drums, the
 * sparks and the arena's lighting, and every frame it *reads* the pure
 * `ConeballSim` and places things accordingly. It decides nothing about the
 * game: the ball's position, the board's position, which drums are standing and
 * whether a life was lost all come from `src/game/games/coneball/`.
 *
 * Materials come from the shared `render/materials.ts` contract, and nothing
 * here touches tone mapping, exposure or post — those belong to the shell's
 * pipeline (`render/pipeline.ts`), which every game inherits.
 *
 * ── The committed idea ──────────────────────────────────────────────────────
 * The court is lit almost entirely by the BALL. A point light rides it, so the
 * drums, the barriers and Bartholocone's face are only fully modelled as the
 * ball sweeps past them — the thing you are tracking is the thing lighting the
 * room, and a rally literally illuminates the arena in the shape of the line
 * the ball took. Static fill exists only to keep the court legible when the
 * ball is in Coneelia's hands.
 */
import { DirectionalLight, Group, SpotLight } from 'three';
import {
  BALL_RADIUS,
  PADDLE_Z,
  SERVE_Z,
  type ConeballTarget,
} from '../../../game/games/coneball/arena.ts';
import type { ConeballSim } from '../../../game/games/coneball/sim.ts';
import { ACCENT } from '../../../theme.ts';
import { Ball } from './ball.ts';
import { Paddle, Server } from './cast.ts';
import { Court } from './court.ts';
import { Sparks } from './sparks.ts';
import { Targets } from './targets.ts';

/** Where a contact spark sits above the floor. Level with the ball's centre. */
const CONTACT_Y = BALL_RADIUS + 0.22;

export class ConeballView {
  readonly root = new Group();

  private readonly court = new Court();
  private readonly targets = new Targets();
  private readonly paddle = new Paddle();
  private readonly server = new Server();
  private readonly ball = new Ball();
  private readonly sparks = new Sparks();
  /** Follows the ball, so the arena is lit by the thing you are tracking. */
  private readonly ballKey: SpotLight;

  /** Last frame's board X, for the lean. */
  private previousPaddleX = 0;

  constructor() {
    this.root.name = 'Coneball';

    // Static fill. Deliberately dim and cool: the ball's own light is what the
    // court is really lit by, and a bright key would flatten that idea.
    const key = new DirectionalLight(0xa9b6ff, 0.55);
    key.position.set(3, 7, 6);
    const rim = new DirectionalLight(0xff9c4a, 0.35);
    rim.position.set(-4, 3, -7);
    this.root.add(key, rim);

    // A soft warm pool over the player's end so Bartholocone is always readable
    // even when the ball is up at the far gantry.
    this.ballKey = new SpotLight(ACCENT, 14, 16, 0.9, 0.55, 1.4);
    this.ballKey.position.set(0, 6.5, PADDLE_Z - 2);
    this.ballKey.target.position.set(0, 0, PADDLE_Z);
    this.root.add(this.ballKey, this.ballKey.target);

    this.root.add(
      this.court.group,
      this.targets.group,
      this.paddle.group,
      this.server.group,
      this.ball.group,
      this.sparks.group,
    );
    // Trail links ride in world space, not under the moving ball.
    for (const link of this.ball.trailMeshes) this.root.add(link);
  }

  /** Live particles across both spark pools. Read by the runtime's snapshot. */
  get particleCount(): number {
    return this.sparks.liveCount;
  }

  /* ── Event hooks. The simulation calls these; they only make it feel. ───── */

  onServe(): void {
    this.server.serve();
    this.court.serveFlash();
    this.ball.clearTrail();
  }

  onReturn(x: number, paddleX: number, halfWidth: number): void {
    const offset = Math.max(-1, Math.min(1, (x - paddleX) / halfWidth));
    this.paddle.strike(offset);
    this.ball.hit(1);
    this.sparks.paddle(x, CONTACT_Y, PADDLE_Z - 0.3);
  }

  onWall(x: number, z: number): void {
    this.ball.hit(0.45);
    this.sparks.wall(x, CONTACT_Y, z);
  }

  onTarget(target: ConeballTarget): void {
    this.ball.hit(0.8);
    this.sparks.target(target.x, CONTACT_Y + 0.3, target.z, target.row);
  }

  onMiss(x: number): void {
    this.court.missFlare();
    this.sparks.miss(x, PADDLE_Z + 1.2);
    this.ball.clearTrail();
  }

  /** Draw one frame from the simulation's current state. */
  update(sim: ConeballSim, dt: number, time: number, reducedMotion: boolean): void {
    const velocity = dt > 0 ? (sim.paddleX - this.previousPaddleX) / dt : 0;
    this.previousPaddleX = sim.paddleX;

    this.paddle.update(sim.paddleX, velocity, dt, time, reducedMotion);
    // She stands just BEHIND the serve spot (further up the court), so the ball
    // reads as leaving her hands rather than passing through her.
    this.server.update(
      sim.serverX,
      SERVE_Z - 0.75,
      sim.serveState === 'serving',
      dt,
      time,
      reducedMotion,
    );

    const live = sim.serveState === 'live';
    this.ball.setVisible(true);
    this.ball.update(sim.ball.x, sim.ball.z, live, dt, time, reducedMotion);

    // The ball's light follows it up and down the court, so the drums it is
    // approaching light up before it arrives — the anticipation cue the whole
    // mechanic is about.
    this.ballKey.position.set(sim.ball.x * 0.6, 6.5, sim.ball.z + 1.2);
    this.ballKey.target.position.set(sim.ball.x, 0, sim.ball.z);

    this.targets.sync(sim.targets, dt, time, reducedMotion);
    this.court.update(dt, time, reducedMotion);
    this.sparks.update(dt);
  }

  /** Back to a clean, drawable court. Called on every run start/restart. */
  reset(): void {
    this.ball.reset();
    this.paddle.reset();
    this.server.reset();
    this.court.reset();
    this.sparks.clear();
    this.targets.clear();
    this.previousPaddleX = 0;
  }
}
