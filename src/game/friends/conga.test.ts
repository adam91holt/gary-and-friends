import { describe, expect, it } from 'vitest';
import {
  CONGA_MAX_SPACING,
  CONGA_MIN_SPACING,
  CONGA_TAIL_LENGTH,
  CongaLine,
  congaSpacing,
} from './conga.ts';

/** Drive a line forward at constant speed with the leader parked at `x`. */
function cruise(
  line: CongaLine,
  seconds: number,
  speed: number,
  x: number | ((t: number) => number),
  step = 1 / 60,
): void {
  for (let t = 0; t < seconds; t += step) {
    line.advance(step, speed * step, typeof x === 'function' ? x(t) : x);
  }
}

describe('congaSpacing', () => {
  it('uses the roomy spacing for a short line', () => {
    expect(congaSpacing(0)).toBe(CONGA_MAX_SPACING);
    expect(congaSpacing(1)).toBe(CONGA_MAX_SPACING);
  });

  it('compresses as the line grows so the tail stays in frame', () => {
    expect(congaSpacing(12)).toBeLessThan(CONGA_MAX_SPACING);
    expect(congaSpacing(20)).toBeLessThanOrEqual(congaSpacing(12));
  });

  it('never compresses below the width of a cone', () => {
    for (const n of [1, 5, 20, 100, 5000]) {
      expect(congaSpacing(n)).toBeGreaterThanOrEqual(CONGA_MIN_SPACING);
    }
  });

  it('holds the tail to its budget length while the gaps can still compress', () => {
    // The crossover is derived, not hardcoded, so retuning either constant
    // can't silently turn this into a test of nothing.
    const floorAt = Math.floor(CONGA_TAIL_LENGTH / CONGA_MIN_SPACING);
    expect(floorAt).toBeGreaterThan(1);
    for (let n = 1; n <= floorAt; n++) {
      expect(n * congaSpacing(n)).toBeLessThanOrEqual(CONGA_TAIL_LENGTH + 1e-9);
    }
    // Past the crossover the floor wins, because interpenetrating cones would
    // look worse than a tail that runs slightly long.
    expect(congaSpacing(floorAt + 20)).toBe(CONGA_MIN_SPACING);
    expect((floorAt + 20) * CONGA_MIN_SPACING).toBeGreaterThan(CONGA_TAIL_LENGTH);
  });
});

