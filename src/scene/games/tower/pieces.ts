/**
 * The cast, built to be stacked.
 *
 * Rendering-side only. A tower piece is the SAME procedural cone vocabulary as
 * `src/scene/friends.ts` — tapered shell, white reflective bands, googly eyes,
 * Sir Cones-a-lot's topper — because these are Gary's people and they have to
 * look it whichever game they are standing in. Every dimension and tint comes
 * from `src/game/friends/roster.ts`, so a piece can never be drawn as a
 * different cone from the one the simulation stacked.
 *
 * ── Why a piece is built at unit width ──────────────────────────────────────
 * In a stacker the FOOTPRINT is dictated by the tower, not by the character:
 * the simulation shears the overhang off a scruffy landing, so a piece's width
 * is run-dependent while its height is fixed by who it is. So each piece is
 * modelled one world unit wide and scaled laterally to whatever the simulation
 * says it ended up as — which makes the consequence of a sloppy drop visible as
 * the tower narrowing into a spindle.
 *
 * That means HEIGHT carries all of the characterisation here, which is exactly
 * why Tiny and Big Dave are the billed pair: at a shared width, a half-height
 * sliver next to the tallest cone in the cast is the strongest silhouette
 * contrast the roster can produce. The taper, band count, tint and topper still
 * come from each character's own roster entry, so a Big Dave is unmistakably a
 * Big Dave — it is simply as wide as the tower let it be.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
} from 'three';
import { friendProfile } from '../../../game/friends/roster.ts';
import { pieceHeight } from '../../../game/games/tower/rules.ts';
import { ownStandard, sharedStandard } from '../../../render/materials.ts';
import { ACCENT_2 } from '../../../theme.ts';

/** Segment counts. The diorama is close to the lens, so it can afford these. */
const RADIAL = 26;

/**
 * How much of the drawn shell sits inside the footprint the simulation uses.
 *
 * Slightly under 1: a cone drawn exactly as wide as its collision footprint
 * looks like it is overhanging by a hair at every level, because the eye reads
 * the widest point of the flare rather than the centre line.
 */
const FOOTPRINT_FIT = 0.94;

/**
 * How much a piece narrows from base to tip, as a fraction of its base radius.
 *
 * Derived from the character's own road-cone proportions rather than picked:
 * a squat, broad friend (Bartholocone) tapers barely at all, while a tall slim
 * one (Sir Cones-a-lot) pitches in hard. Clamped either side, because a tip
 * that reaches a true point is not a thing anything can be stacked on, and one
 * that barely narrows is a cylinder.
 */
function taperFor(baseRadius: number, height: number): number {
  const slenderness = height / (baseRadius * 2);
  // Slender characters keep more of a point; broad ones stay blunt.
  const taper = 0.72 - slenderness * 0.12;
  return Math.min(0.68, Math.max(0.34, taper));
}

/** One built piece: the group to place, plus the shell material to flash. */
export interface TowerPiece {
  readonly group: Group;
  /** Unshared, so a perfect-landing flash can animate it without recolouring
   *  every other piece of the same cast member. */
  readonly shell: ReturnType<typeof ownStandard>;
  /** The eyes, so the caller can counter-scale them out of the piece's squeeze. */
  readonly eyes: Group;
  readonly variant: number;
}

/**
 * Build one cast member as a stackable piece, standing with its base at y=0 in
 * its own local space and drawn at the roster's natural width.
 */
