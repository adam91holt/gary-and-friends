import { beforeEach, describe, expect, it } from 'vitest';
import { GameStore } from '../../state.ts';
import {
  ARENA_FAR_Z,
  ARENA_HALF_X,
  BALL_RADIUS,
  BALL_SPEED_MAX,
  MISS_Z,
  PADDLE_HALF_DEPTH,
  PADDLE_HALF_WIDTH,
  PADDLE_STEP,
  PADDLE_Z,
  RETURN_SCORE,
  SERVE_Z,
  START_LIVES,
  TARGET_COUNT,
  TARGET_HALF_DEPTH,
  WAVE_CLEAR_SCORE,
  ballSpeedFor,
  clampPaddleX,
  targetFormation,
  targetScore,
  type ConeballTarget,
} from './arena.ts';
import { ConeballSim, FIXED_STEP, type ConeballEvents } from './sim.ts';

/** A store already in a run, so the sim is live. */
function playing(): GameStore {
  const store = new GameStore();
  store.selectGame('coneball');
  store.start();
  return store;
}

/** Advance `seconds` of simulation in browser-sized frames. */
function run(sim: ConeballSim, seconds: number, dt = 1 / 60): void {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) sim.update(dt);
}

/**
 * A drum in the row NEAREST the player, in `column`. A ball fired up the court
 * always meets this row first, so a test aiming at a drum behind it would be
 * asserting about the wrong one.
 */
function nearestRowTarget(sim: ConeballSim, column: number): ConeballTarget {
  const nearest = sim.targets
    .filter((t) => t.column === column)
    .sort((a, b) => b.z - a.z)[0];
  if (!nearest) throw new Error(`No drum in column ${column}`);
  return nearest;
}

describe('ConeballSim — serve', () => {
  let store: GameStore;
  let sim: ConeballSim;

  beforeEach(() => {
    store = playing();
    sim = new ConeballSim(store, { seed: 7 });
  });

  it('starts in the serve state with the ball parked at the far end', () => {
    expect(sim.serveState).toBe('serving');
    expect(sim.ball.z).toBeCloseTo(SERVE_Z, 6);
    expect(sim.ballSpeed).toBe(0);
    expect(sim.lives).toBe(START_LIVES);
    expect(sim.rally).toBe(0);
  });

  it('serves toward the player, within the serve angle, at the base speed', () => {
    expect(sim.serve()).toBe(true);
    expect(sim.serveState).toBe('live');
    // +Z is toward the board, so a serve that does not come at the player is a
    // serve the player can never return.
    expect(sim.ball.vz).toBeGreaterThan(0);
    expect(sim.ballSpeed).toBeCloseTo(ballSpeedFor(0, 0), 6);
    // Bounded angle: the lateral component never dominates.
    expect(Math.abs(sim.ball.vx)).toBeLessThan(sim.ball.vz);
  });

  it('serves from open court, so the ball reaches the player untouched', () => {
    // Coneelia stands in FRONT of the hazard wall. A serve from behind it would
    // start inside the back row: every serve would smash a free drum and
    // rebound away, and the player would never get a swing at it.
    expect(SERVE_Z).toBeGreaterThan(Math.max(...targetFormation().map((t) => t.z)));
    expect(SERVE_Z).toBeLessThan(PADDLE_Z);

    sim.serve();
    // Long enough to cross the open half and reach the board.
    run(sim, 0.7);
    expect(sim.targetsRemaining).toBe(TARGET_COUNT);
    expect(sim.lives).toBe(START_LIVES);
  });

  it('serves from anywhere in her drift without clipping the wall', () => {
    // Walk her whole patrol and check every serve leaves the drums standing.
    for (let phase = 0; phase < 12; phase++) {
      const local = new ConeballSim(playing(), { seed: 200 + phase });
      run(local, phase * 0.25);
      local.serve();
      run(local, 0.7);
      expect(local.targetsRemaining).toBe(TARGET_COUNT);
    }
  });

  it('refuses a second serve while the ball is live', () => {
    expect(sim.serve()).toBe(true);
    expect(sim.serve()).toBe(false);
  });

  it('refuses to serve when the run is not playing', () => {
    store.gameOver();
    expect(sim.serve()).toBe(false);
    expect(sim.serveState).toBe('serving');
  });

  it('is deterministic for a given seed and diverges for another', () => {
    const a = new ConeballSim(playing(), { seed: 99 });
    const b = new ConeballSim(playing(), { seed: 99 });
    const c = new ConeballSim(playing(), { seed: 100 });
    a.serve();
    b.serve();
    c.serve();
    expect(a.ball.vx).toBe(b.ball.vx);
    expect(c.ball.vx).not.toBe(a.ball.vx);
  });

  it('drifts the serve spot over time, so the serve is not always the same', () => {
    const first = sim.ball.x;
    run(sim, 1.2);
    expect(sim.ball.x).not.toBeCloseTo(first, 3);
    expect(Math.abs(sim.ball.x)).toBeLessThanOrEqual(ARENA_HALF_X - BALL_RADIUS);
  });
});

