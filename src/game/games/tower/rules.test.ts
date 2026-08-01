import { describe, expect, it } from 'vitest';
import { FRIENDS } from '../../friends/roster.ts';
import {
  BASE_CARRIER_SPEED,
  CARRIER_SPEED_STEP,
  COMBO_STEP,
  LANDING_SCORE,
  MAX_CARRIER_SPEED,
  MAX_COMBO_STEPS,
  MIN_OVERLAP,
  PERFECT_BONUS,
  PERFECT_WINDOW,
  carrierSpeedForHeight,
  landingScore,
  pieceHeight,
  resolveLanding,
} from './rules.ts';

describe('the carriage speed ramp', () => {
  it('opens at the base speed', () => {
    expect(carrierSpeedForHeight(0)).toBe(BASE_CARRIER_SPEED);
  });

  it('climbs with every piece stacked', () => {
    let previous = carrierSpeedForHeight(0);
    for (let height = 1; height <= 12; height++) {
      const speed = carrierSpeedForHeight(height);
      expect(speed).toBeGreaterThan(previous);
      previous = speed;
    }
    expect(carrierSpeedForHeight(3)).toBeCloseTo(
      BASE_CARRIER_SPEED + 3 * CARRIER_SPEED_STEP,
      10,
    );
  });

  it('is bounded by the tested ceiling however tall the tower gets', () => {
    for (const height of [25, 40, 100, 5_000]) {
      expect(carrierSpeedForHeight(height)).toBe(MAX_CARRIER_SPEED);
    }
  });

  it('never runs backwards or NaN on junk input', () => {
    expect(carrierSpeedForHeight(-4)).toBe(BASE_CARRIER_SPEED);
  });
});

describe('resolving a landing', () => {
  it('accepts a dead-centre drop as perfect and keeps the full footprint', () => {
    const result = resolveLanding(0, 2, 0, 2);
    expect(result.landed).toBe(true);
    expect(result.perfect).toBe(true);
    expect(result.width).toBe(2);
    expect(result.x).toBe(0);
  });

  it('treats anything inside the perfect window as perfect, and snaps it', () => {
    const result = resolveLanding(0, 2, PERFECT_WINDOW * 0.9, 2);
    expect(result.perfect).toBe(true);
    // Snapped back to the block below, so a perfect run cannot drift off.
    expect(result.x).toBe(0);
    expect(result.width).toBe(2);
  });

  it('treats a drop just outside the window as scruffy, and trims it', () => {
    const offset = PERFECT_WINDOW + 0.05;
    const result = resolveLanding(0, 2, offset, 2);
    expect(result.perfect).toBe(false);
    expect(result.landed).toBe(true);
    // The overhang is genuinely gone: what remains is the intersection.
    expect(result.width).toBeCloseTo(2 - offset, 10);
    expect(result.x).toBeCloseTo(offset / 2, 10);
  });

  it('trims symmetrically whichever side the drop hangs over', () => {
    const left = resolveLanding(0, 2, -0.6, 2);
    const right = resolveLanding(0, 2, 0.6, 2);
    expect(left.width).toBeCloseTo(right.width, 10);
    expect(left.x).toBeCloseTo(-right.x, 10);
  });

  it('a piece can never grow wider than the block it landed on', () => {
    const result = resolveLanding(0, 1, 0.4, 3);
    expect(result.width).toBeLessThanOrEqual(1);
  });

  it('fails a drop with no overlap at all', () => {
    const result = resolveLanding(0, 2, 3.5, 2);
    expect(result.landed).toBe(false);
    expect(result.overlap).toBe(0);
  });

  it('fails a knife-edge landing under the minimum overlap', () => {
    // Overlap exactly half the minimum: geometrically touching, but not a
    // ledge anything could ever be landed on again.
    const result = resolveLanding(0, 2, 2 - MIN_OVERLAP / 2, 2);
    expect(result.landed).toBe(false);
  });

  it('accepts a landing just past the minimum overlap', () => {
    const result = resolveLanding(0, 2, 2 - MIN_OVERLAP * 3, 2);
    expect(result.landed).toBe(true);
    expect(result.perfect).toBe(false);
  });

  it('reports a signed offset so feedback knows which way it slipped', () => {
    expect(resolveLanding(0, 2, 0.5, 2).offset).toBeCloseTo(0.5, 10);
    expect(resolveLanding(0, 2, -0.5, 2).offset).toBeCloseTo(-0.5, 10);
  });
});

describe('scoring a landing', () => {
  it('pays nothing for a miss', () => {
    expect(landingScore(resolveLanding(0, 2, 9, 2), 0, 2)).toBe(0);
  });

  it('pays the landing plus the precision bonus for a centred drop', () => {
    const result = resolveLanding(0, 2, 0, 2);
    expect(landingScore(result, 1, 2)).toBe(LANDING_SCORE + PERFECT_BONUS);
  });

  it('pays more for each consecutive perfect landing', () => {
    const result = resolveLanding(0, 2, 0, 2);
    expect(landingScore(result, 2, 2)).toBe(
      LANDING_SCORE + PERFECT_BONUS + COMBO_STEP,
    );
    expect(landingScore(result, 3, 2)).toBe(
      LANDING_SCORE + PERFECT_BONUS + COMBO_STEP * 2,
    );
  });

  it('caps the combo bonus so a long run cannot run away with it', () => {
    const result = resolveLanding(0, 2, 0, 2);
    const capped = LANDING_SCORE + PERFECT_BONUS + COMBO_STEP * MAX_COMBO_STEPS;
    expect(landingScore(result, MAX_COMBO_STEPS + 1, 2)).toBe(capped);
    expect(landingScore(result, 500, 2)).toBe(capped);
  });

  it('pays a scruffy landing less than a perfect one, scaled by what stayed on', () => {
    const tidy = resolveLanding(0, 2, 0.3, 2);
    const messy = resolveLanding(0, 2, 1.4, 2);
    const tidyPoints = landingScore(tidy, 0, 2);
    const messyPoints = landingScore(messy, 0, 2);
    expect(tidyPoints).toBeGreaterThan(messyPoints);
    expect(tidyPoints).toBeLessThan(LANDING_SCORE + PERFECT_BONUS);
    expect(messyPoints).toBeGreaterThanOrEqual(LANDING_SCORE);
  });
});

describe('cast profiles drive the piece dimensions', () => {
  it('derives every height from the shared roster rather than a local table', () => {
    for (let variant = 0; variant < FRIENDS.length; variant++) {
      expect(pieceHeight(variant)).toBeCloseTo(
        FRIENDS[variant].height * 0.55,
        10,
      );
    }
  });

  it('keeps the roster silhouette contrast — Tiny is shorter than Big Dave', () => {
    expect(pieceHeight(3)).toBeLessThan(pieceHeight(4));
  });
});
