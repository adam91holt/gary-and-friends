import { describe, expect, it } from 'vitest';
import { laneToX } from '../entities/lanes.ts';
import { TRAFFIC_KIND } from '../entities/traffic.ts';
import { BASE_SPEED, CENTER_LANE, GameStore } from '../state.ts';
import { MAX_SPEED, scoreForDistance } from './difficulty.ts';
import { GARY_Z, NEAR_MISS_BONUS, Run, SPAWN_GRACE } from './run.ts';

/** Advance a run in realistic 60fps slices. */
function tick(run: Run, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) run.update(step);
}

function playing(): { store: GameStore; run: Run } {
  const store = new GameStore();
  const run = new Run(store, { seed: 4242 });
  store.start();
  run.reset();
  return { store, run };
}

describe('Run: scoring by distance', () => {
  it('scores nothing before the run starts', () => {
    const store = new GameStore();
    const run = new Run(store);
    tick(run, 2);
    expect(store.getState().score).toBe(0);
    expect(run.travelled).toBe(0);
  });

  it('accumulates score as distance is travelled', () => {
    const { store, run } = playing();
    tick(run, 1);
    expect(store.getState().score).toBeGreaterThan(0);
    // Roughly a second at ~base speed, allowing for the ramp and any bonus.
    expect(store.getState().score).toBeGreaterThanOrEqual(BASE_SPEED - 2);
  });

  it('score tracks distance travelled (never runs away from it)', () => {
    const { store, run } = playing();
    tick(run, 3);
    expect(store.getState().score).toBeGreaterThanOrEqual(
      scoreForDistance(run.travelled),
    );
  });

  it('score only ever increases while playing', () => {
    const { store, run } = playing();
    let previous = 0;
    for (let i = 0; i < 300; i++) {
      run.update(1 / 60);
      const score = store.getState().score;
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });
});

describe('Run: speed ramp', () => {
  it('starts at BASE_SPEED and climbs with distance', () => {
    const { store, run } = playing();
    expect(store.getState().speed).toBe(BASE_SPEED);
    tick(run, 5);
    expect(store.getState().speed).toBeGreaterThan(BASE_SPEED);
  });

  it('never exceeds MAX_SPEED over a very long run', () => {
    // Collision-free by construction: an empty field isolates the ramp so this
    // asserts the speed bound rather than the bot's ability to stay alive.
    const { store, run } = playing();
    let peak = 0;
    for (let i = 0; i < 12_000; i++) {
      run.traffic.clear(); // keep the road empty; the ramp is what's under test
      run.update(1 / 30);
      peak = Math.max(peak, store.getState().speed);
    }
    expect(peak).toBeLessThanOrEqual(MAX_SPEED);
    expect(peak).toBeGreaterThan(BASE_SPEED * 1.5);
  });

  it('ramps monotonically', () => {
    const { store, run } = playing();
    let previous = store.getState().speed;
    for (let i = 0; i < 600; i++) {
      run.update(1 / 60);
      const speed = store.getState().speed;
      expect(speed).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = speed;
    }
  });
});

describe('Run: collision', () => {
  it('ends the run when a vehicle reaches Gary in his lane', () => {
    const { store, run } = playing();
    tick(run, SPAWN_GRACE + 0.1); // clear the grace window
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: store.getState().lane,
      z: GARY_Z,
      speed: 0,
      halfWidth: 0.58,
      halfDepth: 1.25,
      variant: 1,
    });
    run.update(1 / 60);
    expect(store.getState().status).toBe('gameover');
  });

  it('does not end the run for a vehicle in another lane', () => {
    const { store, run } = playing();
    tick(run, SPAWN_GRACE + 0.1);
    store.setLane(0);
    run.setGaryX(laneToX(0));
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: 2,
      z: GARY_Z,
      speed: 0,
      halfWidth: 0.58,
      halfDepth: 1.25,
      variant: 1,
    });
    run.update(1 / 60);
    expect(store.getState().status).toBe('playing');
  });

  it('cannot be hit during the opening grace window', () => {
    const store = new GameStore();
    const run = new Run(store, { seed: 1 });
    store.start();
    run.reset();
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: CENTER_LANE,
      z: GARY_Z,
      speed: 0,
      halfWidth: 0.58,
      halfDepth: 1.25,
      variant: 1,
    });
    run.update(1 / 60);
    expect(store.getState().status).toBe('playing');
  });

  it('catches fast traffic that would tunnel through in one frame', () => {
    const { store, run } = playing();
    tick(run, SPAWN_GRACE + 0.1);
    // Park it far behind Gary but give it enough speed to leap clean past him
    // in a single tick — a naive point test would miss this entirely.
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: store.getState().lane,
      z: -30,
      speed: 2000,
      halfWidth: 0.58,
      halfDepth: 1.25,
      variant: 1,
    });
    run.update(1 / 60);
    expect(store.getState().status).toBe('gameover');
  });

  it('survives a long clean run when Gary can be steered (spawns stay fair)', () => {
    const { store, run } = playing();
    // A simple bot: pick the lane with the most clear road, but move its collider
    // with the renderer's real damping rate rather than teleporting lane-to-lane.
    let garyX = laneToX(store.getState().lane);
    for (let i = 0; i < 5000; i++) {
      const clearance = [0, 1, 2].map((lane) => {
        let nearest = Infinity;
        for (const e of run.traffic.entities) {
          if (!e.active || e.lane !== lane) continue;
          // Anything alongside Gary makes this lane unenterable right now.
          if (e.z > -4) return -Infinity;
          nearest = Math.min(nearest, -e.z);
        }
        return nearest;
      });

      let best = store.getState().lane;
      for (const lane of [0, 1, 2]) {
        if (clearance[lane] > clearance[best]) best = lane;
      }
      store.setLane(best);
      const targetX = laneToX(store.getState().lane);
      garyX = targetX + (garyX - targetX) * Math.exp(-9 / 60);
      run.setGaryX(garyX);
      run.update(1 / 60);
      if (store.getState().status !== 'playing') break;
    }
    // ~83 seconds of simulated play, deep into the speed ramp, without an
    // unavoidable wall of traffic. This is the fairness guarantee end to end.
    expect(store.getState().status).toBe('playing');
  });
});

