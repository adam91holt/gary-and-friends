/**
 * Royal Roll's particle layer.
 *
 * Rendering-side wrapper only: the simulation is the shared pure pool in
 * `src/game/fx/particles.ts`, which owns every number and writes straight into
 * the flat arrays a `BufferGeometry` wants. This file decides nothing about
 * motion — it builds two `Points` clouds, feeds the pool the emit parameters
 * for the three things that happen on this lane (a cone taking a hit, the
 * roller scuffing the deck, the crown going over) and flags the buffers dirty.
 *
 * Two pools, not one, for the same reason the highway has three: chalk dust off
 * the deck wants normal blending and a short life, while sparks want additive
 * blending and a longer hold — sharing a pool would let one starve the other
 * and force one blend mode on both.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  NormalBlending,
  Points,
  PointsMaterial,
  type Blending,
  type Texture,
} from 'three';
import { createRng, type Rng } from '../../../game/entities/rng.ts';
import { Particles } from '../../../game/fx/particles.ts';
import { friendProfile } from '../../../game/friends/roster.ts';
import { ACCENT, ACCENT_2 } from '../../../theme.ts';

/** Linear RGB triple from a packed hex colour, for the pure layer's `color`. */
function rgb(hex: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

const DUST_COLOR = rgb(0xb2adc0);
const GOLD = rgb(ACCENT_2);
const ORANGE = rgb(ACCENT);

/** Seeded, never `Math.random()`: a screenshot after a scripted throw matches. */
const FX_SEED = 0x1c0e5;

/**
 * A soft round sprite drawn into a canvas at boot. Procedural on purpose — no
 * runtime asset fetch, and square GL points read as pixel litter where a radial
 * falloff reads as a puff.
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

class Pool {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly position: BufferAttribute;
  private readonly color: BufferAttribute;
  private readonly alpha: BufferAttribute;

  constructor(
    readonly system: Particles,
    sprite: Texture,
    options: { readonly size: number; readonly opacity: number; readonly blending: Blending },
  ) {
    this.position = new BufferAttribute(system.positions, 3);
    this.color = new BufferAttribute(system.colors, 3);
    this.alpha = new BufferAttribute(system.alphas, 1);
    this.position.setUsage(DynamicDrawUsage);
    this.color.setUsage(DynamicDrawUsage);
    this.alpha.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('color', this.color);
    this.geometry.setAttribute('alpha', this.alpha);

    const material = new PointsMaterial({
      size: options.size,
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      blending: options.blending,
      sizeAttenuation: true,
    });
    // The pure layer exposes a per-particle alpha; patch it into the shader so
    // every pool fades cleanly instead of muddying its tint.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float alpha;\nvarying float vParticleAlpha;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvParticleAlpha = alpha;',
      );
      shader.fragmentShader = `varying float vParticleAlpha;\n${shader.fragmentShader}`.replace(
        '#include <alphatest_fragment>',
        'diffuseColor.a *= vParticleAlpha;\n#include <alphatest_fragment>',
      );
    };
    material.customProgramCacheKey = () => 'particle-alpha-v1';
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    this.system.update(dt);
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

export class RoyalFx {
  readonly group = new Group();

  private readonly dust: Pool;
  private readonly sparks: Pool;
  private rng: Rng = createRng(FX_SEED);
  /** Distance-based cadence for the roller's deck scuff. */
  private scuffTimer = 0;

  constructor() {
    this.group.name = 'RoyalFx';
    const sprite = createSpriteTexture();
    this.dust = new Pool(
      new Particles({ capacity: 300, gravity: -3.6, drag: 1.7, fade: 1.4 }),
      sprite,
      { size: 0.13, opacity: 0.5, blending: NormalBlending },
    );
    this.sparks = new Pool(
      new Particles({ capacity: 360, gravity: -4.2, drag: 1.2, fade: 2 }),
      sprite,
      { size: 0.11, opacity: 0.95, blending: AdditiveBlending },
    );
    this.group.add(this.dust.points, this.sparks.points);
  }

  /** Live particles across both pools. Projected onto the runtime's snapshot. */
  get liveCount(): number {
    return this.dust.system.aliveCount + this.sparks.system.aliveCount;
  }

  /**
   * A contact: sparks scaled to how hard it actually was, so a graze is a flick
   * and a full-speed hit into the front rank is a burst. `strength` is the
   * closing speed the solver resolved — the fx cannot exaggerate a hit that
   * did not happen.
   */
  impact(x: number, y: number, z: number, strength: number): void {
    const power = Math.min(1, strength / 7);
    this.sparks.system.emit(
      {
        x,
        y,
        z,
        count: Math.round(6 + power * 22),
        speed: 1 + power * 2.4,
        speedJitter: 1.2 + power * 2.2,
        lift: 1.4 + power * 2.6,
        life: 0.28,
        lifeJitter: 0.24,
        color: GOLD,
        colorJitter: 0.35,
        spread: 0.14,
      },
      this.rng,
    );
  }

  /** A cone going over: its own tint, thrown in the direction it was hit. */
  knock(x: number, y: number, z: number, variant: number): void {
    this.sparks.system.emit(
      {
        x,
        y,
        z,
        count: 26,
        speed: 2.2,
        speedJitter: 2.1,
        lift: 3,
        life: 0.5,
        lifeJitter: 0.3,
        color: rgb(friendProfile(variant).tint),
        colorJitter: 0.3,
        spread: 0.16,
      },
      this.rng,
    );
  }

  /** The crown falls: the biggest burst on the lane, in the royal gold. */
  royal(x: number, y: number, z: number): void {
    this.sparks.system.emit(
      {
        x,
        y,
        z,
        count: 70,
        speed: 3.4,
        speedJitter: 3.6,
        lift: 5.5,
        life: 0.95,
        lifeJitter: 0.6,
        color: GOLD,
        colorJitter: 0.25,
        spread: 0.24,
      },
      this.rng,
    );
    this.sparks.system.emit(
      {
        x,
        y: y + 0.2,
        z,
        count: 22,
        speed: 1.6,
        speedJitter: 1.8,
        lift: 3.4,
        life: 0.7,
        lifeJitter: 0.4,
        color: ORANGE,
        colorJitter: 0.2,
        spread: 0.14,
      },
      this.rng,
    );
  }

  /**
   * Deck chalk kicked up under the roller, on a DISTANCE cadence rather than a
   * time one — so the trail thickens with speed and thins as the roll dies,
   * which is the visual the solver's friction curve is already producing.
   */
  scuff(dt: number, x: number, z: number, speed: number): void {
    if (speed <= 0.3) return;
    this.scuffTimer -= dt * speed;
    if (this.scuffTimer > 0) return;
    this.scuffTimer = 0.35;
    this.dust.system.emit(
      {
        x,
        y: 0.06,
        z,
        count: 3,
        speed: 0.35,
        speedJitter: 0.7,
        lift: 0.8,
        life: 0.42,
        lifeJitter: 0.26,
        color: DUST_COLOR,
        colorJitter: 0.4,
        spread: 0.16,
      },
      this.rng,
    );
  }

  /** A barrier hit: a thin flick of grit off the timber. */
  barrier(x: number, z: number, strength: number): void {
    this.dust.system.emit(
      {
        x,
        y: 0.16,
        z,
        count: 8,
        speed: 0.8 + Math.min(2, strength * 0.3),
        speedJitter: 1.4,
        lift: 1.1,
        life: 0.34,
        lifeJitter: 0.2,
        color: DUST_COLOR,
        colorJitter: 0.3,
        spread: 0.1,
      },
      this.rng,
    );
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
  }

  /** Wipe both pools — a restart must not inherit the last run's sparks. */
  clear(): void {
    this.dust.system.clear();
    this.sparks.system.clear();
    this.scuffTimer = 0;
    this.rng = createRng(FX_SEED);
    this.update(0);
  }
}
