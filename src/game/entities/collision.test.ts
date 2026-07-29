import { describe, expect, it } from 'vitest';
import {
  aabbOverlap,
  findHit,
  overlapsZ,
  sameLaneOverlap,
  sweptOverlapsZ,
  type Collider,
} from './collision.ts';
import type { Entity } from './entity.ts';
import { laneToX } from './lanes.ts';

function entity(partial: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    kind: 'traffic',
    lane: 1,
    z: 0,
    prevZ: 0,
    speed: 0,
    halfWidth: 0.6,
    halfDepth: 1.2,
    variant: 0,
    active: true,
    ...partial,
  };
}

function collider(partial: Partial<Collider> = {}): Collider {
  return {
    x: 0,
    z: 0,
    lane: 1,
    halfWidth: 0.42,
    halfDepth: 0.55,
    ...partial,
  };
}

describe('overlapsZ', () => {
  it('is true only while the intervals actually intersect', () => {
    expect(overlapsZ(0, 1, 0, 1)).toBe(true);
    expect(overlapsZ(0, 1, 1.9, 1)).toBe(true);
    expect(overlapsZ(0, 1, 2, 1)).toBe(false); // exactly touching = no hit
    expect(overlapsZ(0, 1, 50, 1)).toBe(false);
  });
});

describe('sweptOverlapsZ (anti-tunnelling)', () => {
  it('catches an entity that jumped clean over the collider in one step', () => {
    // 30 units of travel in one tick, past a box only 1.1 units deep.
    expect(sweptOverlapsZ(0, 0.55, -20, 10, 0.55)).toBe(true);
  });

  it('does not fire for a step that stayed entirely short of the collider', () => {
    expect(sweptOverlapsZ(0, 0.55, -60, -20, 0.55)).toBe(false);
  });

  it('does not fire for a step entirely past the collider', () => {
    expect(sweptOverlapsZ(0, 0.55, 5, 40, 0.55)).toBe(false);
  });

  it('degenerates to a point test when nothing moved', () => {
    expect(sweptOverlapsZ(0, 0.55, 0, 0, 0.55)).toBe(true);
    expect(sweptOverlapsZ(0, 0.55, 9, 9, 0.55)).toBe(false);
  });
});

describe('sameLaneOverlap', () => {
  it('requires the same lane', () => {
    expect(sameLaneOverlap(collider({ lane: 1 }), entity({ lane: 1 }))).toBe(true);
    expect(sameLaneOverlap(collider({ lane: 0 }), entity({ lane: 1 }))).toBe(false);
    expect(sameLaneOverlap(collider({ lane: 2 }), entity({ lane: 1 }))).toBe(false);
  });

  it('requires overlapping Z even in the same lane', () => {
    expect(
      sameLaneOverlap(collider(), entity({ z: -40, prevZ: -45 })),
    ).toBe(false);
  });
});

describe('aabbOverlap', () => {
  it('hits when boxes overlap in both X and Z', () => {
    const e = entity({ lane: 1 });
    expect(aabbOverlap(collider({ x: 0 }), e, laneToX(1))).toBe(true);
  });

  it('misses when the lateral gap is clear, however aligned in Z', () => {
    const e = entity({ lane: 0 });
    expect(aabbOverlap(collider({ x: laneToX(1) }), e, laneToX(0))).toBe(false);
  });

  it('hits mid-lane-change once Gary has drifted into the other lane', () => {
    const e = entity({ lane: 0 });
    // Gary lerping from lane 1 toward lane 0, now close enough to clip it.
    const nearlyThere = laneToX(0) + 0.9;
    expect(aabbOverlap(collider({ x: nearlyThere }), e, laneToX(0))).toBe(true);
    // Still safely mid-way across: no hit.
    const halfway = (laneToX(0) + laneToX(1)) / 2;
    expect(aabbOverlap(collider({ x: halfway }), e, laneToX(0))).toBe(false);
  });
});

describe('findHit', () => {
  it('ignores inactive entities and other kinds', () => {
    const entities = [
      entity({ id: 1, active: false }),
      entity({ id: 2, kind: 'friend' }),
    ];
    expect(findHit(entities, collider(), 'traffic', laneToX)).toBeNull();
  });

  it('returns the offending entity when one overlaps', () => {
    const entities = [
      entity({ id: 1, lane: 0, z: -30, prevZ: -32 }),
      entity({ id: 2, lane: 1, z: 0, prevZ: -1 }),
    ];
    expect(findHit(entities, collider({ lane: 1 }), 'traffic', laneToX)?.id).toBe(2);
  });

  it('finds a friend by kind with the very same predicate (ticket 03 path)', () => {
    const entities = [entity({ id: 9, kind: 'friend', lane: 1, z: 0 })];
    expect(findHit(entities, collider(), 'friend', laneToX)?.id).toBe(9);
    expect(findHit(entities, collider(), 'traffic', laneToX)).toBeNull();
  });
});