describe('ConeballSim — the board', () => {
  let sim: ConeballSim;

  beforeEach(() => {
    sim = new ConeballSim(playing(), { seed: 3 });
  });

  it('moves left and right by one step per input', () => {
    sim.moveBoard(1);
    expect(sim.paddleTargetX).toBeCloseTo(PADDLE_STEP, 6);
    sim.moveBoard(-1);
    expect(sim.paddleTargetX).toBeCloseTo(0, 6);
  });

  it('slides the drawn board toward its target rather than teleporting', () => {
    sim.moveBoard(1);
    expect(sim.paddleX).toBe(0);
    sim.update(FIXED_STEP);
    expect(sim.paddleX).toBeGreaterThan(0);
    expect(sim.paddleX).toBeLessThan(PADDLE_STEP);
    run(sim, 1);
    expect(sim.paddleX).toBeCloseTo(PADDLE_STEP, 3);
  });

  it('clamps to the barriers however many times the player pushes', () => {
    for (let i = 0; i < 40; i++) sim.moveBoard(1);
    const limit = ARENA_HALF_X - PADDLE_HALF_WIDTH;
    expect(sim.paddleTargetX).toBeCloseTo(limit, 6);
    run(sim, 1.5);
    expect(sim.paddleX).toBeLessThanOrEqual(limit + 1e-6);

    for (let i = 0; i < 80; i++) sim.moveBoard(-1);
    expect(sim.paddleTargetX).toBeCloseTo(-limit, 6);
    run(sim, 1.5);
    expect(sim.paddleX).toBeGreaterThanOrEqual(-limit - 1e-6);
  });

  it('ignores input once the run is over', () => {
    const store = playing();
    const paused = new ConeballSim(store, { seed: 3 });
    store.gameOver();
    paused.moveBoard(1);
    expect(paused.paddleTargetX).toBe(0);
  });

  it('clampPaddleX keeps the whole board inside the court', () => {
    expect(clampPaddleX(999)).toBeCloseTo(ARENA_HALF_X - PADDLE_HALF_WIDTH, 6);
    expect(clampPaddleX(-999)).toBeCloseTo(-(ARENA_HALF_X - PADDLE_HALF_WIDTH), 6);
    expect(clampPaddleX(0.5)).toBe(0.5);
  });
});

