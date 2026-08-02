import { describe, expect, it } from 'vitest';
import { reflect, sweepCircleAabb, type Aabb } from './sweep.ts';

const BOX: Aabb = { x: 0, z: 0, halfWidth: 1, halfDepth: 0.5 };

describe('sweepCircleAabb', () => {
  it('reports no contact when the movement finishes clear of the box', () => {
    const hit = sweepCircleAabb({ x: -5, z: 0 }, { x: 1, z: 0 }, 0.3, BOX);
    expect(hit).toBeNull();
  });

  it('finds the face and the fraction of travel for a head-on approach', () => {
    // Radius 0.3 + halfDepth 0.5 => contact when the centre reaches z = -0.8.
    // Starting at z = -2 and moving +2 puts that at t = 0.6.
    const hit = sweepCircleAabb({ x: 0, z: -2 }, { x: 0, z: 2 }, 0.3, BOX);
    expect(hit).not.toBeNull();
    expect(hit?.t).toBeCloseTo(0.6, 6);
    expect(hit?.normal).toEqual({ x: 0, z: -1 });
  });

  it('finds the side face for a lateral approach', () => {
    const hit = sweepCircleAabb({ x: 4, z: 0 }, { x: -4, z: 0 }, 0.3, BOX);
    expect(hit).not.toBeNull();
    // Contact at x = 1.3, i.e. 2.7 of the 4 travelled.
    expect(hit?.t).toBeCloseTo(2.7 / 4, 6);
    expect(hit?.normal).toEqual({ x: 1, z: 0 });
  });

  it('does not fabricate a hit on the square shoulder of a rounded corner', () => {
    // A path straight past the box's right flank, 0.31 clear of the near-right
    // vertex (1, -0.5) — inside the EXPANDED box's corner region (|x| < 1.3,
    // and it crosses the z = -0.8 slab boundary) but outside the true rounded
    // corner. A slab-only test reports a hit here; the exact corner solve must
    // not.
    const hit = sweepCircleAabb({ x: 1.31, z: -1 }, { x: 0, z: 0.5 }, 0.3, BOX);
    expect(hit).toBeNull();
  });

  it('resolves a genuine corner contact with a diagonal normal', () => {
    // A 45° approach aimed just outside the near face, so first contact really
    // is the vertex rather than a face.
    const hit = sweepCircleAabb({ x: 2.5, z: -2 }, { x: -2, z: 2 }, 0.3, BOX);
    expect(hit).not.toBeNull();
    const normal = hit?.normal;
    expect(normal).toBeDefined();
    if (!normal) return;
    // Both components point away from the box's near-right vertex, and it is a
    // unit vector — a square-shoulder fallback would give (1,0) or (0,-1).
    expect(normal.x).toBeCloseTo(Math.SQRT1_2, 2);
    expect(normal.z).toBeCloseTo(-Math.SQRT1_2, 2);
    expect(Math.hypot(normal.x, normal.z)).toBeCloseTo(1, 6);
    // ...and the reported contact point really is one radius off the vertex.
    const t = hit?.t ?? 0;
    expect(Math.hypot(2.5 - 2 * t - 1, -2 + 2 * t + 0.5)).toBeCloseTo(0.3, 6);
  });

  it('cannot be tunnelled through by an arbitrarily long displacement', () => {
    // A single step that crosses the entire box and comes out the other side.
    const hit = sweepCircleAabb({ x: 0, z: -50 }, { x: 0, z: 100 }, 0.3, BOX);
    expect(hit).not.toBeNull();
    expect(hit?.normal).toEqual({ x: 0, z: -1 });
    // The reported contact really is on the surface, not at the far end.
    const contactZ = -50 + 100 * (hit?.t ?? 0);
    expect(contactZ).toBeCloseTo(-0.8, 6);
  });

  it('reports t=0 and a separating normal for a circle that starts overlapping', () => {
    const hit = sweepCircleAabb({ x: 0, z: 0.2 }, { x: 0, z: 1 }, 0.3, BOX);
    expect(hit?.t).toBe(0);
    // Shallowest axis out of a box that is wider than it is deep: +z.
    expect(hit?.normal).toEqual({ x: 0, z: 1 });
  });

  it('ignores a box that is behind the direction of travel', () => {
    const hit = sweepCircleAabb({ x: 0, z: 2 }, { x: 0, z: 5 }, 0.3, BOX);
    expect(hit).toBeNull();
  });

  it('ignores a stationary circle that is already clear', () => {
    expect(sweepCircleAabb({ x: 0, z: -2 }, { x: 0, z: 0 }, 0.3, BOX)).toBeNull();
  });
});

describe('reflect', () => {
  it('mirrors the component along the normal and preserves speed', () => {
    const bounced = reflect({ x: 1, z: 2 }, { x: 0, z: -1 });
    expect(bounced.x).toBeCloseTo(1, 10);
    expect(bounced.z).toBeCloseTo(-2, 10);
    expect(Math.hypot(bounced.x, bounced.z)).toBeCloseTo(Math.hypot(1, 2), 10);
  });

  it('mirrors about a diagonal normal', () => {
    const n = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
    const bounced = reflect({ x: -1, z: -1 }, n);
    expect(bounced.x).toBeCloseTo(1, 10);
    expect(bounced.z).toBeCloseTo(1, 10);
  });
});
