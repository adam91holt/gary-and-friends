/**
 * The two cone-friends Big Bounce stars: Bartholocone (the board) and Coneelia
 * (the server).
 *
 * Rendering-side only. Both are built from the SAME procedural cone vocabulary
 * as `scene/gary.ts` and `scene/friends.ts` — tapered shell, white reflective
 * bands, googly eyes — and both take their proportions and their tint straight
 * from the shared roster (`game/friends/roster.ts`), so the cone you meet on
 * the highway and the cone holding the board here are visibly the same person.
 *
 * The one liberty taken: Bartholocone carries a board. He is squat and very
 * broad — the widest, lowest silhouette in the cast — which is exactly why he
 * is the one holding it, and the board's dimensions come from the arena
 * constants the solver collides against, never from a number invented here.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import {
  PADDLE_HALF_DEPTH,
  PADDLE_HALF_WIDTH,
} from '../../../game/games/coneball/arena.ts';
import { friendProfile } from '../../../game/friends/roster.ts';
import { ownStandard, sharedStandard } from '../../../render/materials.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/** Roster indexes. Coneelia is 0, Bartholocone is 1 (see roster.ts). */
const CONEELIA = 0;
const BARTHOLOCONE = 1;

/** Build one roster cone: shell, bands, base and googly eyes, facing +Z. */
function createCone(variant: number, scale = 1): Group {
  const profile = friendProfile(variant);
  const baseRadius = profile.baseRadius * scale;
  const height = profile.height * scale;
  const tipRadius = baseRadius * 0.11;
  const group = new Group();
  group.name = `Coneball-${profile.name}`;

  const shell = sharedStandard({ color: profile.tint, roughness: 0.55 });
  const white = sharedStandard({ color: 0xffffff, roughness: 0.5 });

  const body = new Mesh(
    new CylinderGeometry(tipRadius, baseRadius, height, 24, 1, true),
    shell,
  );
  body.position.y = height / 2;
  group.add(body);

  const radiusAt = (y: number): number =>
    baseRadius + (tipRadius - baseRadius) * (y / height);

  for (const fraction of profile.bands) {
    const y = height * fraction;
    const r = radiusAt(y) + 0.004;
    const band = new Mesh(
      new CylinderGeometry(r, r, height * 0.11, 24, 1, true),
      white,
    );
    band.position.y = y;
    group.add(band);
  }

  const base = new Mesh(
    new CylinderGeometry(baseRadius * 1.15, baseRadius * 1.15, height * 0.08, 24),
    shell,
  );
  base.position.y = height * 0.04;
  group.add(base);

  // Googly eyes, facing +Z (toward the player's camera) exactly like the rest
  // of the cast. Bartholocone is flipped by his caller so he watches the court.
  const eyeY = height * 0.64;
  const eyeR = Math.max(0.055, baseRadius * 0.3);
  const surface = radiusAt(eyeY);
  const eyeWhite = sharedStandard({ color: 0xfdfdfd, roughness: 0.3 });
  const pupil = sharedStandard({ color: 0x14141f, roughness: 0.35 });
  for (const side of [-1, 1]) {
    const eye = new Group();
    eye.position.set(side * eyeR * 1.15, eyeY, surface + eyeR * 0.15);
    eye.add(new Mesh(new SphereGeometry(eyeR, 14, 14), eyeWhite));
    const iris = new Mesh(new SphereGeometry(eyeR * 0.5, 12, 12), pupil);
    iris.position.z = eyeR * 0.68;
    eye.add(iris);
    group.add(eye);
  }

  return group;
}

/**
 * Bartholocone and the board he holds.
 *
 * The board's half-extents ARE the collider's: it is built from
 * `PADDLE_HALF_WIDTH` / `PADDLE_HALF_DEPTH`, so a player who reads the ball as
 * "just clipping the edge" is reading the truth.
 */
export class Paddle {
  readonly group = new Group();
  /** The cone itself. Leaned into the slide by the runtime. */
  private readonly cone: Group;
  /** The board. Squashed on impact, so a return has weight. */
  private readonly board: Group;
  /** The lit strip's material. Held typed, because it is animated. */
  private readonly glowMaterial: MeshStandardMaterial;
  /** 0..1, set on every return and decayed each frame. */
  private impact = 0;

