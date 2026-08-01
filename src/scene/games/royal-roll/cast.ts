/**
 * The cast on the lane: Gary as the roller, and the royal formation he is
 * bowling at.
 *
 * Rendering-side only. Both are built from the SAME procedural cone vocabulary
 * as `scene/gary.ts` and `scene/friends.ts` — tapered shell, white reflective
 * bands, googly eyes — parameterised by the shared roster so a cone can never
 * be drawn as a different character from the one the physics collided with.
 * Tints come from `theme.ts` (FRIEND_TINTS ↔ --friend-1..5), so this file
 * introduces no colour of its own.
 *
 * Sir Cones-a-lot is the King, and gets the one flourish nobody else has: a
 * gold crown, drawn here rather than in the roster because it is specific to
 * this game's staging.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { friendProfile } from '../../../game/friends/roster.ts';
import { ownStandard, sharedStandard } from '../../../render/materials.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/** Shared trim materials, so every cone on the lane is made of the same plastic. */
const white = sharedStandard({ color: 0xffffff, roughness: 0.5 });
const eyeWhite = sharedStandard({ color: 0xfdfdfd, roughness: 0.3 });
const pupil = sharedStandard({ color: 0x14141f, roughness: 0.35 });
const gold = sharedStandard({
  color: ACCENT_2,
  roughness: 0.28,
  metalness: 0.55,
  emissive: ACCENT_2,
  emissiveIntensity: 0.22,
});

/**
 * Build a cone in a roster character's shape, scaled to a target `height`.
 *
 * The roster's own proportions are preserved (Big Dave stays broad, Coneelia
 * stays slender) while the absolute height is normalised for the rack, because
 * a formation whose front rank is four times the height of its back rank is a
 * rack you cannot read from the launch line.
 */
function buildCone(variant: number, height: number, radius: number): Group {
  const profile = friendProfile(variant);
  const group = new Group();
  group.name = `RoyalCone-${profile.name}`;

  const tipRadius = radius * 0.12;
  const shell = ownStandard({ color: profile.tint, roughness: 0.5 });
  const body = new Mesh(
    new CylinderGeometry(tipRadius, radius, height, 22, 1, true),
    shell,
  );
  body.position.y = height / 2;
  group.add(body);

  const radiusAt = (y: number): number =>
    radius + (tipRadius - radius) * (y / height);

  for (const fraction of profile.bands) {
    const y = height * fraction;
    const r = radiusAt(y) + 0.004;
    const band = new Mesh(
      new CylinderGeometry(r, r, height * 0.1, 22, 1, true),
      white,
    );
    band.position.y = y;
    group.add(band);
  }

  const base = new Mesh(
    new CylinderGeometry(radius * 1.12, radius * 1.12, height * 0.07, 22),
    shell,
  );
  base.position.y = height * 0.035;
  group.add(base);

  // Googly eyes, facing the launch line — the rack is looking back at you,
  // which is the joke the whole game rests on.
  const eyeY = height * 0.62;
  const eyeR = Math.max(0.05, radius * 0.28);
  const surface = radiusAt(eyeY);
  for (const side of [-1, 1]) {
    const eye = new Group();
    eye.position.set(side * eyeR * 1.15, eyeY, surface + eyeR * 0.15);
    const sclera = new Mesh(new SphereGeometry(eyeR, 12, 12), eyeWhite);
    eye.add(sclera);
    const iris = new Mesh(new SphereGeometry(eyeR * 0.5, 10, 10), pupil);
    iris.position.z = eyeR * 0.68;
    eye.add(iris);
    group.add(eye);
  }

  return group;
}

/** A guard in the formation. */
export function createGuard(variant: number, radius: number): Group {
  return buildCone(variant, radius * 3.1, radius * 0.86);
}

/**
 * The King: taller, crowned, and lit from within so he is unmistakably the
 * prize at the back of the rack rather than one more cone.
 */
export function createKing(variant: number, radius: number): Group {
  const group = buildCone(variant, radius * 3.6, radius * 0.88);
  const height = radius * 3.6;

  // The crown: a gold band with points around it. Geometry, not a texture, so
  // it survives the result camera coming right in on it.
  const crown = new Group();
  const bandRadius = radius * 0.34;
  const band = new Mesh(
    new TorusGeometry(bandRadius, bandRadius * 0.22, 8, 18),
    gold,
  );
  band.rotation.x = Math.PI / 2;
  crown.add(band);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const point = new Mesh(
      new ConeGeometry(bandRadius * 0.24, bandRadius * 0.85, 8),
      gold,
    );
    point.position.set(
      Math.cos(angle) * bandRadius,
      bandRadius * 0.5,
      Math.sin(angle) * bandRadius,
    );
    crown.add(point);
  }
  crown.position.y = height + bandRadius * 0.25;
  crown.name = 'Crown';
  group.add(crown);
  return group;
}

/**
 * Gary as the roller: his cone laid on its side, so the silhouette announces
 * "this thing rolls" before it has moved a millimetre. The tip points down-lane
 * (the direction of travel) and the whole body is parented so the runtime can
 * spin it about the roll axis without disturbing its lane position.
 */
export interface Roller {
  /** Positioned by the runtime. Never rotated directly. */
  readonly root: Group;
  /** Spun about X by the runtime, at the rate the solver's speed implies. */
  readonly spin: Group;
}

export function createRoller(radius: number): Roller {
  const root = new Group();
  root.name = 'RoyalRoller';
  const spin = new Group();
  root.add(spin);

  const length = radius * 3.2;
  const orange = sharedStandard({ color: ACCENT, roughness: 0.45 });

  // Laid on its side: the cone's own axis becomes the lane axis, so the tip
  // leads and the base trails, exactly like a cone somebody has kicked over.
  const body = new Mesh(
    new CylinderGeometry(radius * 0.16, radius, length, 26, 1, true),
    orange,
  );
  body.rotation.x = -Math.PI / 2;
  spin.add(body);

  for (const fraction of [0.42, 0.72]) {
    const r = radius + (radius * 0.16 - radius) * fraction + 0.006;
    const band = new Mesh(
      new CylinderGeometry(r, r, length * 0.11, 26, 1, true),
      white,
    );
    band.rotation.x = -Math.PI / 2;
    band.position.z = -length * (fraction - 0.5);
    spin.add(band);
  }

  const base = new Mesh(
    new CylinderGeometry(radius * 1.1, radius * 1.1, length * 0.09, 26),
    orange,
  );
  base.rotation.x = -Math.PI / 2;
  base.position.z = -length * 0.46;
  spin.add(base);

  // His eyes ride on the OUTER hull rather than the spinning body, so they stay
  // pointed at the camera while he rolls. A rolling cone whose eyes tumble with
  // it reads as debris; a rolling cone that keeps looking at you reads as Gary.
  const eyes = new Group();
  for (const side of [-1, 1]) {
    const eye = new Group();
    eye.position.set(side * radius * 0.34, radius * 0.42, radius * 0.5);
    const sclera = new Mesh(new SphereGeometry(radius * 0.3, 14, 14), eyeWhite);
    eye.add(sclera);
    const iris = new Mesh(new SphereGeometry(radius * 0.15, 10, 10), pupil);
    iris.position.z = radius * 0.2;
    eye.add(iris);
    eyes.add(eye);
  }
  root.add(eyes);

  return { root, spin };
}