describe('ConeballSim — walls', () => {
  it('reflects off a side barrier: X flips, Z is untouched, speed is kept', () => {
    const sim = new ConeballSim(playing(), { seed: 5 });
    // Aimed at the right barrier, in the empty stretch below the drums, at a
    // heading already steeper than the court-progress floor so the bounce is a
    // pure mirror with nothing else acting on it.
    sim.placeBall({ x: 3.5, z: 0, vx: 6, vz: 3 });
    const speed = sim.ballSpeed;
    run(sim, 0.2);

    // A mirror about the barrier's normal, exactly: the lateral component
    // negates and the along-court component is left alone. Asserting the whole
    // law — rather than only "it turned around eventually" — is what catches a
    // solver that reflects the wrong vector.
    expect(sim.ball.vx).toBeCloseTo(-6, 6);
    expect(sim.ball.vz).toBeCloseTo(3, 6);
    expect(sim.ballSpeed).toBeCloseTo(speed, 6);
    expect(sim.ball.x).toBeLessThanOrEqual(ARENA_HALF_X - BALL_RADIUS + 1e-6);
    expect(sim.ball.x).toBeGreaterThanOrEqual(-(ARENA_HALF_X - BALL_RADIUS) - 1e-6);
  });

  it('reflects off the far gantry: Z flips, X is untouched, speed is kept', () => {
    const sim = new ConeballSim(playing(), { seed: 5 });
    // Clear the drums so the far wall is what it meets.
    for (const target of sim.targets) target.active = false;
    sim.placeBall({ x: 0, z: ARENA_FAR_Z + 3, vx: 1.5, vz: -8 });
    const speed = sim.ballSpeed;
    run(sim, 0.5);

    expect(sim.ball.vz).toBeCloseTo(8, 6);
    expect(sim.ball.vx).toBeCloseTo(1.5, 6);
    expect(sim.ballSpeed).toBeCloseTo(speed, 6);
    expect(sim.ball.z).toBeGreaterThanOrEqual(ARENA_FAR_Z + BALL_RADIUS - 1e-6);
  });

  it('never lets the ball skate flat between the barriers', () => {
    // A near-flat bounce would leave the ball crossing the court forever at one
    // depth — a rally the player can neither lose nor influence. The solver
    // tilts it back up to the floor angle at the SAME speed: a redirection,
    // never a boost.
    const sim = new ConeballSim(playing(), { seed: 5 });
    for (const target of sim.targets) target.active = false;
    sim.placeBall({ x: 3.5, z: 0, vx: 7, vz: 0.02 });
    const speed = sim.ballSpeed;
    run(sim, 0.2);

    expect(sim.ballSpeed).toBeCloseTo(speed, 6);
    // 0.3 of its speed is the documented floor (MIN_COURT_FRACTION).
    expect(Math.abs(sim.ball.vz)).toBeGreaterThanOrEqual(speed * 0.3 - 1e-6);
    // ...and it still turned around off the barrier.
    expect(sim.ball.vx).toBeLessThan(0);
  });

  it('travels in the direction it is actually pointed', () => {
    // The cheapest possible guard against a solver that mutates position where
    // it means velocity: after a bounce, the ball's next moves must follow its
    // reported velocity.
    const sim = new ConeballSim(playing(), { seed: 5 });
    for (const target of sim.targets) target.active = false;
    sim.placeBall({ x: 3.5, z: 0, vx: 6, vz: 3 });
    run(sim, 0.2);
    const { x, z, vx, vz } = sim.ball;
    run(sim, 0.1);
    expect(sim.ball.x).toBeCloseTo(x + vx * 0.1, 3);
    expect(sim.ball.z).toBeCloseTo(z + vz * 0.1, 3);
  });

  it('fires a wall event carrying the contact point', () => {
    const hits: Array<{ x: number; z: number }> = [];
    const events: ConeballEvents = { onWall: (x, z) => hits.push({ x, z }) };
    const sim = new ConeballSim(playing(), { seed: 5, events });
    sim.placeBall({ x: 3.5, z: 0, vx: 6, vz: 1 });
    run(sim, 0.4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].x).toBeCloseTo(ARENA_HALF_X - BALL_RADIUS, 2);
  });

  it('keeps the ball in bounds through a long chaotic rally', () => {
    const sim = new ConeballSim(playing(), { seed: 11 });
    sim.placeBall({ x: 0, z: 0, vx: 9, vz: -7 });
    for (let i = 0; i < 900; i++) {
      sim.update(1 / 60);
      // Track the ball perfectly, so the rally never ends and the solver is
      // exercised for thousands of contacts.
      sim.paddleTargetX = clampPaddleX(sim.ball.x);
      sim.paddleX = sim.paddleTargetX;
      expect(Math.abs(sim.ball.x)).toBeLessThanOrEqual(
        ARENA_HALF_X - BALL_RADIUS + 1e-3,
      );
      expect(sim.ball.z).toBeGreaterThanOrEqual(ARENA_FAR_Z - 1e-3);
      expect(sim.ballSpeed).toBeLessThanOrEqual(BALL_SPEED_MAX + 1e-6);
    }
  });
});

