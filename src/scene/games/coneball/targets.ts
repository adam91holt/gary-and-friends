/**
 * The hazard drums suspended over the court, and the way they pop.
 *
 * Rendering-side only: one mesh per drum in the formation, placed from the
 * simulation's own `ConeballTarget` list and keyed by its stable id, so a drum
 * can never be drawn in a place the solver is not collidng against.
 *
 * ── The pop ─────────────────────────────────────────────────────────────────
 * A smashed drum does not vanish. It over-scales for a beat, spins off its
 * axis and drops through the floor while fading — because the moment a hit
 * lands is the moment the player earned something, and an object that simply
 * stops existing gives that moment nothing to land on. The pop is transform +
 * opacity only, and reduced motion replaces it with a straight fade in place.
 */
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import {
  TARGET_HALF_DEPTH,
  TARGET_HALF_WIDTH,
  type ConeballTarget,
} from '../../../game/games/coneball/arena.ts';
import { ownStandard } from '../../../render/materials.ts';
import { FRIEND_TINTS } from '../../../theme.ts';

/** How long a pop takes to play out. */
const POP_DURATION = 0.55;
/** How long a freshly-dropped wave takes to settle in. */
const DROP_DURATION = 0.4;
/** Where a drum floats above the court. */
const DRUM_Y = 0.62;

/** Per-row tints, drawn from the shared token palette. Depth reads as colour. */
const ROW_TINTS = [FRIEND_TINTS[4], FRIEND_TINTS[1], FRIEND_TINTS[3]];

interface Drum {
  readonly mesh: Group;
  readonly material: MeshStandardMaterial;
  readonly bandMaterial: MeshStandardMaterial;
  /** Seconds into the pop, or null while it is standing. */
  popT: number | null;
  /** Seconds into the drop-in, or null once settled. */
  dropT: number | null;
  /** Random-ish tumble axis, derived from the id so it is deterministic. */
  readonly spin: number;
}

/** A roadworks drum: a barrel with two reflective bands, lit from within. */
function createDrum(row: number): {
  group: Group;
  shell: MeshStandardMaterial;
  band: MeshStandardMaterial;
} {
  const group = new Group();
  const tint = ROW_TINTS[row % ROW_TINTS.length];
  // Own (uncached) materials: every drum fades independently as it pops.
  const shell = ownStandard({
    color: tint,
    roughness: 0.5,
    emissive: tint,
    emissiveIntensity: 0.32,
  });
  shell.transparent = true;
  const band = ownStandard({ color: 0xf6f1e8, roughness: 0.4 });
  band.transparent = true;

  const radius = Math.min(TARGET_HALF_WIDTH, TARGET_HALF_DEPTH * 1.4);
  const body = new Mesh(
    new CylinderGeometry(radius * 0.86, radius, TARGET_HALF_DEPTH * 2.6, 18, 1, true),
    shell,
  );
  group.add(body);

  for (const y of [-0.16, 0.16]) {
    const stripe = new Mesh(
      new CylinderGeometry(radius * 0.94, radius * 0.94, 0.14, 18, 1, true),
      band,
    );
    stripe.position.y = y;
    group.add(stripe);
  }

  const lid = new Mesh(
    new CylinderGeometry(radius * 0.86, radius * 0.86, 0.06, 18),
    shell,
  );
  lid.position.y = TARGET_HALF_DEPTH * 1.3;
  group.add(lid);

  return { group, shell, band };
}

export class Targets {
  readonly group = new Group();
  private readonly drums = new Map<number, Drum>();

  constructor() {
    this.group.name = 'ConeballTargets';
  }

