import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';

/**
 * Procedural "Gary": an orange road cone with two white stripe bands.
 * Pure geometry construction — no scene, no animation, no global state — so it
 * stays on the rendering side of the seam without dragging in game logic.
 *
 * Returns a Group whose local +Y is up; the caller positions/rotates it.
 */
export function createGary(): Group {
  const gary = new Group();
  gary.name = 'Gary';

  const coneOrange = new MeshStandardMaterial({
    color: 0xff6a00,
    roughness: 0.6,
    metalness: 0.05,
  });
  const white = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.05,
  });

  const height = 1.6;
  const baseRadius = 0.6;
  const tipRadius = 0.06;

  // Main cone body (a tapered cylinder gives us a flat-ish tip to stack on).
  const body = new Mesh(
    new CylinderGeometry(tipRadius, baseRadius, height, 32, 1, true),
    coneOrange,
  );
  body.position.y = height / 2;
  gary.add(body);

  // Two white stripe bands wrapped around the cone. Radius is interpolated to
  // match the cone taper at each band's height so they sit flush.
  const radiusAt = (y: number): number =>
    baseRadius + (tipRadius - baseRadius) * (y / height);

  for (const bandCenter of [0.5, 0.95]) {
    const bandHeight = 0.18;
    const r = radiusAt(bandCenter) + 0.005;
    const band = new Mesh(
      new CylinderGeometry(r, r, bandHeight, 32, 1, true),
      white,
    );
    band.position.y = bandCenter;
    gary.add(band);
  }

  // Square base slab.
  const base = new Mesh(
    new CylinderGeometry(baseRadius * 1.15, baseRadius * 1.15, 0.12, 32),
    coneOrange,
  );
  base.position.y = 0.06;
  gary.add(base);

  return gary;
}
