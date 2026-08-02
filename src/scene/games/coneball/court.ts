/**
 * The court: floor, barriers, far gantry and the lighting rig above it.
 *
 * Rendering-side only. Every dimension comes from `game/games/coneball/arena.ts`
 * — the same numbers the swept solver collides against — so "the ball visibly
 * bounced off that barrier" and "the ball collided with that barrier" are the
 * same statement rather than two drifting approximations.
 *
 * ── The look ────────────────────────────────────────────────────────────────
 * A night roadworks site, dark-first. The floor is wet asphalt; the only warm
 * light in the place is the hazard lamps and the ball itself. Materials come
 * from the shared `render/materials.ts` contract, so the graphics child's
 * upgrade lands here for free; nothing in this file sets tone mapping or bloom
 * (that belongs to the shell's pipeline).
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import {
  ARENA_FAR_Z,
  ARENA_HALF_X,
  MISS_Z,
  PADDLE_Z,
  TARGET_ROW_Z,
} from '../../../game/games/coneball/arena.ts';
import { ownStandard, sharedStandard } from '../../../render/materials.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/** How far past the miss line the floor keeps going, so the court has a lip. */
const FLOOR_OVERRUN = 2.6;
/** Court length, from the gantry to just past the miss line. */
const COURT_LENGTH = MISS_Z - ARENA_FAR_Z + FLOOR_OVERRUN;
const COURT_CENTER_Z = (ARENA_FAR_Z + MISS_Z + FLOOR_OVERRUN) / 2;

/** Height of the jersey barriers down each side. */
const BARRIER_HEIGHT = 0.72;

export class Court {
  readonly group = new Group();

  /**
   * The lamp bar over the gantry, as its (own, uncached) materials. Pulsed on a
   * serve, so the court itself announces the ball is coming.
   */
  private readonly gantryLamps: MeshStandardMaterial[] = [];
  /** The line the ball dies behind. Flares red on a miss. */
  private readonly missMaterial: MeshBasicMaterial;
  /** 0..1, decayed by the view. Drives the miss line's flare. */
  private missFlash = 0;
  private servePulse = 0;

