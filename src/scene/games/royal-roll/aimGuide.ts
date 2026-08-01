/**
 * The aim guide: the instrument the whole game is played through.
 *
 * Rendering-side only — it draws whatever angle the simulation says is armed
 * and decides nothing. Three parts, each answering a different question the
 * player is actually asking at the launch line:
 *
 *   the arc      "how far can I swing this?"  — the full legal range, dim, so
 *                 the bound is visible before you hit it rather than after
 *   the ticks    "how far have I swung it?"   — one mark per input increment,
 *                 lit up to the current aim, so the input is countable
 *   the line     "where will it go?"          — a run of chevrons down the aim,
 *                 fading out with distance because the guide is a hint, not a
 *                 trajectory readout
 *
 * That is deliberately more instrument than a single line would be: this screen
 * is a machine you operate, and a bare pointer would make it a form with a
 * slider on it.
 */
import {
  BoxGeometry,
  CircleGeometry,
  PlaneGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import {
  AIM_STEP,
  MAX_AIM,
  ROLLER_START_Z,
} from '../../../game/games/royal-roll/simulation.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';
import { DECK_DRESSING_TOP, laneZ } from './lane.ts';

/**
 * How many chevrons the guide throws down the lane, and how far apart.
 *
 * Sized to reach the front of the formation: a guide that peters out halfway is
 * worse than none, because the player then has to imagine the second half of
 * the line — which is exactly the half that decides the throw.
 */
const CHEVRONS = 9;
const CHEVRON_SPACING = 0.62;
/** Distinct aims either side of straight — one tick each. */
const TICKS = Math.round(MAX_AIM / AIM_STEP);
/**
 * How far down-lane the tick fan is drawn. Well clear of the roller: at the
 * launch line the fan would be hidden behind Gary's own body from the aiming
 * camera, which is where it is most needed.
 */
const TICK_RADIUS = 2.35;
/**
 * Where the reticle sits: just SHORT of the front rank.
 *
 * Deliberately in front of the cones rather than among them — drawn on top of
 * the rack it competes with the thing it is pointing at, and a ring around a
 * cone reads as "this one", which is a promise the physics does not make.
 */
const RETICLE_DISTANCE = 4.7;
/** Resting opacities. The guide is the instrument, so it is allowed to be seen. */
const ARC_OPACITY = 0.22;
/** The aim beam: wide and bright enough to read from the aiming pose. */
const BEAM_WIDTH = 0.3;
const BEAM_OPACITY = 0.4;
const TICK_DIM = 0.3;
const TICK_LIT = 1;

/** A chevron and the opacity it holds when the guide is fully shown. */
interface Chevron {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  readonly peak: number;
  readonly distance: number;
}

export class AimGuide {
  readonly group = new Group();

  private readonly pivot = new Group();
  private readonly chevrons: Chevron[] = [];
  private readonly ticks: { readonly mesh: Mesh; readonly material: MeshBasicMaterial; readonly angle: number }[] = [];
  private readonly arcMaterial: MeshBasicMaterial;
  private readonly beamMaterial: MeshBasicMaterial;
  private readonly reticle: Mesh;
  private readonly reticleMaterial: MeshBasicMaterial;
  /** 0 = hidden, 1 = fully shown. Eased by the runtime on phase change. */
  private shown = 1;

  constructor() {
    this.group.name = 'RoyalAimGuide';
    // Above the deck dressing (see DECK_DRESSING_TOP) — the guide is painted on
    // the road, and anything at or below that height is inside the runner box.
    this.group.position.set(0, DECK_DRESSING_TOP + 0.006, laneZ(ROLLER_START_Z));

    // ── The arc: the legal range, drawn once and never moved ────────────────
    this.arcMaterial = new MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: ARC_OPACITY,
      depthWrite: false,
      fog: false,
    });
    const arc = new Mesh(
      new RingGeometry(TICK_RADIUS - 0.5, TICK_RADIUS + 0.1, 48, 1, Math.PI / 2 - MAX_AIM, MAX_AIM * 2),
      this.arcMaterial,
    );
    // Laid flat on the deck. -90° about X maps the ring's own +Y to -Z, which
    // is down the lane — so a sweep centred on θ = 90° is already centred on
    // the lane axis. (A second rotation to "fix" that tips the ring back out of
    // the deck and it reads as a stray brown panel lying by the launch line.)
    arc.rotation.x = -Math.PI / 2;
    arc.renderOrder = 2;
    this.group.add(arc);

    // ── The ticks: one per input increment, so the aim is countable ─────────
    for (let i = -TICKS; i <= TICKS; i++) {
      const angle = i * AIM_STEP;
      const material = new MeshBasicMaterial({
        color: i === 0 ? ACCENT_2 : ACCENT,
        transparent: true,
        opacity: TICK_DIM,
        depthWrite: false,
        fog: false,
      });
      const mesh = new Mesh(
        new BoxGeometry(0.05, 0.01, i === 0 ? 0.42 : 0.26),
        material,
      );
      mesh.position.set(
        Math.sin(angle) * TICK_RADIUS,
        0,
        laneZ(Math.cos(angle) * TICK_RADIUS),
      );
      mesh.rotation.y = -angle;
      mesh.renderOrder = 3;
      this.ticks.push({ mesh, material, angle });
      this.group.add(mesh);
    }

    // ── The line: a beam down the armed aim, with chevrons riding on it ────
    // The beam is what makes the guide readable from the aiming pose. Nine
    // separate marks on a dark deck, seen at a grazing angle from eight units
    // back, foreshorten into specks; a continuous strip holds its width all the
    // way to the rack and gives the chevrons something to sit on.
    this.group.add(this.pivot);
    this.beamMaterial = new MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: BEAM_OPACITY,
      depthWrite: false,
      fog: false,
    });
    const beam = new Mesh(
      new PlaneGeometry(BEAM_WIDTH, RETICLE_DISTANCE - 1.2),
      this.beamMaterial,
    );
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0, laneZ(1.2 + (RETICLE_DISTANCE - 1.2) / 2));
    beam.renderOrder = 2;
    this.pivot.add(beam);
    for (let i = 0; i < CHEVRONS; i++) {
      // Starts clear of the roller's own body: chevrons drawn under Gary are
      // hidden by him from every pose that also shows the rack.
      const distance = 1.55 + i * CHEVRON_SPACING;
      // Nearest is brightest. The guide should be confident about where the
      // roller definitely goes and vaguer where the rack will decide — but it
      // never fades below "clearly there", because a guide you have to squint
      // at is not an instrument.
      const peak = 0.9 - 0.4 * (i / (CHEVRONS - 1));
      const material = new MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: peak,
        depthWrite: false,
        fog: false,
      });
      // Chevrons grow with distance, which is what stops perspective from
      // shrinking the far end of the line into nothing.
      const scale = 1 + i * 0.09;
      // A three-segment circle IS a flat triangle in the XY plane — the right
      // primitive for a mark PAINTED on the deck. (A ConeGeometry with three
      // radial segments is a pyramid, and laid down it reads as a wedge
      // sticking up out of the road rather than as a chevron on it.)
      const mesh = new Mesh(new CircleGeometry(0.21 * scale, 3), material);
      // Euler XYZ applies Z first: spin the triangle so its point is at +Y,
      // then lay the plane flat, which sends that point down the lane (-Z).
      mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      mesh.position.set(0, 0, laneZ(distance));
      mesh.renderOrder = 3;
      this.chevrons.push({ mesh, material, peak, distance });
      this.pivot.add(mesh);
    }

    // ── The reticle: where the line meets the front of the formation ───────
    // The one part of the guide that says "here", not "that way". It rides on
    // the pivot with the chevrons, so it tracks the aim exactly.
    this.reticleMaterial = new MeshBasicMaterial({
      color: ACCENT_2,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
    });
    this.reticle = new Mesh(
      new RingGeometry(0.34, 0.42, 28),
      this.reticleMaterial,
    );
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.position.set(0, 0, laneZ(RETICLE_DISTANCE));
    this.reticle.renderOrder = 4;
    this.pivot.add(this.reticle);
  }

  /**
   * Point the guide and set how visible it is.
   *
   * @param angle          the armed aim, radians
   * @param visibility     0..1, eased by the runtime so the guide fades on
   *                       launch rather than vanishing
   * @param time           shared clock, for the travelling highlight
   * @param reducedMotion  true stills the highlight; the guide keeps every bit
   *                       of its information, it just stops crawling
   */
  update(angle: number, visibility: number, time: number, reducedMotion: boolean): void {
    this.shown = Math.max(0, Math.min(1, visibility));
    this.group.visible = this.shown > 0.01;
    if (!this.group.visible) return;

    // The pivot carries the whole chevron line, so aiming is one rotation
    // rather than seven repositions.
    this.pivot.rotation.y = -angle;

    for (let i = 0; i < this.chevrons.length; i++) {
      const chevron = this.chevrons[i];
      // A highlight travelling away down the line: the guide reads as pointing
      // rather than merely existing. Purely opacity — no layout moves.
      const travel = reducedMotion
        ? 0
        : 0.1 * Math.max(0, Math.sin(time * 2.6 - i * 0.55));
      chevron.material.opacity = Math.min(1, chevron.peak + travel) * this.shown;
    }

    for (const tick of this.ticks) {
      // Ticks between straight and the current aim light up; the rest stay dim.
      // The player can literally count how many presses they are from centre.
      const inRange =
        (angle >= 0 && tick.angle >= -1e-6 && tick.angle <= angle + 1e-6) ||
        (angle <= 0 && tick.angle <= 1e-6 && tick.angle >= angle - 1e-6);
      tick.material.opacity = (inRange ? TICK_LIT : TICK_DIM) * this.shown;
      tick.mesh.scale.y = inRange ? 1.6 : 1;
    }

    // The reticle breathes so the eye lands on it first — the one place on the
    // deck the whole decision comes down to.
    const breath = reducedMotion ? 0 : 0.06 * Math.sin(time * 3.2);
    this.reticle.scale.setScalar(1 + breath);
    this.reticleMaterial.opacity = (0.85 + breath) * this.shown;
    this.beamMaterial.opacity = BEAM_OPACITY * this.shown;
    this.arcMaterial.opacity = ARC_OPACITY * this.shown;
  }
}