  /**
   * Bring the drawn wall in line with the simulation's formation.
   *
   * A drum that is active and drawn is simply placed; one that has just gone
   * inactive starts its pop; one that has just come back (a fresh wave stood up
   * in its place) starts its drop-in.
   */
  sync(
    targets: readonly ConeballTarget[],
    dt: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    for (const target of targets) {
      let drum = this.drums.get(target.id);
      if (!drum) {
        const built = createDrum(target.row);
        this.group.add(built.group);
        drum = {
          mesh: built.group,
          material: built.shell,
          bandMaterial: built.band,
          popT: null,
          dropT: 0,
          spin: ((target.id * 37) % 17) / 17 - 0.5,
        };
        this.drums.set(target.id, drum);
      }

      if (target.active) {
        // A drum that was popping and is active again is a NEW wave's drum in
        // the same slot: drop it back in rather than resuming its death.
        if (drum.popT !== null) {
          drum.popT = null;
          drum.dropT = 0;
        }
        this.stand(drum, target, dt, time, reducedMotion);
      } else if (drum.popT === null) {
        drum.popT = 0;
        drum.dropT = null;
      }

      if (drum.popT !== null) this.pop(drum, target, dt, reducedMotion);
    }
  }

  /** A standing drum: placed, gently bobbing, and dropping in if it is new. */
  private stand(
    drum: Drum,
    target: ConeballTarget,
    dt: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    drum.mesh.visible = true;
    let drop = 1;
    if (drum.dropT !== null) {
      drum.dropT += dt;
      drop = Math.min(1, drum.dropT / DROP_DURATION);
      if (drop >= 1) drum.dropT = null;
    }
    const eased = 1 - (1 - drop) ** 3;
    // Reduced motion skips the fall and just fades the new wave in.
    const fall = reducedMotion ? 0 : (1 - eased) * 2.6;
    const bob = reducedMotion
      ? 0
      : Math.sin(time * 1.5 + target.id * 0.6) * 0.045;

    drum.mesh.position.set(target.x, DRUM_Y + fall + bob, target.z);
    drum.mesh.rotation.set(0, reducedMotion ? 0 : time * 0.35 + target.id, 0);
    drum.mesh.scale.setScalar(reducedMotion ? 1 : 0.6 + eased * 0.4);
    this.setOpacity(drum, eased);
  }

  /** A smashed drum: over-scale, tumble, drop and fade. */
  private pop(
    drum: Drum,
    target: ConeballTarget,
    dt: number,
    reducedMotion: boolean,
  ): void {
    if (drum.popT === null) return;
    drum.popT += dt;
    const t = Math.min(1, drum.popT / (reducedMotion ? 0.2 : POP_DURATION));

    if (reducedMotion) {
      // Fade in place: the information (that drum is gone) still arrives, and
      // nothing tumbles across the frame.
      drum.mesh.position.set(target.x, DRUM_Y, target.z);
      drum.mesh.rotation.set(0, 0, 0);
      drum.mesh.scale.setScalar(1);
      this.setOpacity(drum, 1 - t);
    } else {
      // A quick punch out to 1.35× then a collapse — the shape of a thing
      // bursting rather than deflating.
      const punch = t < 0.22 ? 1 + (t / 0.22) * 0.35 : 1.35 * (1 - (t - 0.22) / 0.78);
      drum.mesh.scale.setScalar(Math.max(0, punch));
      drum.mesh.position.set(
        target.x + drum.spin * t * 1.6,
        DRUM_Y - t * t * 2.4,
        target.z + drum.spin * t * 0.8,
      );
      drum.mesh.rotation.set(t * 5.4 * drum.spin, t * 3.1, t * 4.2 * drum.spin);
      this.setOpacity(drum, 1 - t * t);
    }

    if (t >= 1) {
      drum.mesh.visible = false;
      drum.popT = null;
    }
  }

  private setOpacity(drum: Drum, opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity));
    drum.material.opacity = clamped;
    drum.bandMaterial.opacity = clamped;
  }

  /** Hide everything, cancelling any pops in flight. */
  clear(): void {
    for (const drum of this.drums.values()) {
      drum.popT = null;
      drum.dropT = 0;
      drum.mesh.visible = false;
    }
  }
}
