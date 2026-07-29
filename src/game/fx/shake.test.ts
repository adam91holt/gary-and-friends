import { describe, expect, it } from 'vitest';
import {
  addTrauma,
  CRASH_TRAUMA,
  decayTrauma,
  NEAR_MISS_TRAUMA,
  SHAKE_AMPLITUDE,
  shakeOffset,
  TRAUMA_DECAY,
} from './shake.ts';

describe('trauma', () => {
  it('accumulates and clamps at 1', () => {
    expect(addTrauma(0, NEAR_MISS_TRAUMA)).toBeCloseTo(NEAR_MISS_TRAUMA);
    expect(addTrauma(0.8, CRASH_TRAUMA)).toBe(1);
    expect(addTrauma(1, 1)).toBe(1);
  });

  it('never goes negative from junk input', () => {
    expect(addTrauma(-5, 0.2)).toBeCloseTo(0.2);
    expect(addTrauma(0.2, -5)).toBeCloseTo(0.2);
  });

  it('decays to exactly zero and stays there', () => {
    expect(decayTrauma(1, 1 / TRAUMA_DECAY)).toBe(0);
    expect(decayTrauma(0, 1)).toBe(0);
    expect(decayTrauma(0.1, 10)).toBe(0);
  });

  it('a crash shake outlives a near-miss shake', () => {
    const step = 1 / 60;
    const frames = (start: number): number => {
      let trauma = start;
      let n = 0;
      while (trauma > 0) {
        trauma = decayTrauma(trauma, step);
        n++;
      }
      return n;
    };
    expect(frames(CRASH_TRAUMA)).toBeGreaterThan(frames(NEAR_MISS_TRAUMA));
  });
});

describe('shakeOffset', () => {
  it('is exactly still with no trauma', () => {
    expect(shakeOffset(0, 12.5)).toEqual({ x: 0, y: 0, roll: 0 });
  });

  it('stays within the amplitude budget at full trauma', () => {
    for (let t = 0; t < 4; t += 0.013) {
      const offset = shakeOffset(1, t);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(SHAKE_AMPLITUDE + 1e-6);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(SHAKE_AMPLITUDE + 1e-6);
    }
  });

  it('is quadratic, so a small knock is much gentler than a big one', () => {
    // Same phase, half the trauma => a quarter of the offset.
    const big = shakeOffset(1, 3.3);
    const small = shakeOffset(0.5, 3.3);
    expect(Math.abs(small.x)).toBeCloseTo(Math.abs(big.x) / 4, 6);
  });

  it('actually moves — a shake that never displaces is not a shake', () => {
    let peak = 0;
    for (let t = 0; t < 1; t += 0.005) {
      peak = Math.max(peak, Math.abs(shakeOffset(1, t).x));
    }
    expect(peak).toBeGreaterThan(SHAKE_AMPLITUDE * 0.5);
  });

  it('is deterministic — the same time gives the same frame', () => {
    expect(shakeOffset(0.7, 2.25)).toEqual(shakeOffset(0.7, 2.25));
  });
});
