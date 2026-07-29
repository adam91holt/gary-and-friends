import { describe, expect, it } from 'vitest';
import type { EntitySpec } from './entity.ts';
import { EntityField } from './field.ts';
import { createRng } from './rng.ts';

const SPEC: EntitySpec = {
  kind: 'test',
  lane: 1,
  z: -100,
  speed: 0,
  halfWidth: 0.5,
  halfDepth: 1,
  variant: 0,
};

function field(overrides: Partial<ConstructorParameters<typeof EntityField>[0]> = {}) {
  return new EntityField({
    capacity: 4,
    rngFactory: () => createRng(1),
    interval: () => 1,
    spawn: () => ({ ...SPEC }),
    recycleZ: 10,
    spawnZ: -100,
    spawnGuardDepth: 5,
    ...overrides,
  });
}

describe('EntityField movement + recycling', () => {
  it('moves entities toward the player at world speed plus their own', () => {
    const f = field();
    const e = f.inject({ ...SPEC, z: -50, speed: 10 });
    expect(e).not.toBeNull();
    f.update(1, 20); // 20 (world) + 10 (own) = 30 units of closing
    expect(e?.z).toBe(-20);
    expect(e?.prevZ).toBe(-50);
  });

  it('recycles an entity once it passes recycleZ, freeing the slot', () => {
    // Cadence parked far out so this isolates movement/recycling from spawning.
    const f = field({ interval: () => 1e6 });
    const e = f.inject({ ...SPEC, z: 5, speed: 0 });
    expect(f.activeCount).toBe(1);
    f.update(1, 20);
    expect(e?.active).toBe(false);
    expect(f.activeCount).toBe(0);
  });

  it('never exceeds capacity', () => {
    const f = field({ capacity: 3 });
    for (let i = 0; i < 10; i++) f.inject({ ...SPEC });
    expect(f.activeCount).toBe(3);
    expect(f.inject({ ...SPEC })).toBeNull();
  });

  it('reuses a recycled slot rather than allocating', () => {
    const f = field({ capacity: 1, interval: () => 1e6 });
    const first = f.inject({ ...SPEC, z: 5 });
    f.update(1, 20); // recycles it
    const second = f.inject({ ...SPEC, z: -100 });
    expect(second).toBe(first); // same object, reused in place
    expect(second?.active).toBe(true);
    expect(second?.id).not.toBe(0);
  });

  it('is inert at zero speed and for non-positive dt', () => {
    const f = field();
    f.update(1, 0);
    expect(f.activeCount).toBe(0);
    f.update(0, 50);
    expect(f.activeCount).toBe(0);
    f.update(-1, 50);
    expect(f.activeCount).toBe(0);
  });
});

describe('EntityField spawn cadence', () => {
  it('spawns on the interval, not every tick', () => {
    const f = field({ interval: () => 1 });
    f.update(0.5, 10);
    expect(f.activeCount).toBe(0);
    f.update(0.6, 10); // total 1.1s -> one beat
    expect(f.activeCount).toBe(1);
  });

  it('scales cadence with speed: faster play spawns more per second', () => {
    const slow = field({ capacity: 40, interval: (s) => 20 / s });
    const fast = field({ capacity: 40, interval: (s) => 20 / s });
    for (let i = 0; i < 100; i++) slow.update(0.05, 10);
    for (let i = 0; i < 100; i++) fast.update(0.05, 40);
    expect(fast.activeCount).toBeGreaterThan(slow.activeCount);
  });

  it('catches up over a long frame instead of swallowing beats', () => {
    const f = field({ capacity: 10, interval: () => 0.5 });
    f.update(2.2, 10); // 4 beats' worth of time in one hitched frame
    expect(f.activeCount).toBe(4);
  });

  it('does not spin forever when the pool is exhausted', () => {
    const f = field({ capacity: 2, interval: () => 0.001 });
    f.update(5, 10); // would be thousands of beats
    expect(f.activeCount).toBe(2);
  });

  it('passes lanes occupied near the spawn line to the spawn rule', () => {
    const seen: number[][] = [];
    const f = field({
      spawn: (_rng, occupied) => {
        seen.push([...occupied]);
        return { ...SPEC, lane: 2 };
      },
    });
    f.inject({ ...SPEC, lane: 0, z: -100 }); // at the spawn line
    f.inject({ ...SPEC, lane: 1, z: 0 }); // far from it, must not count
    f.spawnNow();
    expect(seen[0]).toEqual([0]);
  });

  it('honours occupancy supplied by another field', () => {
    const seen: number[][] = [];
    const traffic = field();
    traffic.inject({ ...SPEC, lane: 1, z: -100 });
    const friends = field({
      spawn: (_rng, occupied) => {
        seen.push([...occupied]);
        return { ...SPEC, kind: 'friend', lane: 0 };
      },
    });

    friends.spawnNow(traffic.entities);
    expect(seen[0]).toEqual([1]);
  });

  it('honours a spawn rule that declines the beat', () => {
    const f = field({ spawn: () => null });
    expect(f.spawnNow()).toBeNull();
    expect(f.activeCount).toBe(0);
  });
});

describe('EntityField lifecycle', () => {
  it('clear() empties the field and resets the cadence timer', () => {
    const f = field({ interval: () => 1 });
    f.update(0.9, 10); // timer at 0.9, no spawn yet
    f.inject({ ...SPEC });
    expect(f.activeCount).toBe(1);

    f.clear();
    expect(f.activeCount).toBe(0);
    // Timer was reset, so a short tick must not immediately spawn.
    f.update(0.2, 10);
    expect(f.activeCount).toBe(0);
  });

  it('clear() replays the seeded random sequence', () => {
    const f = field({
      interval: (_speed, rng) => 0.5 + rng(),
      spawn: (rng) => ({ ...SPEC, lane: Math.floor(rng() * 3) }),
    });
    const snapshot = (): string => {
      for (let i = 0; i < 300; i++) f.update(1 / 60, 20);
      return JSON.stringify(
        f.entities.filter((e) => e.active).map((e) => [e.lane, e.z]),
      );
    };

    const first = snapshot();
    f.clear();
    expect(snapshot()).toBe(first);
  });

  it('despawn() retires a single entity', () => {
    const f = field();
    const a = f.inject({ ...SPEC });
    f.inject({ ...SPEC });
    expect(f.activeCount).toBe(2);
    if (a) f.despawn(a);
    expect(f.activeCount).toBe(1);
  });

  it('gives every spawn a distinct id', () => {
    const f = field({ capacity: 3 });
    const ids = [f.inject({ ...SPEC })?.id, f.inject({ ...SPEC })?.id, f.inject({ ...SPEC })?.id];
    expect(new Set(ids).size).toBe(3);
  });
});