  constructor() {
    this.group.name = 'Bartholocone';

    // He is behind his own board, looking up the court — so his eyes face -Z,
    // which is a half-turn from the cast's default +Z.
    this.cone = createCone(BARTHOLOCONE, 1.15);
    this.cone.rotation.y = Math.PI;
    this.cone.position.z = 0.42;
    this.group.add(this.cone);

    this.board = new Group();
    const slab = new Mesh(
      new BoxGeometry(PADDLE_HALF_WIDTH * 2, 0.34, PADDLE_HALF_DEPTH * 2),
      sharedStandard({ color: 0xf2ece2, roughness: 0.5, metalness: 0.1 }),
    );
    slab.position.y = 0.55;
    this.board.add(slab);

    // Hazard chevrons on the face: the board is a piece of roadworks kit, and
    // this is the same diagonal motif the HUD wears at the token layer.
    for (let i = 0; i < 5; i++) {
      const chevron = new Mesh(
        new BoxGeometry(PADDLE_HALF_WIDTH * 0.34, 0.3, 0.06),
        sharedStandard({ color: ACCENT, roughness: 0.45 }),
      );
      chevron.position.set(
        (i - 2) * PADDLE_HALF_WIDTH * 0.42,
        0.55,
        -PADDLE_HALF_DEPTH - 0.02,
      );
      chevron.rotation.z = 0.42;
      this.board.add(chevron);
    }

    // The strip that lights on contact — own material, because it animates.
    this.glowMaterial = ownStandard({
      color: ACCENT_2,
      roughness: 0.3,
      emissive: ACCENT_2,
      emissiveIntensity: 0.5,
    });
    const glowStrip = new Mesh(
      new BoxGeometry(PADDLE_HALF_WIDTH * 2, 0.07, 0.05),
      this.glowMaterial,
    );
    glowStrip.position.set(0, 0.74, -PADDLE_HALF_DEPTH - 0.03);
    this.board.add(glowStrip);

    this.group.add(this.board);
  }

  /** A return just landed here. `offset` is -1..1 across the board's face. */
  strike(offset: number): void {
    this.impact = 1;
    this.board.position.x = offset * 0.06;
  }

  /**
   * Place and animate. `velocity` is the board's lateral speed, which drives
   * the lean — the one thing that makes a slide read as a shove rather than a
   * slide-projector transition.
   */
  update(
    x: number,
    velocity: number,
    dt: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    this.group.position.x = x;
    this.impact *= Math.exp(-6.5 * dt);

    if (reducedMotion) {
      this.cone.rotation.z = 0;
      this.cone.position.y = 0;
      this.board.scale.set(1, 1, 1);
      this.board.position.x = 0;
      // Held bright enough that the board's face is legible without pulsing.
      this.glowMaterial.emissiveIntensity = 0.9;
      return;
    }

    // Lean into the slide, capped so a fast flick never lays him flat.
    const lean = Math.max(-0.42, Math.min(0.42, -velocity * 0.06));
    this.cone.rotation.z += (lean - this.cone.rotation.z) * Math.min(1, dt * 12);
    this.cone.position.y = Math.sin(time * 2.1) * 0.025;

    // Impact squash on the board only. Transform-only, and it settles.
    const squash = this.impact * 0.32;
    this.board.scale.set(1 + squash * 0.4, 1 - squash, 1 - squash * 0.55);
    this.board.position.x *= Math.exp(-9 * dt);
    this.glowMaterial.emissiveIntensity = 0.5 + this.impact * 3.4;
  }

  /** Back to rest between runs. */
  reset(): void {
    this.impact = 0;
    this.board.scale.set(1, 1, 1);
    this.board.position.x = 0;
    this.cone.rotation.z = 0;
  }
}

/**
 * Coneelia on the gantry side. She holds the ball while a serve is pending and
 * winds up when it goes, which is the whole reason the serve state is visible
 * at all: the player does not read a label, they watch her.
 */
export class Server {
  readonly group = new Group();
  private readonly cone: Group;
  /** 0..1 wind-up, spent on a serve and decayed each frame. */
  private throwT = 0;

  constructor() {
    this.group.name = 'Coneelia';
    this.cone = createCone(CONEELIA, 1.1);
    this.group.add(this.cone);
  }

  /** She let go. */
  serve(): void {
    this.throwT = 1;
  }

  /**
   * Place and animate. `holding` leans her forward over the ball, and the
   * throw un-coils that lean.
   */
  update(
    x: number,
    z: number,
    holding: boolean,
    dt: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    this.group.position.set(x, 0, z);
    this.throwT *= Math.exp(-5 * dt);

    if (reducedMotion) {
      this.cone.rotation.set(0, 0, 0);
      this.cone.scale.set(1, 1, 1);
      return;
    }

    // Coiled over the ball while she holds it, uncoiled after the throw.
    const coil = (holding ? 0.24 : 0.06) - this.throwT * 0.5;
    this.cone.rotation.x += (coil - this.cone.rotation.x) * Math.min(1, dt * 9);
    this.cone.rotation.y = Math.sin(time * 1.4) * 0.16;
    // A little stretch as she follows through. Transform only.
    const stretch = 1 + this.throwT * 0.16;
    this.cone.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
  }

  /** Back to rest between runs. */
  reset(): void {
    this.throwT = 0;
    this.cone.rotation.set(0, 0, 0);
    this.cone.scale.set(1, 1, 1);
  }
}