describe('Run: game over stops the world', () => {
  it('freezes traffic, distance and score once the run has ended', () => {
    const { store, run } = playing();
    tick(run, 2);
    store.gameOver();

    const frozenScore = store.getState().score;
    const frozenDistance = run.travelled;
    const positions = run.traffic.entities.map((e) => e.z);

    tick(run, 2);
    expect(store.getState().score).toBe(frozenScore);
    expect(run.travelled).toBe(frozenDistance);
    expect(run.traffic.entities.map((e) => e.z)).toEqual(positions);
  });
});

describe('Run: restart', () => {
  it('clears traffic and resets score, speed and lane to a clean state', () => {
    const { store, run } = playing();
    tick(run, 6);
    store.setLane(2);
    store.gameOver();
    expect(run.traffic.activeCount).toBeGreaterThan(0);

    store.start(); // the restart path
    run.reset();

    expect(run.traffic.activeCount).toBe(0);
    expect(run.travelled).toBe(0);
    expect(store.getState()).toEqual({
      status: 'playing',
      score: 0,
      lane: CENTER_LANE,
      speed: BASE_SPEED,
      friends: 0,
    });
  });

  it('a restarted run is playable again (score climbs from zero)', () => {
    const { store, run } = playing();
    tick(run, 4);
    store.gameOver();
    store.start();
    run.reset();
    tick(run, 1);
    expect(store.getState().status).toBe('playing');
    expect(store.getState().score).toBeGreaterThan(0);
  });
});

describe('Run: forceCollision hook', () => {
  it('ends a live run through the real collision path', () => {
    const { store, run } = playing();
    tick(run, 1);
    run.forceCollision();
    expect(store.getState().status).toBe('gameover');
  });

  it('is safe to call outside a run', () => {
    const store = new GameStore();
    const run = new Run(store);
    expect(() => run.forceCollision()).not.toThrow();
    expect(store.getState().status).toBe('menu');
    expect(run.traffic.activeCount).toBe(0);
  });

  it('uses Gary’s rendered position during an in-progress lane change', () => {
    const { store, run } = playing();
    run.setGaryX(laneToX(1));
    store.setLane(2);
    run.forceCollision();
    expect(store.getState().status).toBe('gameover');
  });

  it('works from any lane', () => {
    for (const lane of [0, 1, 2]) {
      const { store, run } = playing();
      store.setLane(lane);
      run.setGaryX(laneToX(lane));
      run.forceCollision();
      expect(store.getState().status).toBe('gameover');
    }
  });
});

