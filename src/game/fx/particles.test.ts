import { describe, expect, it } from 'vitest';
import { createRng } from '../entities/rng.ts';
import { Particles, type EmitOptions } from './particles.ts';

const CONFIG = { capacity: 16, gravity: -9, drag: 1.4, fade: 1.6 };

const BURST: EmitOptions = {
  x: 0,
  y: 0.2,
  z: 0,
  count: 6,
  speed: 2,
  speedJitter: 1,
  lift: 3,
  life: 0.5,
  lifeJitter: 0.2,
  color: [1, 0.5, 0.1],
  colorJitter: 0.3,
};

describe('Particles', () => {
  it('emits into the pool and reports how many spawned', () => {
    const system = new Particles(CONFIG);
    expect(system.emit(BURST, createRng(1))).toBe(6);
    expect(system.aliveCount).toBe(6);
  });

  it('clips a burst at capacity instead of stealing live particles', () => {
    const system = new Particles(CONFIG);
    const rng = createRng(2);
    system.emit({ ...BURST, count: 12 }, rng);
    expect(system.emit({ ...BURST, count: 12 }, rng)).toBe(4);
    expect(system.aliveCount).toBe(CONFIG.capacity);
  });

  it('retires particles once their life runs out', () => {
    const system = new Particles(CONFIG);
    system.emit({ ...BURST, life: 0.3, lifeJitter: 0 }, createRng(3));
    expect(system.aliveCount).toBe(6);

    for (let i = 0; i < 10; i++) system.update(1 / 60);
    expect(system.aliveCount).toBe(6); // 0.166s in, still going

    for (let i = 0; i < 20; i++) system.update(1 / 60);
    expect(system.aliveCount).toBe(0);
  });

  it('recycles freed slots, so a long run never grows the pool', () => {
    const system = new Particles(CONFIG);
    const rng = createRng(4);
    for (let burst = 0; burst < 20; burst++) {
      system.emit({ ...BURST, count: 4, life: 0.2, lifeJitter: 0 }, rng);
      for (let i = 0; i < 20; i++) system.update(1 / 60);
    }
    expect(system.aliveCount).toBe(0);
    expect(system.positions).toHaveLength(CONFIG.capacity * 3);
  });

  it('moves particles and pulls them down under gravity', () => {
    const system = new Particles(CONFIG);
    system.emit(
      { ...BURST, count: 1, speed: 0, speedJitter: 0, lift: 0, life: 1 },
      createRng(5),
    );
    const startY = system.positions[1];
    for (let i = 0; i < 12; i++) system.update(1 / 60);
    expect(system.positions[1]).toBeLessThan(startY);
  });

  it('fades toward black over a particle life', () => {
    const system = new Particles(CONFIG);
    system.emit(
      { ...BURST, count: 1, life: 0.5, lifeJitter: 0, colorJitter: 0 },
      createRng(6),
    );
    const initial = system.colors[0];
    expect(initial).toBeGreaterThan(0);

    for (let i = 0; i < 15; i++) system.update(1 / 60);
    const mid = system.colors[0];
    expect(mid).toBeLessThan(initial);
    expect(mid).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) system.update(1 / 60);
    expect(system.colors[0]).toBe(0);
  });

  it('applies drift, so road dust travels with the road', () => {
    const system = new Particles({ ...CONFIG, gravity: 0, drag: 0 });
    system.emit(
      { ...BURST, count: 1, speed: 0, speedJitter: 0, lift: 0, drift: 10, life: 1 },
      createRng(7),
    );
    system.update(0.1);
    expect(system.positions[2]).toBeCloseTo(1, 3);
  });

  it('clear() extinguishes everything, so a restart inherits no dust', () => {
    const system = new Particles(CONFIG);
    system.emit(BURST, createRng(8));
    system.update(1 / 60);
    system.clear();
    expect(system.aliveCount).toBe(0);
    expect(Array.from(system.colors).every((c) => c === 0)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = new Particles(CONFIG);
    const b = new Particles(CONFIG);
    a.emit(BURST, createRng(9));
    b.emit(BURST, createRng(9));
    a.update(0.1);
    b.update(0.1);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it('ignores non-positive timesteps', () => {
    const system = new Particles(CONFIG);
    system.emit(BURST, createRng(10));
    const before = Array.from(system.positions);
    system.update(0);
    system.update(-1);
    expect(Array.from(system.positions)).toEqual(before);
  });
});
