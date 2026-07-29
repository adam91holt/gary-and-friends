import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { ACCENT } from '../theme.ts';

/**
 * What `createGary()` hands back: the outer group the caller positions and
 * rotates, plus the inner `body` group that carries the squash-and-stretch
 * scale.
 *
 * They are deliberately separate objects. Scaling the outer group would also
 * scale his world position offset and fight the lane damping; the body group's
 * origin sits on the road, so scaling it squashes him *against the tarmac* —
 * which is the only place a squash reads correctly.
 */
export interface Gary {
  /** Positioned/rotated by the renderer. Never scaled. */
  readonly root: Group;
  /** Scaled by the death animation. Origin at road level. */
  readonly body: Group;
}

/**
 * Procedural "Gary": an orange road cone with two white stripe bands and a pair
 * of googly eyes so he reads as a lovable character rather than a traffic prop.
 * Pure geometry construction — no scene, no animation, no global state — so it
 * stays on the rendering side of the seam without dragging in game logic.
 *
 * Gary travels forward down -Z; the chase camera sits behind him at +Z, so his
 * eyes face +Z (back toward the camera) — we ride along watching his face.
 *
 * Returns the root Group (local +Y is up) plus the scalable body group.
 */
export function createGary(): Gary {
  const root = new Group();
  root.name = 'Gary';
  const gary = new Group();
  gary.name = 'GaryBody';
  root.add(gary);

  const coneOrange = new MeshStandardMaterial({
    color: ACCENT,
    roughness: 0.55,
    metalness: 0.05,
  });
  const white = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.05,
  });
  const eyeWhite = new MeshStandardMaterial({
    color: 0xfdfdfd,
    roughness: 0.3,
    metalness: 0.0,
  });
  const pupil = new MeshStandardMaterial({
    color: 0x14141f,
    roughness: 0.35,
    metalness: 0.0,
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

  // Square-ish base slab.
  const base = new Mesh(
    new CylinderGeometry(baseRadius * 1.15, baseRadius * 1.15, 0.12, 32),
    coneOrange,
  );
  base.position.y = 0.06;
  gary.add(base);

  // Googly eyes — the whole point of the character pass. Two white spheres with
  // dark pupils, sitting proud of the cone surface on the +Z (camera) side.
  const eyeY = 1.02;
  const eyeSurface = radiusAt(eyeY);
  const eyes = new Group();
  eyes.name = 'GaryEyes';
  for (const side of [-1, 1]) {
    const eye = new Group();
    eye.position.set(side * 0.15, eyeY, eyeSurface + 0.02);

    const sclera = new Mesh(new SphereGeometry(0.12, 20, 20), eyeWhite);
    eye.add(sclera);

    const iris = new Mesh(new SphereGeometry(0.06, 16, 16), pupil);
    iris.position.z = 0.08; // pupil bulges toward the camera
    eye.add(iris);

    eyes.add(eye);
  }
  gary.add(eyes);

  return { root, body: gary };
}
