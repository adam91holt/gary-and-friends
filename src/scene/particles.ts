/**
 * The visual layer for the particle systems.
 *
 * Rendering-side only: it wraps the pure `Particles` pools (src/game/fx/) in a
 * `BufferGeometry` + `Points` and uploads their flat arrays each frame. It
 * decides nothing about motion — the simulation owns every number here.
 *
 * ── Why three pools, not one ────────────────────────────────────────────────
 * Dust, sparks and debris want genuinely different physics and point sizes, and
 * a single pool would let a crash's 90-particle burst starve the continuous
 * road dust of slots. Separate pools also mean separate draw calls with the
 * right blend and size per family — still only three, which is nothing.
 *
 * All pools are additive because the pure simulation fades vertex colour to
 * black. Under additive blending black is transparent; inactive slots are also
 * parked outside the scene. Dust stays soft and understated through its muted
 * tint and lower material opacity rather than alpha blending black sprites.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  Points,
  PointsMaterial,
  type Texture,
} from 'three';
import { Particles } from '../game/fx/particles.ts';
import { createRng, type Rng } from '../game/entities/rng.ts';
import { friendProfile } from '../game/friends/roster.ts';
import { ACCENT, ACCENT_2 } from '../theme.ts';

/** Linear RGB triple from a packed hex colour, for the pure layer's `color`. */
function rgb(hex: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

const DUST_COLOR = rgb(0xb9b4c6);
const SPARK_COLOR = rgb(ACCENT_2);
const DEBRIS_COLOR = rgb(ACCENT);
const WHITE = rgb(0xfff3e2);

/**
 * A soft round sprite, drawn into a canvas at boot. Procedural on purpose: no
 * runtime asset fetch (CSP-safe, matches the rest of the game's no-assets rule)
 * and the falloff can be tuned here rather than in an image editor.
 *
 * Square GL points read as pixel litter; a radial falloff reads as a puff.
 */
function createSpriteTexture(): Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface PoolOptions {
  readonly size: number;
  readonly opacity: number;
}

class Pool {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly position: BufferAttribute;
  private readonly color: BufferAttribute;

  constructor(
    readonly system: Particles,
    sprite: Texture,
    options: PoolOptions,
  ) {
    this.position = new BufferAttribute(system.positions, 3);
    this.color = new BufferAttribute(system.colors, 3);
    this.position.setUsage(DynamicDrawUsage);
    this.color.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('color', this.color);

    const material = new PointsMaterial({
      size: options.size,
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
  }

  /** Step the pure system, then flag both attribute buffers for upload. */
  update(dt: number): void {
    this.system.update(dt);
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}

/**
 * How far behind Gary road dust is kicked up (world units). Slightly behind him
 * so the plume trails from his base rather than engulfing him.
 */
const DUST_Z = 0.45;
const PARTICLE_SEED = 0x9e37;

export class ParticleFx {
  readonly group = new Group();

  private readonly dust: Pool;
  private readonly sparks: Pool;
  private readonly debris: Pool;
  /**
   * Seeded, not `Math.random()`: the same rule the spawn logic follows, so a
   * screenshot taken after a scripted sequence looks the same every run.
   */
  private rng: Rng = createRng(PARTICLE_SEED);
  /** Time until the next continuous road-dust puff. */
  private dustTimer = 0;
  /**
   * The road speed last reported by the loop. Every emitter reads it, because
   * the whole scene is drawn in Gary's frame: the road rushes past at `speed`,
   * so anything shed onto it must travel back at very nearly `speed` too. Give
   * a particle a fixed drift instead and it hangs in the air like lens dirt —
   * which is precisely what makes cheap particle work look cheap.
   */
  private roadSpeed = 0;

  constructor() {
    this.group.name = 'ParticleFx';
    const sprite = createSpriteTexture();

    // Road grit: heavy, short-lived, dragged back by the road rushing past.
    // Sizes are deliberately small: at these distances a 0.3-unit point is a
    // fat disc, and a spray of fine specks reads as *dust* where a handful of
    // big soft circles reads as bokeh.
    this.dust = new Pool(
      new Particles({ capacity: 340, gravity: -3.4, drag: 1.6, fade: 1.4 }),
      sprite,
      { size: 0.19, opacity: 0.5 },
    );
    // Pickup sparks: light, floaty, tinted to the friend who just joined.
    this.sparks = new Pool(
      new Particles({ capacity: 340, gravity: -2.6, drag: 1.3, fade: 2.1 }),
      sprite,
      { size: 0.15, opacity: 0.95 },
    );
    // Crash debris: fast, ballistic, and it hangs around to sit under the card.
    this.debris = new Pool(
      new Particles({ capacity: 220, gravity: -11, drag: 0.55, fade: 1.2 }),
      sprite,
      { size: 0.17, opacity: 1 },
    );

    this.group.add(this.dust.points, this.sparks.points, this.debris.points);
  }

  /** Live particles across every pool. Projected onto the test API. */
  get liveCount(): number {
    return (
      this.dust.system.aliveCount +
      this.sparks.system.aliveCount +
      this.debris.system.aliveCount
    );
  }

  /** Keep event bursts in the same moving frame as the scrolling road. */
  setRoadSpeed(speed: number): void {
    this.roadSpeed = Math.max(0, speed);
  }

  /**
   * Continuous road dust under Gary while a run is under way. Emitted on a
   * distance-based cadence rather than a time-based one, so the plume thickens
   * with speed instead of thinning out as the road accelerates past it.
   */
  road(dt: number, x: number, speed: number): void {
    this.setRoadSpeed(speed);
    if (speed <= 0) return;
    this.dustTimer -= dt * speed;
    if (this.dustTimer > 0) return;
    this.dustTimer = 0.4; // world units between puffs

    this.dust.system.emit(
      {
        x,
        y: 0.05,
        z: DUST_Z,
        count: 4,
        speed: 0.5,
        speedJitter: 0.9,
        lift: 1.1,
        life: 0.5,
        lifeJitter: 0.3,
        color: DUST_COLOR,
        colorJitter: 0.45,
        // ~road speed: the plume streams away behind him instead of hanging in
        // the air as static grit. A hair under, so it still reads as *lagging*
        // rather than being fired backward out of the cone.
        drift: speed * 0.88,
        spread: 0.26,
      },
      this.rng,
    );
  }

  /**
   * The hop puff: a bigger kick thrown sideways when Gary changes lane. The
   * outward speed is signed by the direction of travel, so the dust sprays off
   * the lane he is leaving — the visual echo of the input he just gave.
   */
  hop(x: number, direction: number): void {
    this.dust.system.emit(
      {
        x: x - direction * 0.2,
        y: 0.05,
        z: DUST_Z,
        count: 26,
        speed: 1.5,
        speedJitter: 1.6,
        lift: 1.9,
        life: 0.5,
        lifeJitter: 0.3,
        color: DUST_COLOR,
        colorJitter: 0.4,
        drift: this.roadSpeed * 0.8,
        spread: 0.28,
        direction: -Math.sign(direction),
      },
      this.rng,
    );
  }

  /**
   * The collect pop: a ring of sparks in the friend's own tint plus a warm
   * white core, so a pickup reads as a burst of *that character*, not a generic
   * confetti puff. The tint comes from the shared roster, so the spark, the
   * cone, and the HUD chip are the same colour by construction.
   */
  pop(x: number, variant: number): void {
    const tint = rgb(friendProfile(variant).tint);
    this.sparks.system.emit(
      {
        x,
        y: 0.55,
        z: 0.1,
        count: 38,
        speed: 2.6,
        speedJitter: 2.4,
        lift: 3.1,
        life: 0.55,
        lifeJitter: 0.35,
        color: tint,
        colorJitter: 0.3,
        drift: this.roadSpeed * 0.6,
        spread: 0.2,
      },
      this.rng,
    );
    this.sparks.system.emit(
      {
        x,
        y: 0.6,
        z: 0.1,
        count: 10,
        speed: 1.1,
        speedJitter: 1.2,
        lift: 2.2,
        life: 0.38,
        lifeJitter: 0.2,
        color: WHITE,
        colorJitter: 0.15,
        drift: this.roadSpeed * 0.6,
        spread: 0.12,
      },
      this.rng,
    );
  }

  /** A thin spray of sparks flicked off a vehicle Gary just shaved past. */
  nearMiss(x: number, direction: number): void {
    this.sparks.system.emit(
      {
        x: x + direction * 0.45,
        y: 0.5,
        z: 0.2,
        count: 12,
        speed: 1.4,
        speedJitter: 2.6,
        lift: 1.2,
        life: 0.3,
        lifeJitter: 0.2,
        color: SPARK_COLOR,
        colorJitter: 0.35,
        drift: this.roadSpeed * 0.9,
        spread: 0.3,
        direction: Math.sign(direction),
      },
      this.rng,
    );
  }

  /**
   * The crash: a heavy two-part burst — orange shrapnel thrown up and out, plus
   * a low sheet of dust off the road, so the impact has both a spark and a
   * scuff. Fired once, at the moment of the squash.
   */
  crash(x: number): void {
    this.debris.system.emit(
      {
        x,
        y: 0.7,
        z: 0,
        count: 54,
        speed: 3.6,
        speedJitter: 4.2,
        lift: 6.5,
        life: 1.1,
        lifeJitter: 0.7,
        color: DEBRIS_COLOR,
        colorJitter: 0.4,
        drift: this.roadSpeed * 0.9,
        spread: 0.35,
      },
      this.rng,
    );
    this.debris.system.emit(
      {
        x,
        y: 0.9,
        z: 0,
        count: 18,
        speed: 2.4,
        speedJitter: 2.6,
        lift: 4.4,
        life: 0.8,
        lifeJitter: 0.5,
        color: WHITE,
        colorJitter: 0.2,
        drift: this.roadSpeed * 0.9,
        spread: 0.3,
      },
      this.rng,
    );
    this.dust.system.emit(
      {
        x,
        y: 0.05,
        z: 0.1,
        count: 34,
        speed: 3.2,
        speedJitter: 2.4,
        lift: 0.9,
        life: 0.9,
        lifeJitter: 0.5,
        color: DUST_COLOR,
        colorJitter: 0.4,
        drift: this.roadSpeed * 0.95,
        spread: 0.3,
      },
      this.rng,
    );
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
    this.debris.update(dt);
  }

  /** Wipe every pool — a restart must not inherit the last crash's debris. */
  clear(): void {
    this.dust.system.clear();
    this.sparks.system.clear();
    this.debris.system.clear();
    this.dustTimer = 0;
    this.roadSpeed = 0;
    this.rng = createRng(PARTICLE_SEED);
    this.update(0);
  }
}
