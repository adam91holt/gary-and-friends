import { describe, expect, it } from 'vitest';
import { DEATH_DURATION, deathPose } from './death.ts';

describe('deathPose', () => {
  it('is at rest before impact', () => {
    const pose = deathPose(0);
    expect(pose.scaleX).toBe(1);
    expect(pose.scaleY).toBe(1);
    expect(pose.y).toBe(0);
    expect(pose.z).toBe(0);
    expect(pose.x).toBe(0);
    expect(pose.spin).toBe(0);
  });

  it('punts him clear of the vehicle that hit him', () => {
    // He must not come to rest inside the truck — that is where the punchline
    // would be invisible.
    expect(deathPose(DEATH_DURATION).z).toBeGreaterThan(2);
    // ...and the punt decelerates rather than travelling linearly: the first
    // quarter of the animation covers more ground than the last.
    const early = deathPose(DEATH_DURATION * 0.25).z;
    const late =
      deathPose(DEATH_DURATION).z - deathPose(DEATH_DURATION * 0.75).z;
    expect(early).toBeGreaterThan(late);
  });

  it('slides monotonically backward, never toward the traffic', () => {
    let previous = -1;
    for (let t = 0; t <= DEATH_DURATION; t += 0.01) {
      const { z } = deathPose(t);
      expect(z).toBeGreaterThanOrEqual(previous);
      previous = z;
    }
  });

  it('squashes flat on impact, then rebounds tall', () => {
    const squash = deathPose(0.08);
    expect(squash.scaleY).toBeLessThan(0.6);
    // Wider than tall — that is the whole gag.
    expect(squash.scaleX).toBeGreaterThan(1.2);

    const stretch = deathPose(0.29);
    expect(stretch.scaleY).toBeGreaterThan(1.25);
    expect(stretch.scaleX).toBeLessThan(0.95);
  });

  it('hops off the road and comes back down', () => {
    expect(deathPose(0.3).y).toBeGreaterThan(0.8);
    expect(deathPose(0.74).y).toBeLessThan(0.15);
    expect(deathPose(0.9).y).toBe(0);
  });

  it('preserves volume throughout, so he never just changes size', () => {
    for (let t = 0; t <= DEATH_DURATION; t += 0.01) {
      const { scaleX, scaleY, scaleZ } = deathPose(t);
      expect(scaleX * scaleY * scaleZ).toBeCloseTo(1, 5);
    }
  });

  it('never inverts or collapses a scale axis', () => {
    for (let t = 0; t <= DEATH_DURATION + 0.5; t += 0.005) {
      const pose = deathPose(t);
      expect(pose.scaleX).toBeGreaterThan(0.1);
      expect(pose.scaleY).toBeGreaterThan(0.1);
      expect(pose.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('spins monotonically and tips over', () => {
    let previous = -1;
    for (let t = 0; t <= DEATH_DURATION; t += 0.01) {
      const { spin } = deathPose(t);
      expect(spin).toBeGreaterThanOrEqual(previous);
      previous = spin;
    }
    // He ends on his back — past 45° is unambiguously "toppled", and stopping
    // short of 90° keeps his face tilted toward the camera rather than flat to
    // the sky. Both bounds are the gag, not incidental numbers.
    const { spin, tip } = deathPose(DEATH_DURATION);
    // Pin the punchline's composition: Gary settles facing the front-left wreck
    // camera, not yawed away into an anonymous orange silhouette.
    expect(spin).toBeCloseTo(Math.PI * 2 + 0.6, 6);
    expect(tip).toBeGreaterThan(Math.PI / 4);
    expect(tip).toBeLessThan(Math.PI / 2);
  });

  it('settles to a stable, finished pose and stays there', () => {
    const settled = deathPose(DEATH_DURATION);
    expect(settled.done).toBe(true);
    // The game-over composition retains the punchline instead of restoring an
    // ordinary full-height cone after the animation finishes.
    expect(settled.scaleY).toBeLessThan(0.65);
    expect(settled.scaleX).toBeGreaterThan(1.2);
    expect(deathPose(DEATH_DURATION + 10)).toEqual(settled);
  });

  it('is continuous across the beat boundaries', () => {
    for (const boundary of [0.09, 0.3, 0.75]) {
      const before = deathPose(boundary - 0.001);
      const after = deathPose(boundary + 0.001);
      expect(Math.abs(after.scaleY - before.scaleY)).toBeLessThan(0.06);
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.06);
    }
  });
});