describe('ConeballSim — returns', () => {
  let store: GameStore;
  let sim: ConeballSim;

  beforeEach(() => {
    store = playing();
    sim = new ConeballSim(store, { seed: 13 });
    for (const target of sim.targets) target.active = false;
  });

  it('returns the ball back up the court and increments the rally', () => {
    sim.placeBall({ x: 0, z: PADDLE_Z - 2, vx: 0, vz: 6, paddleX: 0 });
    run(sim, 0.5);
    expect(sim.rally).toBe(1);
    expect(sim.ball.vz).toBeLessThan(0);
    expect(sim.ball.z).toBeLessThan(PADDLE_Z);
  });

  it('increments the rally exactly once per contact, not once per frame', () => {
    const returns: number[] = [];
    const local = new ConeballSim(store, {
      seed: 13,
      events: { onReturn: (_x, rally) => returns.push(rally) },
    });
    for (const target of local.targets) target.active = false;
    local.placeBall({ x: 0, z: PADDLE_Z - 1.5, vx: 0, vz: 6, paddleX: 0 });
    // Long enough for exactly one bounce off the board and a trip up the court.
    run(local, 0.9);
    expect(returns).toEqual([1]);
    expect(local.rally).toBe(1);
  });

  it('counts one rally per pass across many passes', () => {
    sim.placeBall({ x: 0, z: 0, vx: 0, vz: 7 });
    let bounces = 0;
    let previousVz = sim.ball.vz;
    for (let i = 0; i < 1200; i++) {
      sim.update(1 / 60);
      sim.paddleTargetX = clampPaddleX(sim.ball.x);
      sim.paddleX = sim.paddleTargetX;
      if (previousVz > 0 && sim.ball.vz < 0) bounces++;
      previousVz = sim.ball.vz;
    }
    expect(bounces).toBeGreaterThan(3);
    expect(sim.rally).toBe(bounces);
  });

  it('sends a centre contact straight back and an edge contact wide', () => {
    sim.placeBall({ x: 0, z: PADDLE_Z - 1.5, vx: 0, vz: 6, paddleX: 0 });
    run(sim, 0.5);
    const centreVx = Math.abs(sim.ball.vx);

    const edge = new ConeballSim(playing(), { seed: 13 });
    for (const target of edge.targets) target.active = false;
    // Contact near the board's right edge.
    edge.placeBall({
      x: PADDLE_HALF_WIDTH * 0.9,
      z: PADDLE_Z - 1.5,
      vx: 0,
      vz: 6,
      paddleX: 0,
    });
    run(edge, 0.5);
    expect(edge.rally).toBe(1);
    expect(edge.ball.vx).toBeGreaterThan(0); // thrown to the right
    expect(Math.abs(edge.ball.vx)).toBeGreaterThan(centreVx + 1);
  });

  it('pays a return and ramps the ball speed within the ceiling', () => {
    const before = store.getState().score;
    sim.placeBall({ x: 0, z: PADDLE_Z - 1.5, vx: 0, vz: 6, paddleX: 0 });
    run(sim, 0.5);
    expect(store.getState().score).toBe(before + RETURN_SCORE);
    expect(sim.ballSpeed).toBeCloseTo(ballSpeedFor(1, 0), 6);
    expect(sim.ballSpeed).toBeLessThanOrEqual(BALL_SPEED_MAX);
  });

  it('never exceeds the speed ceiling however long the rally runs', () => {
    expect(ballSpeedFor(0, 0)).toBeLessThan(BALL_SPEED_MAX);
    expect(ballSpeedFor(1_000, 1_000)).toBe(BALL_SPEED_MAX);
    const local = new ConeballSim(playing(), { seed: 4 });
    for (const target of local.targets) target.active = false;
    local.placeBall({ x: 0, z: 0, vx: 0, vz: 7 });
    for (let i = 0; i < 4_000; i++) {
      local.update(1 / 60);
      local.paddleTargetX = clampPaddleX(local.ball.x);
      local.paddleX = local.paddleTargetX;
      expect(local.ballSpeed).toBeLessThanOrEqual(BALL_SPEED_MAX + 1e-6);
    }
    expect(local.rally).toBeGreaterThan(20);
    expect(local.ballSpeed).toBeCloseTo(BALL_SPEED_MAX, 6);
  });

  it('does not credit a rally for a ball that has already gone past', () => {
    // Ball behind the board, travelling away. Sliding the board over it must
    // not resurrect the point.
    sim.placeBall({
      x: 0,
      z: PADDLE_Z + PADDLE_HALF_DEPTH + BALL_RADIUS + 0.05,
      vx: 0,
      vz: 4,
      paddleX: 0,
    });
    run(sim, 0.2);
    expect(sim.rally).toBe(0);
  });
});

