import { describe, expect, it } from 'vitest';
import { BASE_SPEED } from '../state.ts';
import {
  intensityForSpeed,
  MAX_SPEED,
  RAMP_DISTANCE,
  scoreForDistance,
  speedForDistance,
} from './difficulty.ts';

describe('speedForDistance', () => {
  it('starts at BASE_SPEED and never goes below it', () => {
    expect(speedForDistance(0)).toBe(BASE_SPEED);
    expect(speedForDistance(-500)).toBe(BASE_SPEED);
  });

  it('increases monotonically with distance', () => {
    let previous = speedForDistance(0);
    for (let d = 50; d <= 6000; d += 50) {
      const next = speedForDistance(d);
      expect(next).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it('is bounded by MAX_SPEED however far the run goes', () => {
    expect(speedForDistance(1e6)).toBeLessThanOrEqual(MAX_SPEED);
    expect(speedForDistance(1e9)).toBeLessThanOrEqual(MAX_SPEED);
  });

  it('closes ~63% of the gap after one RAMP_DISTANCE', () => {
    const span = MAX_SPEED - BASE_SPEED;
    const at = speedForDistance(RAMP_DISTANCE);
    expect((at - BASE_SPEED) / span).toBeCloseTo(1 - Math.exp(-1), 5);
  });

  it('ramps meaningfully but not absurdly over an early run', () => {
    // ~10s of play at base speed: noticeably quicker, still under top speed.
    const early = speedForDistance(BASE_SPEED * 10);
    expect(early).toBeGreaterThan(BASE_SPEED);
    expect(early).toBeLessThan(MAX_SPEED);
  });
});

describe('scoreForDistance', () => {
  it('is zero at or before the start line', () => {
    expect(scoreForDistance(0)).toBe(0);
    expect(scoreForDistance(-10)).toBe(0);
  });

  it('is an integer that grows with distance', () => {
    expect(scoreForDistance(10.9)).toBe(10);
    expect(scoreForDistance(1000)).toBe(1000);
    expect(Number.isInteger(scoreForDistance(123.456))).toBe(true);
  });

  it('never decreases as distance grows', () => {
    let previous = 0;
    for (let d = 0; d < 3000; d += 7.3) {
      const next = scoreForDistance(d);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});

describe('intensityForSpeed', () => {
  it('maps BASE_SPEED..MAX_SPEED onto 0..1 and clamps outside it', () => {
    expect(intensityForSpeed(BASE_SPEED)).toBe(0);
    expect(intensityForSpeed(MAX_SPEED)).toBe(1);
    expect(intensityForSpeed(0)).toBe(0);
    expect(intensityForSpeed(MAX_SPEED * 10)).toBe(1);
    expect(intensityForSpeed((BASE_SPEED + MAX_SPEED) / 2)).toBeCloseTo(0.5, 6);
  });
});