describe('CongaLine: joining', () => {
  it('starts empty', () => {
    const line = new CongaLine();
    expect(line.length).toBe(0);
    expect(line.members).toEqual([]);
  });

  it('grows by one per pickup and keeps join order', () => {
    const line = new CongaLine();
    line.join(0, 'Coneelia');
    line.join(3, 'Tiny');
    expect(line.length).toBe(2);
    expect(line.members.map((m) => m.name)).toEqual(['Coneelia', 'Tiny']);
  });

  it('places a new member behind Gary at its slot, not at the origin', () => {
    const line = new CongaLine();
    const first = line.join(0, 'Coneelia');
    const second = line.join(1, 'Bartholocone');
    expect(first.z).toBeGreaterThan(0);
    expect(second.z).toBeGreaterThan(first.z);
  });

  it('spawns a late joiner on the path the leader actually took', () => {
    const line = new CongaLine();
    // Gary drives a long way over on the left, then someone joins.
    cruise(line, 2, 24, -2.4);
    const joined = line.join(4, 'Big Dave');
    expect(joined.x).toBeCloseTo(-2.4, 3);
  });

  it('gives members distinct hop phases so the line does not pulse in unison', () => {
    const line = new CongaLine();
    const phases = [0, 1, 2, 3, 4].map((v) => line.join(v, `f${v}`).phase);
    expect(new Set(phases).size).toBe(phases.length);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe('CongaLine: follow behaviour', () => {
  it('settles each member at its spacing behind the one in front', () => {
    const line = new CongaLine();
    for (let i = 0; i < 4; i++) line.join(i, `f${i}`);
    cruise(line, 3, 24, 0);

    const spacing = line.spacing;
    const members = line.members;
    expect(members[0].z).toBeCloseTo(spacing, 2);
    for (let i = 1; i < members.length; i++) {
      expect(members[i].z - members[i - 1].z).toBeCloseTo(spacing, 2);
    }
  });

  it('converges on the leader X when he holds a lane', () => {
    const line = new CongaLine();
    for (let i = 0; i < 3; i++) line.join(i, `f${i}`);
    cruise(line, 4, 24, 2.4);
    for (const m of line.members) expect(m.x).toBeCloseTo(2.4, 2);
  });

  it('trails a lane change: the tail is still where Gary WAS', () => {
    const line = new CongaLine();
    for (let i = 0; i < 4; i++) line.join(i, `f${i}`);
    cruise(line, 3, 24, -2.4); // settle everyone on the left
    cruise(line, 0.1, 24, 2.4); // Gary snaps to the right lane

    const members = line.members;
    // The nearest friend has begun to follow; the furthest has barely moved.
    expect(members[0].x).toBeGreaterThan(members[members.length - 1].x);
    expect(members[members.length - 1].x).toBeLessThan(0);
  });

  it('propagates the swerve down the line as a wave, not a rigid rail', () => {
    const line = new CongaLine();
    for (let i = 0; i < 5; i++) line.join(i, `f${i}`);
    cruise(line, 3, 24, 0);
    cruise(line, 0.35, 24, 2.4);

    const xs = line.members.map((m) => m.x);
    // Monotonically less-committed the further back you look.
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-6);
    }
    // And it IS a wave: front and back are meaningfully different.
    expect(xs[0] - xs[xs.length - 1]).toBeGreaterThan(0.2);
  });

  it('eventually brings the whole line onto the new lane', () => {
    const line = new CongaLine();
    for (let i = 0; i < 5; i++) line.join(i, `f${i}`);
    cruise(line, 3, 24, 0);
    cruise(line, 4, 24, 2.4);
    for (const m of line.members) expect(m.x).toBeCloseTo(2.4, 1);
  });

  it('is timestep independent: 30fps and 120fps agree', () => {
    const slow = new CongaLine();
    const fast = new CongaLine();
    for (const line of [slow, fast]) for (let i = 0; i < 3; i++) line.join(i, `f${i}`);
    const path = (t: number): number => Math.sin(t * 2) * 2.4;
    cruise(slow, 4, 24, path, 1 / 30);
    cruise(fast, 4, 24, path, 1 / 120);
    for (let i = 0; i < 3; i++) {
      expect(slow.members[i].x).toBeCloseTo(fast.members[i].x, 1);
      expect(slow.members[i].z).toBeCloseTo(fast.members[i].z, 2);
    }
  });

  it('ages members so the renderer can pop new arrivals in', () => {
    const line = new CongaLine();
    const first = line.join(0, 'Coneelia');
    cruise(line, 1, 24, 0);
    const late = line.join(1, 'Bartholocone');
    expect(first.age).toBeGreaterThan(0.9);
    expect(late.age).toBe(0);
  });

  it('ignores non-positive timesteps rather than producing NaN', () => {
    const line = new CongaLine();
    line.join(0, 'Coneelia');
    line.advance(0, 10, 1);
    line.advance(-1, 10, 1);
    expect(Number.isFinite(line.members[0].x)).toBe(true);
    expect(Number.isFinite(line.members[0].z)).toBe(true);
  });

  it('stays finite over a very long run (the path history is pruned)', () => {
    const line = new CongaLine();
    for (let i = 0; i < 6; i++) line.join(i, `f${i}`);
    cruise(line, 200, 54, (t) => Math.sin(t) * 2.4);
    for (const m of line.members) {
      expect(Number.isFinite(m.x)).toBe(true);
      expect(Math.abs(m.x)).toBeLessThanOrEqual(2.5);
    }
  });
});

describe('CongaLine: reset', () => {
  it('clear() empties the line', () => {
    const line = new CongaLine();
    for (let i = 0; i < 5; i++) line.join(i, `f${i}`);
    cruise(line, 1, 24, 2.4);
    line.clear();
    expect(line.length).toBe(0);
    expect(line.members).toEqual([]);
  });

  it('clear() forgets the previous run path, so a rebuilt line starts fresh', () => {
    const line = new CongaLine();
    cruise(line, 2, 24, -2.4);
    line.clear();
    // A fresh run starts centre; the new joiner must not inherit the old lane.
    line.advance(1 / 60, 24 / 60, 0);
    expect(line.join(0, 'Coneelia').x).toBeCloseTo(0, 3);
  });

  it('reports tail length from the live line', () => {
    const line = new CongaLine();
    expect(line.tailLength).toBe(0);
    for (let i = 0; i < 4; i++) line.join(i, `f${i}`);
    expect(line.tailLength).toBeCloseTo(4 * line.spacing, 6);
  });
});