describe('ConeballSim — no tunnelling', () => {
  it('returns a maximum-speed ball driven straight at the board', () => {
    const sim = new ConeballSim(playing(), { seed: 21 });
    for (const target of sim.targets) target.active = false;
    sim.placeBall({
      x: 0,
      z: PADDLE_Z - 6,
      vx: 0,
      vz: BALL_SPEED_MAX,
      paddleX: 0,
    });
    // Deliberately the shell's WORST allowed frame (0.1s): at max speed that is
    // 1.55 world units of travel against a board only 0.56 deep.
    for (let i = 0; i < 20; i++) sim.update(0.1);
    expect(sim.rally).toBeGreaterThanOrEqual(1);
    expect(sim.lives).toBe(START_LIVES);
  });

  it('returns a maximum-speed ball arriving at a steep angle', () => {
    const sim = new ConeballSim(playing(), { seed: 22 });
    for (const target of sim.targets) target.active = false;
    const vx = BALL_SPEED_MAX * 0.6;
    const vz = Math.sqrt(BALL_SPEED_MAX ** 2 - vx ** 2);
    sim.placeBall({ x: -2.4, z: PADDLE_Z - 4, vx, vz, paddleX: 0 });
    for (let i = 0; i < 12; i++) {
      sim.update(0.1);
      sim.paddleTargetX = clampPaddleX(sim.ball.x);
      sim.paddleX = sim.paddleTargetX;
    }
    expect(sim.rally).toBeGreaterThanOrEqual(1);
  });

  it('cannot be tunnelled through a drum at maximum speed', () => {
    const sim = new ConeballSim(playing(), { seed: 23 });
    const target = nearestRowTarget(sim, 2);
    // One 0.1s frame at max speed covers 1.55 units — more than enough to start
    // clear in front of this drum and finish clear behind it. A point-in-time
    // test would see the ball on neither side of it and score nothing.
    const reach = TARGET_HALF_DEPTH + BALL_RADIUS;
    sim.placeBall({
      x: target.x,
      z: target.z + BALL_SPEED_MAX * 0.1 - reach * 1.2,
      vx: 0,
      vz: -BALL_SPEED_MAX,
    });
    sim.update(0.1);
    expect(target.active).toBe(false);
    expect(sim.ball.vz).toBeGreaterThan(0);
  });

  it('cannot be tunnelled through a barrier at maximum speed', () => {
    const sim = new ConeballSim(playing(), { seed: 24 });
    for (const t of sim.targets) t.active = false;
    sim.placeBall({ x: 0, z: 0, vx: BALL_SPEED_MAX, vz: 0.1 });
    for (let i = 0; i < 30; i++) {
      sim.update(0.1);
      expect(Math.abs(sim.ball.x)).toBeLessThanOrEqual(
        ARENA_HALF_X - BALL_RADIUS + 1e-3,
      );
    }
  });

  it('advances identically at 120fps, 30fps and the shell\'s worst frame', () => {
    // One second of simulation, delivered three ways. A ball whose rally
    // depends on the browser's frame rate is a lottery, not a rally.
    const make = (): ConeballSim => {
      const sim = new ConeballSim(playing(), { seed: 31 });
      sim.placeBall({ x: 0.4, z: 0, vx: 5.5, vz: -6.5 });
      return sim;
    };
    const fast = make();
    const slow = make();
    const lumpy = make();
    for (let i = 0; i < 120; i++) fast.update(1 / 120);
    for (let i = 0; i < 30; i++) slow.update(1 / 30);
    for (let i = 0; i < 10; i++) lumpy.update(0.1);

    // It genuinely went somewhere and hit something, or this proves nothing.
    expect(fast.targetsRemaining).toBeLessThan(TARGET_COUNT);
    expect(slow.ball.x).toBeCloseTo(fast.ball.x, 9);
    expect(slow.ball.z).toBeCloseTo(fast.ball.z, 9);
    expect(lumpy.ball.x).toBeCloseTo(fast.ball.x, 9);
    expect(lumpy.ball.z).toBeCloseTo(fast.ball.z, 9);
    expect(lumpy.targetsRemaining).toBe(fast.targetsRemaining);
    expect(slow.targetsRemaining).toBe(fast.targetsRemaining);
  });
});