export function createTowerPiece(variant: number): TowerPiece {
  const profile = friendProfile(variant);
  const height = pieceHeight(variant);
  // Unit footprint — the caller scales it to whatever the tower allows. The
  // TAPER is still the character's: a broad cone like Big Dave keeps its blunt,
  // barely-narrowing profile while a slim one like Sir Cones-a-lot keeps its
  // steep pitch, because taper is a ratio and survives the lateral scale.
  const baseRadius = 0.5;
  const tipRadius = baseRadius * taperFor(profile.baseRadius, profile.height);
  const group = new Group();
  group.name = `TowerPiece-${profile.name}`;

  const shell = ownStandard({ color: profile.tint, roughness: 0.5 });

  const body = new Mesh(
    new CylinderGeometry(tipRadius, baseRadius, height, RADIAL, 1, true),
    shell,
  );
  body.position.y = height / 2;
  group.add(body);

  const radiusAt = (y: number): number =>
    baseRadius + (tipRadius - baseRadius) * (y / height);

  const white = sharedStandard({ color: 0xf4f4f8, roughness: 0.5 });
  for (const fraction of profile.bands) {
    const y = height * fraction;
    const r = radiusAt(y) + 0.006;
    const band = new Mesh(
      new CylinderGeometry(r, r, height * 0.13, RADIAL, 1, true),
      white,
    );
    band.position.y = y;
    group.add(band);
  }

  // A thin lip top and bottom, so a stack reads as pieces RESTING on each other
  // rather than as cones interpenetrating. Deliberately shallow and only barely
  // proud of the shell: a fat plate would read as a saucer and flatten the very
  // silhouette the cast is here to provide.
  const foot = new Mesh(
    new CylinderGeometry(baseRadius * 1.03, baseRadius * 1.03, height * 0.05, RADIAL),
    shell,
  );
  foot.position.y = height * 0.025;
  group.add(foot);

  const cap = new Mesh(
    new CylinderGeometry(tipRadius * 1.06, tipRadius * 1.06, height * 0.04, RADIAL),
    shell,
  );
  cap.position.y = height - height * 0.02;
  group.add(cap);

  // Googly eyes, facing the camera at +Z like the rest of the cast. A tower of
  // cones is a shape; a tower of cones LOOKING at you is the joke.
  //
  // They hang off their own group so the caller can undo the piece's lateral
  // squeeze on them: a narrowed piece should look like a narrowed CONE, not
  // like a character whose eyes have been pressed together in a vice.
  const eyes = new Group();
  eyes.name = 'TowerPieceEyes';
  const eyeY = height * 0.58;
  const eyeR = Math.max(0.05, baseRadius * 0.3);
  const surface = radiusAt(eyeY);
  const eyeWhite = sharedStandard({ color: 0xfdfdfd, roughness: 0.3 });
  const pupil = sharedStandard({ color: 0x14141f, roughness: 0.35 });
  for (const side of [-1, 1]) {
    const eye = new Group();
    eye.position.set(side * eyeR * 1.1, eyeY, surface + eyeR * 0.1);
    eye.add(new Mesh(new SphereGeometry(eyeR, 14, 14), eyeWhite));
    const iris = new Mesh(new SphereGeometry(eyeR * 0.5, 12, 12), pupil);
    iris.position.z = eyeR * 0.66;
    eye.add(iris);
    eyes.add(eye);
  }
  group.add(eyes);

  if (profile.topper) {
    const topper = new Mesh(
      new ConeGeometry(baseRadius * 0.62, height * 0.16, 12),
      sharedStandard({ color: ACCENT_2, roughness: 0.35, metalness: 0.2 }),
    );
    topper.position.y = height + height * 0.07;
    group.add(topper);
  }

  return { group, shell, eyes, variant };
}

/**
 * The lateral scale that makes a piece occupy exactly `width` on the tower.
 *
 * Pieces are modelled one world unit wide (see the file header), so this is
 * simply the width — trimmed slightly so the widest point of the flare sits
 * inside the footprint collision actually used, rather than a hair proud of it.
 */
export function widthScale(width: number): number {
  return width * FOOTPRINT_FIT;
}

/**
 * A per-variant pool of ready-made pieces.
 *
 * Pooled rather than instanced for the same reason the conga line is: every
 * piece needs its own footprint scale and its own landing flash, which an
 * InstancedMesh cannot give without a custom shader — and a tower is a dozen
 * objects, not a thousand.
 */
export class PiecePool {
  private readonly free = new Map<number, TowerPiece[]>();

  constructor(private readonly parent: Group) {}

  /** Take a piece of `variant`, building one only if the pool is empty. */
  take(variant: number): TowerPiece {
    const bucket = this.free.get(variant);
    const reused = bucket?.pop();
    if (reused) {
      reused.group.visible = true;
      return reused;
    }
    const piece = createTowerPiece(variant);
    this.parent.add(piece.group);
    return piece;
  }

  /** Hand a piece back. It stays in the scene graph, just hidden. */
  release(piece: TowerPiece): void {
    piece.group.visible = false;
    const bucket = this.free.get(piece.variant);
    if (bucket) bucket.push(piece);
    else this.free.set(piece.variant, [piece]);
  }
}
