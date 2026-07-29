import { describe, expect, it } from 'vitest';
import { LANE_COUNT } from '../state.ts';
import { createRng } from './rng.ts';
import {
  createTrafficField,
  pickSpawnLane,
  spawnTraffic,
  TRAFFIC_APPROACH,
  TRAFFIC_KIND,
  TRAFFIC_VARIANTS,
  trafficInterval,
} from './traffic.ts';

describe('trafficInterval', () => {
  it('shortens as speed rises, so density ramps with difficulty', () => {
    expect(trafficInterval(48)).toBeLessThan(trafficInterval(24));
    expect(trafficInterval(24)).toBeLessThan(trafficInterval(12));
  });

  it('stays positive and finite at any speed, including zero', () => {
    for (const speed of [0, 1, 24, 54, 1000]) {
      const interval = trafficInterval(speed);
      expect(Number.isFinite(interval)).toBe(true);
      expect(interval).toBeGreaterThan(0);
    }
  });
});

describe('pickSpawnLane', () => {
  const rng = createRng(7);

  it('always leaves at least one lane open (the fairness guarantee)', () => {
    // Two of three lanes blocked -> refuse, or the road would be walled off.
    expect(pickSpawnLane(rng, [0, 1])).toBeNull();
    expect(pickSpawnLane(rng, [0, 1, 2])).toBeNull();
  });

  it('picks only from unoccupied lanes', () => {
    for (let i = 0; i < 200; i++) {
      const lane = pickSpawnLane(rng, [1]);
      expect(lane === 0 || lane === 2).toBe(true);
    }
  });

  it('returns a valid lane index on an empty road', () => {
    for (let i = 0; i < 200; i++) {
      const lane = pickSpawnLane(rng, []);
      expect(lane).not.toBeNull();
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(LANE_COUNT);
    }
  });
});

describe('spawnTraffic', () => {
  it('produces a valid traffic spec matching its variant hitbox', () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i++) {
      const spec = spawnTraffic(rng, []);
      expect(spec).not.toBeNull();
      if (!spec) continue;
      expect(spec.kind).toBe(TRAFFIC_KIND);
      expect(spec.lane).toBeGreaterThanOrEqual(0);
      expect(spec.lane).toBeLessThan(LANE_COUNT);
      expect(spec.z).toBeLessThan(0); // always ahead of Gary
      const shape = TRAFFIC_VARIANTS[spec.variant];
      expect(shape).toBeDefined();
      expect(spec.halfWidth).toBe(shape.halfWidth);
      expect(spec.halfDepth).toBe(shape.halfDepth);
      // Uniform closing speed is the fairness invariant: nothing overtakes.
      expect(spec.speed).toBe(TRAFFIC_APPROACH);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 20; i++) {
      expect(spawnTraffic(a, [])).toEqual(spawnTraffic(b, []));
    }
  });

  it('differs across seeds (the jitter is real)', () => {
    const a = Array.from({ length: 20 }, () => spawnTraffic(createRng(1), []));
    const b = Array.from({ length: 20 }, () => spawnTraffic(createRng(2), []));
    expect(a).not.toEqual(b);
  });
});

describe('createTrafficField', () => {
  it('always leaves a drivable lane, however long the run gets', () => {
    const f = createTrafficField(11);
    let speed = 24;
    for (let i = 0; i < 4000; i++) {
      f.update(1 / 60, speed);
      speed = Math.min(54, speed + 0.01);

      // Look at everything currently within a reaction window ahead of Gary.
      const blocked = new Set<number>();
      for (const e of f.entities) {
        if (e.active && e.z > -40 && e.z < 4) blocked.add(e.lane);
      }
      expect(blocked.size).toBeLessThan(LANE_COUNT);
    }
  });

  it('is fully deterministic for a fixed seed', () => {
    const snapshot = (seed: number): string => {
      const f = createTrafficField(seed);
      for (let i = 0; i < 600; i++) f.update(1 / 60, 30);
      return JSON.stringify(
        f.entities
          .filter((e) => e.active)
          .map((e) => [e.lane, e.z.toFixed(4), e.variant]),
      );
    };
    expect(snapshot(99)).toBe(snapshot(99));
    expect(snapshot(99)).not.toBe(snapshot(100));
  });

  it('keeps traffic flowing without exhausting or overflowing the pool', () => {
    const f = createTrafficField(5);
    for (let i = 0; i < 1200; i++) f.update(1 / 60, 36);
    expect(f.activeCount).toBeGreaterThan(0);
    expect(f.activeCount).toBeLessThanOrEqual(f.entities.length);
  });
});