describe('ConeballSim — targets', () => {
  let store: GameStore;
  let sim: ConeballSim;

  beforeEach(() => {
    store = playing();
    sim = new ConeballSim(store, { seed: 41 });
  });

  it('stands up a full formation inside the court', () => {
    expect(sim.targets).toHaveLength(TARGET_COUNT);
    expect(sim.targetsRemaining).toBe(TARGET_COUNT);
    for (const target of sim.targets) {
      expect(Math.abs(target.x)).toBeLessThan(ARENA_HALF_X);
      expect(target.z).toBeGreaterThan(ARENA_FAR_Z);
      expect(target.z).toBeLessThan(PADDLE_Z);
    }
    // Every drum has its own id, so the view can key meshes off them.
    expect(new Set(targetFormation().map((t) => t.id)).size).toBe(TARGET_COUNT);
  });

  it('scores a drum once and despawns it', () => {
    const smashed: number[] = [];
    const local = new ConeballSim(store, {
      seed: 41,
      events: { onTarget: (target) => smashed.push(target.id) },
    });
    const target = nearestRowTarget(local, 1);
    const before = store.getState().score;
    local.placeBall({ x: target.x, z: target.z + 2, vx: 0, vz: -7 });
    run(local, 0.4);

    expect(smashed.filter((id) => id === target.id)).toHaveLength(1);
    expect(target.active).toBe(false);
    expect(store.getState().score).toBeGreaterThanOrEqual(
      before + targetScore(0),
    );
    expect(local.targetsRemaining).toBeLessThan(TARGET_COUNT);
  });

  it('bounces off a drum rather than passing through it', () => {
    const target = nearestRowTarget(sim, 1);
    sim.placeBall({ x: target.x, z: target.z + 2, vx: 0, vz: -7 });
    const speed = sim.ballSpeed;
    run(sim, 0.35);
    expect(target.active).toBe(false);
    // Mirrored off the drum's near face: the along-court component negates, at
    // the same speed. A drum is a rebound surface, not a hole in the world.
    expect(sim.ball.vz).toBeCloseTo(7, 6);
    expect(sim.ballSpeed).toBeCloseTo(speed, 6);
    // ...and it is genuinely retreating back down the court toward the board.
    const z = sim.ball.z;
    run(sim, 0.1);
    expect(sim.ball.z).toBeGreaterThan(z);
  });

  it('pays more for a drum smashed deep into a rally', () => {
    expect(targetScore(5)).toBeGreaterThan(targetScore(0));
    // ...but the bonus is capped, so attrition never beats skill.
    expect(targetScore(10_000)).toBe(targetScore(12));
  });

  it('stands a fresh wall up and pays the clear bonus when the last drum goes', () => {
    const waves: number[] = [];
    const local = new ConeballSim(store, {
      seed: 41,
      events: { onWaveClear: (wave) => waves.push(wave) },
    });
    for (const target of local.targets) target.active = false;
    const last = local.targets[4];
    last.active = true;
    const before = store.getState().score;

    local.placeBall({ x: last.x, z: last.z + 2, vx: 0, vz: -7 });
    run(local, 0.6);

    expect(waves).toEqual([2]);
    expect(local.wave).toBe(2);
    expect(local.targetsRemaining).toBe(TARGET_COUNT);
    expect(store.getState().score).toBeGreaterThanOrEqual(
      before + targetScore(0) + WAVE_CLEAR_SCORE,
    );
  });

  it('does not let a fresh wall chain-smash around the ball that cleared it', () => {
    const local = new ConeballSim(store, { seed: 41 });
    for (const target of local.targets) target.active = false;
    const last = local.targets[7]; // middle row, middle column
    last.active = true;
    local.placeBall({ x: last.x, z: last.z + 2, vx: 0, vz: -7 });
    run(local, 0.6);
    // The new wall arrived intact: the ball leaving the drop zone did not take
    // a free column with it.
    expect(local.targetsRemaining).toBe(TARGET_COUNT);
  });
});

