/**
 * The royal roadworks lane: the set Royal Roll is played on.
 *
 * Rendering-side only. It owns geometry, materials and one instrument that
 * animates (the throw rail); it reads the simulation and never writes to it.
 * Everything is procedural boxes/cylinders/cones in the house vocabulary — no
 * textures, no runtime asset fetch — and every colour comes from the shared
 * token layer (`src/theme.ts`), so the lane can never introduce a second accent.
 *
 * ── The committed idea ──────────────────────────────────────────────────────
 * The throws you have left are not a HUD number: they are ten crown pips set
 * into the left barrier, lit in the accent and snuffed out one at a time as you
 * spend them. The instrument is IN the world, which is what makes this a lane
 * you are standing at rather than a form with a counter on it. The right
 * barrier carries the same rail in reverse for the cones felled, so the two
 * things a player is trading — throws for cones — face each other across the
 * deck.
 */
import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  TorusGeometry,
} from 'three';
import {
  FORMATION_SIZE,
  LANE_HALF_WIDTH,
  LANE_MAX_Z,
  LANE_MIN_Z,
} from '../../../game/games/royal-roll/formation.ts';
import { ownStandard, sharedStandard } from '../../../render/materials.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/**
 * Sim space is lane-local (`z` grows away from the launch line); the scene is
 * three.js space (the lane runs into -Z, so a camera behind the player at +Z
 * looks down it). One function owns the conversion, so a mesh can never end up
 * mirrored against the physics it is drawn from.
 */
export function laneZ(simZ: number): number {
  return -simZ;
}

/** Deck surface height. Everything on the lane stands on this. */
export const DECK_Y = 0;

/**
 * The top of the deck DRESSING — the runner strip, its gold trim and the
 * distance marks are all inlays, and they stack to here.
 *
 * Exported because the aim guide and the roller trail are painted ON the deck
 * and must clear it. Sitting a hair under this (the guide originally did) does
 * not z-fight, it does something much more confusing: the guide is swallowed
 * whole by the runner box and only the slivers hanging over its edges are ever
 * drawn, which reads as a broken instrument rather than a buried one.
 */
export const DECK_DRESSING_TOP = 0.026;

const DECK_LENGTH = LANE_MAX_Z - LANE_MIN_Z + 3.4;
const DECK_CENTER_Z = laneZ((LANE_MAX_Z + LANE_MIN_Z) / 2 - 0.6);

/** How many pips each barrier rail carries. */
const THROW_PIPS = 10;

/** A single pip: its mesh, and the little glow that dies with it. */
interface Pip {
  readonly mesh: Mesh;
  readonly base: number;
}

export class RoyalLane {
  readonly group = new Group();

  /** Left rail: throws remaining. Right rail: cones felled this run. */
  private readonly throwPips: Pip[] = [];
  private readonly conePips: Pip[] = [];
  private readonly crownLight: PointLight;
  private readonly banners: Mesh[] = [];

