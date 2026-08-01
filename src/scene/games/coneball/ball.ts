/**
 * The ball, and the trail behind it.
 *
 * The ball's drawn radius is `BALL_RADIUS` — the collider's radius, not an
 * artistic approximation of it. Anything else and the player would be reading a
 * lie about where the ball is.
 *
 * ── The trail ───────────────────────────────────────────────────────────────
 * A ring of small spheres holding the ball's recent positions, scaled and faded
 * back through the tail. Deliberately a POSITION history rather than a stretched
 * mesh: at these speeds and with reflections this sharp, a stretched blur points
 * the wrong way for a frame after every bounce, whereas a history is always
 * exactly where the ball actually was — so the trail reads as evidence of the
 * line the ball took, which is the thing the player is trying to anticipate.
 *
 * Reduced motion drops the trail entirely (it is smear, and it is the one piece
 * of this screen that could induce motion discomfort) while the ball keeps its
 * full brightness and its contact flash, so nothing legible is lost.
 */
import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  PointLight,
  SphereGeometry,
} from 'three';
import { BALL_RADIUS } from '../../../game/games/coneball/arena.ts';
import { ownStandard } from '../../../render/materials.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/** How many positions the trail remembers. */
const TRAIL_LENGTH = 14;
/** Seconds between trail samples. Fixed, so the tail's length is speed-honest. */
const TRAIL_INTERVAL = 1 / 90;

export class Ball {
  readonly group = new Group();

  private readonly core: Mesh;
  /** The core's own (uncached) material. Held typed, because it is animated. */
  private readonly coreMaterial: MeshStandardMaterial;
  private readonly halo: Mesh;
  private readonly haloMaterial: MeshBasicMaterial;
  /** The ball's own light. It is the brightest thing on a dark court. */
  private readonly light: PointLight;
  private readonly trail: Mesh[] = [];
  private readonly trailMaterials: MeshBasicMaterial[] = [];
  /** Ring buffer of recent positions, newest last. */
  private readonly history: Array<{ x: number; z: number }> = [];
  private sampleTimer = 0;
  /** 0..1, set on every contact and decayed each frame. */
  private flash = 0;

  constructor() {
    this.group.name = 'ConeballBall';

    this.coreMaterial = ownStandard({
      color: ACCENT_2,
      roughness: 0.25,
      metalness: 0.1,
      emissive: ACCENT,
      emissiveIntensity: 1.4,
    });
    this.core = new Mesh(
      new SphereGeometry(BALL_RADIUS, 22, 18),
      this.coreMaterial,
    );
    this.group.add(this.core);

    this.haloMaterial = new MeshBasicMaterial({
      color: ACCENT_2,
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.halo = new Mesh(
      new SphereGeometry(BALL_RADIUS * 1.8, 16, 12),
      this.haloMaterial,
    );
    this.group.add(this.halo);

    this.light = new PointLight(ACCENT, 6, 9, 2);
    this.group.add(this.light);

    // The tail. One shared geometry, one material per link so each can fade.
    const geometry = new SphereGeometry(BALL_RADIUS, 10, 8);
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const fade = 1 - i / TRAIL_LENGTH;
      const material = new MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.34 * fade * fade,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const link = new Mesh(geometry, material);
      link.scale.setScalar(0.28 + fade * 0.62);
      link.visible = false;
      this.trailMaterials.push(material);
      this.trail.push(link);
    }
  }

  /** The trail links live in the runtime's root, not under the moving ball. */
  get trailMeshes(): readonly Mesh[] {
    return this.trail;
  }

  /** The ball hit something. `strength` 0..1 scales the flash. */
  hit(strength = 1): void {
    this.flash = Math.min(1, this.flash + strength);
  }

  /**
   * Place the ball, sample the trail and animate the glow.
   *
   * @param live whether the ball is in play (a held ball has no trail)
   */
  update(
    x: number,
    z: number,
    live: boolean,
    dt: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    this.group.position.set(x, BALL_RADIUS + 0.22, z);
    this.flash *= Math.exp(-7 * dt);

    // Spin, so the orb reads as an object rather than a decal. Reduced motion
    // stills it; the ball is still plainly the brightest thing in frame.
    this.core.rotation.y = reducedMotion ? 0 : time * 3.4;
    this.core.rotation.x = reducedMotion ? 0 : time * 2.1;

    this.coreMaterial.emissiveIntensity = 1.3 + this.flash * 3.2;
    this.haloMaterial.opacity = 0.26 + this.flash * 0.5;
    this.halo.scale.setScalar(1 + this.flash * 0.4);
    this.light.intensity = 5 + this.flash * 9;

    if (reducedMotion || !live) {
      this.clearTrail();
      return;
    }

    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = TRAIL_INTERVAL;
      this.history.push({ x, z });
      while (this.history.length > TRAIL_LENGTH) this.history.shift();
    }

    // Newest sample first, so the brightest link sits closest to the ball.
    for (let i = 0; i < this.trail.length; i++) {
      const sample = this.history[this.history.length - 1 - i];
      const link = this.trail[i];
      if (!sample) {
        link.visible = false;
        continue;
      }
      link.visible = true;
      link.position.set(sample.x, BALL_RADIUS + 0.22, sample.z);
    }
  }

  /** Hide the ball entirely (it is in Coneelia's hands — she draws it). */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) this.clearTrail();
  }

  /** Wipe the tail. A restart must not inherit the last rally's line. */
  clearTrail(): void {
    this.history.length = 0;
    for (const link of this.trail) link.visible = false;
  }

  /** Back to rest between runs. */
  reset(): void {
    this.flash = 0;
    this.sampleTimer = 0;
    this.clearTrail();
  }
}