describe('ConeballSim — misses, lives and gameover', () => {
  let store: GameStore;
  let sim: ConeballSim;

  beforeEach(() => {
    store = playing();
    sim = new ConeballSim(store, { seed: 51 });
    for (const target of sim.targets) target.active = false;
  });

  /** Set up a genuine miss: ball past the board, still travelling away. */
  function missOnce(): void {
    sim.placeBall({ x: 3.6, z: PADDLE_Z - 0.5, vx: 0, vz: 8, paddleX: -3 });
    run(sim, 1.2);
  }

  it('spends a life and returns to the serve state on a miss', () => {
    missOnce();
    expect(sim.lives).toBe(START_LIVES - 1);
    expect(sim.serveState).toBe('serving');
    expect(store.getState().status).toBe('playing');
  });

  it('resets the rally on a miss, because the rally is what was at stake', () => {
    sim.placeBall({ x: 0, z: PADDLE_Z - 1.5, vx: 0, vz: 6, paddleX: 0 });
    run(sim, 0.5);
    expect(sim.rally).toBe(1);
    missOnce();
    expect(sim.rally).toBe(0);
  });

  it('reports the miss with the lives that remain', () => {
    const remaining: number[] = [];
    const local = new ConeballSim(store, {
      seed: 51,
      events: { onMiss: (_x, lives) => remaining.push(lives) },
    });
    for (const target of local.targets) target.active = false;
    for (let life = 0; life < START_LIVES; life++) {
      local.placeBall({ x: 3.6, z: PADDLE_Z - 0.5, vx: 0, vz: 8, paddleX: -3 });
      run(local, 1.2);
    }
    expect(remaining).toEqual([2, 1, 0]);
  });

  it('ends the run when the last life is spent', () => {
    for (let life = 0; life < START_LIVES; life++) missOnce();
    expect(sim.lives).toBe(0);
    expect(store.getState().status).toBe('gameover');
  });

  it('freezes the world once the run is over', () => {
    for (let life = 0; life < START_LIVES; life++) missOnce();
    const frozen = { ...sim.ball };
    run(sim, 2);
    expect(sim.ball).toEqual(frozen);
    expect(sim.placeBall({ x: 0, z: 0, vx: 1, vz: 1 })).toBe(false);
  });

  it('only counts a miss once the ball is genuinely clear of the board', () => {
    // Parked just past the board but not yet past MISS_Z: still in play.
    sim.placeBall({ x: 0, z: PADDLE_Z + 0.6, vx: 0, vz: 0, paddleX: -3 });
    sim.update(FIXED_STEP);
    expect(sim.lives).toBe(START_LIVES);
    expect(MISS_Z).toBeGreaterThan(PADDLE_Z + PADDLE_HALF_DEPTH);
  });
});

describe('ConeballSim — reset', () => {
  it('restores the board, ball, serve state, lives, rally, score and formation', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 61 });

    // Rough the run up: move the board, smash a drum, lose a life, rally once.
    sim.moveBoard(1);
    sim.moveBoard(1);
    const target = sim.targets[3];
    sim.placeBall({ x: target.x, z: target.z + 2, vx: 0, vz: -7 });
    run(sim, 0.5);
    sim.placeBall({ x: 0, z: PADDLE_Z - 1.5, vx: 0, vz: 6, paddleX: 0 });
    run(sim, 0.5);
    sim.placeBall({ x: 3.6, z: PADDLE_Z - 0.5, vx: 0, vz: 8, paddleX: -3 });
    run(sim, 1.2);

    expect(sim.rally).toBe(0);
    expect(sim.lives).toBe(START_LIVES - 1);
    expect(sim.targetsRemaining).toBeLessThan(TARGET_COUNT);
    expect(sim.paddleX).not.toBe(0);

    // A restart is a fresh run: the store clears the score, the sim clears the
    // court.
    store.gameOver();
    store.start();
    sim.reset();

    expect(sim.paddleX).toBe(0);
    expect(sim.paddleTargetX).toBe(0);
    expect(sim.serveState).toBe('serving');
    expect(sim.lives).toBe(START_LIVES);
    expect(sim.rally).toBe(0);
    expect(sim.wave).toBe(1);
    expect(sim.targetsRemaining).toBe(TARGET_COUNT);
    expect(sim.ballSpeed).toBe(0);
    expect(sim.ball.z).toBeCloseTo(SERVE_Z, 6);
    expect(store.getState().score).toBe(0);
  });

  it('replays the same serve sequence after a reset', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 61 });
    sim.serve();
    const first = sim.ball.vx;
    sim.reset();
    sim.serve();
    expect(sim.ball.vx).toBe(first);
  });

  it('hands out a genuinely fresh formation, not the mutated one', () => {
    const sim = new ConeballSim(playing(), { seed: 61 });
    const before = sim.targets;
    before[0].active = false;
    sim.reset();
    expect(sim.targets).not.toBe(before);
    expect(sim.targets[0].active).toBe(true);
  });
});