  constructor() {
    this.group.name = 'RoyalLane';

    // ── The deck ────────────────────────────────────────────────────────────
    // Dark tarmac, because everything in this game is a road cone and the road
    // is what they are always standing on.
    const deck = new Mesh(
      new BoxGeometry(LANE_HALF_WIDTH * 2, 0.3, DECK_LENGTH),
      sharedStandard({ color: 0x14141f, roughness: 0.95, metalness: 0 }),
    );
    deck.position.set(0, DECK_Y - 0.15, DECK_CENTER_Z);
    this.group.add(deck);

    // The runner the King stands at the end of: a strip of fresh-laid surface,
    // lighter than the deck, that leads the eye straight down the lane.
    const runner = new Mesh(
      new BoxGeometry(2.5, 0.02, DECK_LENGTH - 0.6),
      sharedStandard({ color: 0x20202f, roughness: 0.8, metalness: 0.05 }),
    );
    runner.position.set(0, DECK_Y + 0.011, DECK_CENTER_Z);
    this.group.add(runner);

    // Gold trim down both edges of the runner. Thin: it is a seam in the road,
    // not a stripe painted on it.
    for (const side of [-1, 1]) {
      const trim = new Mesh(
        new BoxGeometry(0.05, 0.024, DECK_LENGTH - 0.6),
        sharedStandard({
          color: ACCENT_2,
          roughness: 0.35,
          metalness: 0.4,
          emissive: ACCENT_2,
          emissiveIntensity: 0.18,
        }),
      );
      trim.position.set(side * 1.25, DECK_Y + 0.013, DECK_CENTER_Z);
      this.group.add(trim);
    }

    // The launch line: where every throw starts, marked so the aim guide has
    // something to grow out of.
    const line = new Mesh(
      new BoxGeometry(LANE_HALF_WIDTH * 2 - 0.2, 0.02, 0.09),
      sharedStandard({ color: 0xf2f2f6, roughness: 0.6 }),
    );
    line.position.set(0, DECK_Y + 0.014, laneZ(0.95));
    this.group.add(line);

    // Distance chevrons: the roadworks way of saying "that way", and the only
    // depth cue on an otherwise empty deck.
    for (let i = 0; i < 5; i++) {
      const chevron = new Group();
      for (const side of [-1, 1]) {
        const bar = new Mesh(
          new BoxGeometry(0.62, 0.018, 0.11),
          sharedStandard({ color: 0x2c2c3d, roughness: 0.8 }),
        );
        bar.position.set(side * 0.26, 0, 0);
        bar.rotation.y = side * 0.5;
        chevron.add(bar);
      }
      chevron.position.set(0, DECK_Y + 0.016, laneZ(1.8 + i * 0.85));
      this.group.add(chevron);
    }

    // ── The barriers ────────────────────────────────────────────────────────
    // Hazard-taped timber down both sides. Alternating blocks rather than a
    // texture: the stripe is geometry, so it survives at any zoom and reads as
    // roadworks from the first frame.
    const hazardA = sharedStandard({ color: ACCENT, roughness: 0.5 });
    const hazardB = sharedStandard({ color: 0xf4f0e8, roughness: 0.55 });
    const post = sharedStandard({ color: 0x2a2a3a, roughness: 0.7, metalness: 0.3 });
    const blockLength = 0.72;
    const blocks = Math.ceil(DECK_LENGTH / blockLength);
    for (const side of [-1, 1]) {
      for (let i = 0; i < blocks; i++) {
        const block = new Mesh(
          new BoxGeometry(0.16, 0.34, blockLength * 0.94),
          i % 2 === 0 ? hazardA : hazardB,
        );
        block.position.set(
          side * LANE_HALF_WIDTH,
          DECK_Y + 0.42,
          DECK_CENTER_Z + DECK_LENGTH / 2 - blockLength * (i + 0.5),
        );
        this.group.add(block);
      }
      // Posts every few blocks, so the rail has something holding it up.
      for (let i = 0; i < blocks; i += 3) {
        const leg = new Mesh(new BoxGeometry(0.12, 0.6, 0.12), post);
        leg.position.set(
          side * LANE_HALF_WIDTH,
          DECK_Y + 0.3,
          DECK_CENTER_Z + DECK_LENGTH / 2 - blockLength * (i + 0.5),
        );
        this.group.add(leg);
      }
    }

    // ── The two rails of pips (see the file header) ─────────────────────────
    const pipGeometry = new CylinderGeometry(0.075, 0.075, 0.045, 16);
    for (let i = 0; i < THROW_PIPS; i++) {
      const z = laneZ(1.4 + i * 0.78);
      const throwPip = new Mesh(
        pipGeometry,
        ownStandard({
          color: ACCENT_2,
          roughness: 0.3,
          metalness: 0.3,
          emissive: ACCENT_2,
          emissiveIntensity: 1.4,
        }),
      );
      throwPip.rotation.x = Math.PI / 2;
      throwPip.position.set(-LANE_HALF_WIDTH - 0.14, DECK_Y + 0.55, z);
      this.throwPips.push({ mesh: throwPip, base: 1.4 });
      this.group.add(throwPip);
    }
    for (let i = 0; i < FORMATION_SIZE; i++) {
      const z = laneZ(1.2 + i * 0.7);
      const conePip = new Mesh(
        new ConeGeometry(0.075, 0.16, 10),
        ownStandard({
          color: ACCENT,
          roughness: 0.4,
          emissive: ACCENT,
          emissiveIntensity: 0,
        }),
      );
      conePip.position.set(LANE_HALF_WIDTH + 0.14, DECK_Y + 0.58, z);
      this.conePips.push({ mesh: conePip, base: 1.2 });
      this.group.add(conePip);
    }

    // ── The far end: the royal arch the King stands under ───────────────────
    const archMaterial = sharedStandard({
      color: 0x24243a,
      roughness: 0.5,
      metalness: 0.35,
    });
    for (const side of [-1, 1]) {
      const column = new Mesh(new CylinderGeometry(0.18, 0.24, 3.1, 12), archMaterial);
      column.position.set(side * 1.9, DECK_Y + 1.55, laneZ(LANE_MAX_Z + 0.9));
      this.group.add(column);
      const finial = new Mesh(new ConeGeometry(0.26, 0.5, 12), sharedStandard({
        color: ACCENT_2,
        roughness: 0.3,
        metalness: 0.55,
      }));
      finial.position.set(side * 1.9, DECK_Y + 3.35, laneZ(LANE_MAX_Z + 0.9));
      this.group.add(finial);
    }
    const lintel = new Mesh(new BoxGeometry(4.3, 0.3, 0.34), archMaterial);
    lintel.position.set(0, DECK_Y + 3.05, laneZ(LANE_MAX_Z + 0.9));
    this.group.add(lintel);

    // A halo ring hung under the arch, in the accent's warm partner. It is the
    // only bright thing at the back of the lane, so the eye is pulled to the
    // exact place the King is standing.
    const halo = new Mesh(
      new TorusGeometry(0.62, 0.045, 8, 28),
      new MeshBasicMaterial({ color: ACCENT_2, fog: false }),
    );
    halo.position.set(0, DECK_Y + 2.35, laneZ(LANE_MAX_Z + 0.85));
    this.group.add(halo);

    // Bunting: a line strung down each side from the arch back to the launch
    // line, with pennants hanging off it. The string matters — pennants floating
    // unattached read as a bug, and this is a lane somebody dressed for an
    // occasion. They are also the only thing moving while you aim, which is what
    // keeps a held pose from reading as a paused frame.
    const cord = sharedStandard({ color: 0x3a3a4e, roughness: 0.9 });
    const pennantSpan = LANE_MAX_Z - 1.2;
    for (const side of [-1, 1]) {
      const string = new Mesh(
        new BoxGeometry(0.018, 0.018, pennantSpan),
        cord,
      );
      string.position.set(
        side * (LANE_HALF_WIDTH - 0.14),
        DECK_Y + 1.72,
        laneZ(1.6 + pennantSpan / 2),
      );
      this.group.add(string);

      for (let i = 0; i < 7; i++) {
        // A pennant is a triangle hanging point-down off the string, which is
        // what bunting actually looks like — a rectangle would read as a flag.
        const pennant = new Mesh(
          new ConeGeometry(0.17, 0.42, 3),
          sharedStandard({ color: i % 2 === 0 ? ACCENT : ACCENT_2, roughness: 0.7 }),
        );
        pennant.material.side = DoubleSide;
        pennant.rotation.x = Math.PI;
        pennant.rotation.y = Math.PI / 2;
        pennant.position.set(
          side * (LANE_HALF_WIDTH - 0.14),
          DECK_Y + 1.5,
          laneZ(2.1 + i * 1.28),
        );
        this.banners.push(pennant);
        this.group.add(pennant);
      }
    }

    // A pool of light on the deck under the arch, so the crown's stage reads as
    // lit rather than merely coloured.
    const pool = new Mesh(
      new CircleGeometry(1.5, 28),
      new MeshBasicMaterial({
        color: ACCENT_2,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        fog: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, DECK_Y + 0.018, laneZ(LANE_MAX_Z - 0.9));
    pool.renderOrder = -1;
    this.group.add(pool);

    // ── Lighting this lane owns ─────────────────────────────────────────────
    // The shell contributes a dim neutral fill only, so a runtime that lit
    // nothing would present its cast as silhouettes. A warm key from the camera
    // side models the cones, a cool rim peels them off the dark deck, and a
    // point light under the arch makes the crown the brightest thing in frame.
    const key = new DirectionalLight(0xfff0dc, 2.1);
    key.position.set(4.5, 7, 6);
    const rim = new DirectionalLight(0x7d95ff, 0.95);
    rim.position.set(-5, 3.5, -6);
    this.crownLight = new PointLight(ACCENT_2, 14, 9, 2);
    this.crownLight.position.set(0, DECK_Y + 2.2, laneZ(LANE_MAX_Z - 0.4));
    this.group.add(key, rim, this.crownLight);
  }

  /**
   * Paint the in-world instruments.
   *
   * @param throwsLeft   throws the player still has
   * @param conesDown    cones felled this run
   * @param time         shared clock, for the pennant sway
   * @param reducedMotion when true nothing sways and nothing pulses; the pips
   *                      still read exactly as clearly, because they carry the
   *                      information in brightness rather than in movement
   */
  update(
    throwsLeft: number,
    conesDown: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    for (let i = 0; i < this.throwPips.length; i++) {
      const pip = this.throwPips[i];
      const live = i < throwsLeft;
      const material = pip.mesh.material as ReturnType<typeof ownStandard>;
      // The next throw up breathes; spent throws are dark studs in the timber.
      const pulse =
        live && !reducedMotion && i === throwsLeft - 1
          ? 0.35 * (0.5 + 0.5 * Math.sin(time * 4.5))
          : 0;
      material.emissiveIntensity = live ? pip.base + pulse : 0.02;
      pip.mesh.scale.setScalar(live ? 1 : 0.62);
    }
    // The cones rail fills up as you fell them, then fills again: it is a rack
    // meter, so a run that strikes and re-racks visibly starts the rail over
    // rather than pinning it full for the rest of the game. A completed lap is
    // held FULL rather than snapping to empty, so the instant after a strike
    // reads as "you cleared it", not "you lost your progress".
    const lap = conesDown % this.conePips.length;
    const filled = conesDown > 0 && lap === 0 ? this.conePips.length : lap;
    for (let i = 0; i < this.conePips.length; i++) {
      const pip = this.conePips[i];
      const lit = i < filled;
      const material = pip.mesh.material as ReturnType<typeof ownStandard>;
      material.emissiveIntensity = lit ? pip.base : 0;
      pip.mesh.scale.setScalar(lit ? 1 : 0.55);
    }

    if (reducedMotion) {
      for (const banner of this.banners) banner.rotation.z = 0;
      this.crownLight.intensity = 14;
      return;
    }
    for (let i = 0; i < this.banners.length; i++) {
      this.banners[i].rotation.z = Math.sin(time * 1.6 + i * 0.7) * 0.12;
    }
    // The crown light breathes slowly. Small enough to be felt rather than seen.
    this.crownLight.intensity = 14 + Math.sin(time * 1.1) * 2.2;
  }
}