  constructor() {
    this.group.name = 'ConeballCourt';

    // ── Floor ──────────────────────────────────────────────────────────────
    // Wet asphalt: dark and fairly smooth, so the hazard lamps streak across it
    // instead of dying in a matte surface.
    const floor = new Mesh(
      new PlaneGeometry(ARENA_HALF_X * 2, COURT_LENGTH),
      sharedStandard({ color: 0x10101c, roughness: 0.42, metalness: 0.15 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, COURT_CENTER_Z);
    this.group.add(floor);

    // Cool ground beyond the court, so the arena reads as a lit patch of a much
    // bigger dark site rather than as a floating slab.
    const surround = new Mesh(
      new PlaneGeometry(160, 220),
      sharedStandard({ color: 0x0b0b14, roughness: 1, metalness: 0 }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(0, -0.06, COURT_CENTER_Z - 40);
    this.group.add(surround);

    // Lane guides: faint accent lines up the court under the drum columns, so
    // the player can read the ball's line against something.
    for (const x of [-2.64, -1.32, 0, 1.32, 2.64]) {
      const guide = new Mesh(
        new PlaneGeometry(0.035, COURT_LENGTH - 1.2),
        new MeshBasicMaterial({
          color: ACCENT,
          transparent: true,
          opacity: x === 0 ? 0.16 : 0.07,
          depthWrite: false,
          fog: false,
        }),
      );
      guide.rotation.x = -Math.PI / 2;
      guide.position.set(x, 0.006, COURT_CENTER_Z);
      this.group.add(guide);
    }

    // Depth rungs level with each row of drums: the court's own ruler, so the
    // ball's distance is readable rather than guessed.
    for (const z of TARGET_ROW_Z) {
      const rung = new Mesh(
        new PlaneGeometry(ARENA_HALF_X * 2 - 0.5, 0.02),
        new MeshBasicMaterial({
          color: ACCENT_2,
          transparent: true,
          opacity: 0.09,
          depthWrite: false,
          fog: false,
        }),
      );
      rung.rotation.x = -Math.PI / 2;
      rung.position.set(0, 0.006, z);
      this.group.add(rung);
    }

    // ── Side barriers ──────────────────────────────────────────────────────
    // Concrete jersey barriers with a lit accent cap, so the ball's rebound
    // surface is unmistakable at a glance and at speed.
    const concrete = sharedStandard({
      color: 0x2b2b3c,
      roughness: 0.85,
      metalness: 0.05,
    });
    const cap = sharedStandard({
      color: ACCENT,
      roughness: 0.35,
      emissive: ACCENT,
      emissiveIntensity: 0.75,
    });
    for (const side of [-1, 1]) {
      const wall = new Mesh(
        new BoxGeometry(0.44, BARRIER_HEIGHT, COURT_LENGTH),
        concrete,
      );
      wall.position.set(
        side * (ARENA_HALF_X + 0.22),
        BARRIER_HEIGHT / 2,
        COURT_CENTER_Z,
      );
      this.group.add(wall);

      const rail = new Mesh(
        new BoxGeometry(0.5, 0.06, COURT_LENGTH),
        cap,
      );
      rail.position.set(
        side * (ARENA_HALF_X + 0.22),
        BARRIER_HEIGHT + 0.03,
        COURT_CENTER_Z,
      );
      this.group.add(rail);

      // Cats' eyes down the barrier: a rhythm the eye can use to judge depth.
      for (let z = ARENA_FAR_Z + 0.8; z < MISS_Z; z += 1.7) {
        const stud = new Mesh(
          new CylinderGeometry(0.05, 0.05, 0.03, 8),
          sharedStandard({
            color: ACCENT_2,
            roughness: 0.3,
            emissive: ACCENT_2,
            emissiveIntensity: 1.5,
          }),
        );
        stud.rotation.z = Math.PI / 2;
        stud.position.set(
          side * (ARENA_HALF_X - 0.01),
          BARRIER_HEIGHT * 0.62,
          z,
        );
        this.group.add(stud);
      }
    }

    // ── The far gantry ─────────────────────────────────────────────────────
    // The wall Coneelia serves from: a roadworks sign gantry, legs and beam,
    // with a bar of lamps that pulses on every serve.
    const steel = sharedStandard({
      color: 0x3a3a50,
      roughness: 0.45,
      metalness: 0.65,
    });
    const backboard = new Mesh(
      new BoxGeometry(ARENA_HALF_X * 2 + 0.9, 2.2, 0.35),
      sharedStandard({ color: 0x1c1c2c, roughness: 0.7, metalness: 0.2 }),
    );
    backboard.position.set(0, 1.1, ARENA_FAR_Z - 0.2);
    this.group.add(backboard);

    for (const side of [-1, 1]) {
      const leg = new Mesh(new BoxGeometry(0.22, 4.4, 0.22), steel);
      leg.position.set(side * (ARENA_HALF_X + 0.3), 2.2, ARENA_FAR_Z - 0.45);
      this.group.add(leg);
    }
    const beam = new Mesh(
      new BoxGeometry(ARENA_HALF_X * 2 + 1.1, 0.26, 0.26),
      steel,
    );
    beam.position.set(0, 4.3, ARENA_FAR_Z - 0.45);
    this.group.add(beam);

    // The lamp bar. Own (uncached) materials: these are animated.
    for (let i = 0; i < 7; i++) {
      const material = ownStandard({
        color: ACCENT_2,
        roughness: 0.3,
        emissive: ACCENT,
        emissiveIntensity: 1.1,
      });
      const lamp = new Mesh(new BoxGeometry(0.7, 0.16, 0.16), material);
      lamp.position.set((i - 3) * 1.05, 4.02, ARENA_FAR_Z - 0.45);
      this.gantryLamps.push(material);
      this.group.add(lamp);
    }

    // ── The miss line ──────────────────────────────────────────────────────
    // The one piece of the court that is not decorative: it draws exactly where
    // the ball stops being savable, so a lost life is never a mystery.
    this.missMaterial = new MeshBasicMaterial({
      color: 0xff4d5e,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      fog: false,
    });
    const missLine = new Mesh(
      new PlaneGeometry(ARENA_HALF_X * 2, 0.14),
      this.missMaterial,
    );
    missLine.rotation.x = -Math.PI / 2;
    missLine.position.set(0, 0.008, MISS_Z);
    this.group.add(missLine);

    // A soft accent ring on the floor where the board patrols, so the player's
    // half of the court is visibly theirs.
    const home = new Mesh(
      new RingGeometry(0.1, ARENA_HALF_X * 1.35, 48, 1, 0, Math.PI * 2),
      new MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        fog: false,
      }),
    );
    home.rotation.x = -Math.PI / 2;
    home.position.set(0, 0.004, PADDLE_Z);
    this.group.add(home);
  }

  /** The court flashes its lamps when Coneelia lets go. */
  serveFlash(): void {
    this.servePulse = 1;
  }

  /** The miss line flares when the ball crosses it. */
  missFlare(): void {
    this.missFlash = 1;
  }

  /**
   * Idle life plus the two event flashes.
   *
   * Reduced motion holds the lamps at a steady, legible brightness rather than
   * chasing them — the information (a serve happened, a life was lost) is
   * carried by the HUD and by the ball itself, so nothing is lost by stilling
   * the flicker.
   */
  update(dt: number, time: number, reducedMotion: boolean): void {
    this.servePulse *= Math.exp(-4.5 * dt);
    this.missFlash *= Math.exp(-2.6 * dt);

    for (let i = 0; i < this.gantryLamps.length; i++) {
      const chase = reducedMotion
        ? 0
        : Math.max(0, Math.sin(time * 2.2 - i * 0.55)) * 0.6;
      this.gantryLamps[i].emissiveIntensity = 0.9 + chase + this.servePulse * 2.4;
    }

    this.missMaterial.opacity = 0.2 + this.missFlash * 0.6;
  }

  /** Back to rest. A restart must not inherit the last miss's red flare. */
  reset(): void {
    this.missFlash = 0;
    this.servePulse = 0;
    this.missMaterial.opacity = 0.24;
  }
}