describe('ConeballSim — snapshot', () => {
  it('reports the game, the rally metric and the live court', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 71 });
    const idle = sim.snapshot(store.getState().score);
    expect(idle.game).toBe('coneball');
    // The single metric slot: the rally is the value, and the lives ride in the
    // label as pips, so both are readable without a second instrument.
    expect(idle.metric).toEqual({ label: 'Rally  ●●●', value: 0 });
    expect(idle.serving).toBe(true);
    expect(idle.lives).toBe(START_LIVES);
    // Standing drums only while the ball is still in hand.
    expect(idle.entities).toBe(TARGET_COUNT);

    sim.serve();
    const live = sim.snapshot(store.getState().score);
    expect(live.serving).toBe(false);
    expect(live.entities).toBe(TARGET_COUNT + 1);
    expect(live.ballSpeed).toBeCloseTo(ballSpeedFor(0, 0), 6);
    expect(live.status).toBe('playing');
  });

  it('spends a pip in the metric label as lives are lost', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 71 });
    for (const target of sim.targets) target.active = false;
    sim.placeBall({ x: 3.6, z: PADDLE_Z - 0.5, vx: 0, vz: 8, paddleX: -3 });
    run(sim, 1.2);
    expect(sim.lives).toBe(START_LIVES - 1);
    expect(sim.snapshot(0).metric?.label).toBe('Rally  ●●○');
  });

  it('copies the ball rather than exposing the live object', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 71 });
    const snapshot = sim.snapshot(0);
    expect(snapshot.ball).not.toBe(sim.ball);
    expect(snapshot.ball).toEqual(sim.ball);
  });

  it('mirrors the store score', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 71 });
    for (const target of sim.targets) target.active = false;
    sim.placeBall({ x: 0, z: PADDLE_Z - 1.5, vx: 0, vz: 6, paddleX: 0 });
    run(sim, 0.5);
    expect(sim.snapshot(store.getState().score).score).toBe(
      store.getState().score,
    );
  });
});

describe('ConeballSim — the placement hook', () => {
  it('places the ball and the board, and goes live', () => {
    const sim = new ConeballSim(playing(), { seed: 81 });
    expect(sim.placeBall({ x: 1, z: 0, vx: 0, vz: 5, paddleX: 1 })).toBe(true);
    expect(sim.ball.x).toBeCloseTo(1, 6);
    expect(sim.paddleX).toBeCloseTo(1, 6);
    expect(sim.serveState).toBe('live');
  });

  it('clamps a placement into the court rather than trusting the caller', () => {
    const sim = new ConeballSim(playing(), { seed: 81 });
    sim.placeBall({ x: 99, z: -99, vx: 0, vz: 1, paddleX: 99 });
    expect(sim.ball.x).toBeCloseTo(ARENA_HALF_X - BALL_RADIUS, 6);
    expect(sim.ball.z).toBeCloseTo(ARENA_FAR_Z + BALL_RADIUS, 6);
    expect(sim.paddleX).toBeCloseTo(ARENA_HALF_X - PADDLE_HALF_WIDTH, 6);
  });

  it('refuses junk', () => {
    const sim = new ConeballSim(playing(), { seed: 81 });
    expect(sim.placeBall({ x: NaN, z: 0, vx: 0, vz: 1 })).toBe(false);
    expect(sim.placeBall({ x: 0, z: 0, vx: Infinity, vz: 1 })).toBe(false);
  });

  it('does not itself score, smash or end anything — the rules do', () => {
    const store = playing();
    const sim = new ConeballSim(store, { seed: 81 });
    const target = sim.targets[2];
    // Placed exactly on top of a drum's row but one column clear of any drum:
    // placement alone must change nothing.
    sim.placeBall({ x: target.x, z: target.z - 3, vx: 0, vz: 0 });
    expect(store.getState().score).toBe(0);
    expect(sim.targetsRemaining).toBe(TARGET_COUNT);
    expect(sim.rally).toBe(0);
    expect(sim.lives).toBe(START_LIVES);
  });
});

describe('arena geometry', () => {
  it('keeps the drums clear of both the board and the far wall', () => {
    for (const target of targetFormation()) {
      expect(target.z - TARGET_HALF_DEPTH).toBeGreaterThan(ARENA_FAR_Z);
      expect(target.z + TARGET_HALF_DEPTH).toBeLessThan(
        PADDLE_Z - PADDLE_HALF_DEPTH,
      );
    }
  });

  it('leaves the board able to reach the whole width of the drum wall', () => {
    const outer = Math.max(...targetFormation().map((t) => Math.abs(t.x)));
    expect(ARENA_HALF_X - PADDLE_HALF_WIDTH).toBeGreaterThan(0);
    // The board's centre can travel at least as far out as the outer column, so
    // no drum is permanently unreachable.
    expect(clampPaddleX(outer)).toBeCloseTo(outer, 6);
  });
});