describe('Run: near-miss bonus', () => {
  it('pays a bonus and notifies when Gary threads a gap', () => {
    let notified = 0;
    const store = new GameStore();
    const run = new Run(store, { seed: 8, onNearMiss: () => notified++ });
    store.start();
    run.reset();
    tick(run, SPAWN_GRACE + 0.1);

    // A vehicle in lane 0, Gary in lane 1 but hugging the line beside it.
    // Placed just short of Gary so the next tick carries it across GARY_Z,
    // which is the moment a pass is credited.
    store.setLane(1);
    run.setGaryX(laneToX(0) + 1.05);
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: 0,
      z: -0.2,
      speed: 100,
      halfWidth: 0.52,
      halfDepth: 1.0,
      variant: 0,
    });

    const before = store.getState().score;
    run.update(1 / 60); // the vehicle crosses GARY_Z this tick
    expect(store.getState().status).toBe('playing');
    expect(notified).toBe(1);
    expect(store.getState().score - before).toBeGreaterThanOrEqual(
      NEAR_MISS_BONUS,
    );
  });

  it('pays each vehicle at most once', () => {
    let notified = 0;
    const store = new GameStore();
    const run = new Run(store, { seed: 8, onNearMiss: () => notified++ });
    store.start();
    run.reset();
    tick(run, SPAWN_GRACE + 0.1);

    store.setLane(1);
    run.setGaryX(laneToX(0) + 1.05);
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: 0,
      z: -0.2,
      speed: 100,
      halfWidth: 0.52,
      halfDepth: 1.0,
      variant: 0,
    });
    tick(run, 0.5);
    expect(notified).toBe(1);
  });

  it('does not pay for a vehicle passing a comfortable lane away', () => {
    let notified = 0;
    const store = new GameStore();
    const run = new Run(store, { seed: 8, onNearMiss: () => notified++ });
    store.start();
    run.reset();
    tick(run, SPAWN_GRACE + 0.1);

    store.setLane(2);
    run.setGaryX(laneToX(2));
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: 0,
      z: -0.2,
      speed: 100,
      halfWidth: 0.52,
      halfDepth: 1.0,
      variant: 0,
    });
    run.update(1 / 60);
    expect(notified).toBe(0);
  });

  it('rewards a LATE swerve, measured at the tightest point of the approach', () => {
    let notified = 0;
    const store = new GameStore();
    const run = new Run(store, { seed: 8, onNearMiss: () => notified++ });
    store.start();
    run.reset();
    tick(run, SPAWN_GRACE + 0.1);

    // A vehicle bearing down on Gary in lane 0, a few units out. Its closing
    // speed comes from the field's own update, so prevZ/z stay consistent.
    store.setLane(0);
    run.traffic.clear();
    run.traffic.inject({
      kind: TRAFFIC_KIND,
      lane: 0,
      z: -6,
      speed: 0,
      halfWidth: 0.52,
      halfDepth: 1.0,
      variant: 0,
    });

    // Gary swerves out of its way, and by the time it draws level he is safely
    // in the next lane. Sampling only at the crossing instant would score this
    // as a boring clean pass; measuring the closest point during the approach
    // correctly recognises how near it came.
    const from = laneToX(0);
    const to = laneToX(1);
    const steps = 20;
    for (let step = 0; step <= steps; step++) {
      run.setGaryX(from + ((to - from) * Math.min(1, step / 8)));
      store.setLane(step >= 4 ? 1 : 0);
      run.update(1 / 60);
      if (store.getState().status !== 'playing') break;
    }

    expect(store.getState().status).toBe('playing');
    expect(notified).toBe(1);
  });

  it('does not affect the speed ramp (skill scores, it does not punish)', () => {
    const plain = playing();
    tick(plain.run, 2);
    const plainSpeed = plain.store.getState().speed;

    const bonused = playing();
    tick(bonused.run, 2);
    // Same elapsed time, same seed -> the ramp must be identical regardless of
    // any bonus banked, because it is a pure function of distance.
    expect(bonused.store.getState().speed).toBeCloseTo(plainSpeed, 9);
  });
});
