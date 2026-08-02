/**
 * Stack Attack's particle layer: landing dust, sheared-off debris and the
 * perfect-drop sparkle.
 *
 * Rendering-side only. Every number a particle obeys comes from the pure
 * `Particles` pools in `src/game/fx/particles.ts` — this file owns the
 * `BufferGeometry`/`Points` wrapper and the emission recipes, and decides no
 * motion of its own.
 *
 * Two pools rather than one, for the same reason the highway has three: grit
 * wants normal blending so concrete dust stays material, while the perfect
 * sparkle wants additive so it reads as light. One pool would force one blend
 * mode and make one of the two look wrong.
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

function rgb(hex: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

const GRIT_COLOR = rgb(0xa9a4b8);
const SPARK_COLOR = rgb(ACCENT_2);
const ACCENT_COLOR = rgb(ACCENT);

/** Seeded so a screenshot taken after a scripted sequence looks the same. */
const DUST_SEED = 0x51a0;

/** A soft round sprite drawn at boot — square GL points read as pixel litter. */
function createSprite(): Texture {
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
    options: { size: number; opacity: number; blending: Blending },
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
    // Same per-particle alpha injection the highway's pools use, so both games
    // fade through the simulation's alpha attribute rather than the material.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float alpha;\nvarying float vParticleAlpha;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleAlpha = alpha;');
      shader.fragmentShader = `varying float vParticleAlpha;\n${shader.fragmentShader}`
        .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vParticleAlpha;\n#include <alphatest_fragment>');
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

export class TowerDust {
  readonly group = new Group();

  private readonly grit: Pool;
  private readonly sparks: Pool;
  private rng: Rng = createRng(DUST_SEED);

  constructor() {
    this.group.name = 'TowerDust';
    const sprite = createSprite();
    // Heavy, short-lived concrete grit that falls back onto the stack.
    this.grit = new Pool(
      new Particles({ capacity: 320, gravity: -7.5, drag: 2.1, fade: 1.3 }),
      sprite,
      { size: 0.13, opacity: 0.55, blending: NormalBlending },
    );
    // Light, floaty, additive — the reward sparkle.
    this.sparks = new Pool(
      new Particles({ capacity: 260, gravity: -1.4, drag: 1.2, fade: 2.2 }),
      sprite,
      { size: 0.12, opacity: 0.95, blending: AdditiveBlending },
    );
    this.group.add(this.grit.points, this.sparks.points);
  }

  /** Live particles across both pools. Projected onto the runtime's snapshot. */
  get liveCount(): number {
    return this.grit.system.aliveCount + this.sparks.system.aliveCount;
  }

  /**
   * A cone touching down: a low ring of grit punched out sideways from the
   * contact plane. `width` scales the burst, so landing a fat Big Dave throws
   * more dust than landing Tiny — the impact you see matches the mass you saw.
   */
  landing(x: number, y: number, width: number): void {
    this.grit.system.emit(
      {
        x,
        y: y + 0.05,
        z: 0,
        count: 22,
        speed: 1.5 + width * 0.6,
        speedJitter: 1.9,
        lift: 1.2,
        life: 0.42,
        lifeJitter: 0.28,
        color: GRIT_COLOR,
        colorJitter: 0.42,
        spread: width * 0.4,
      },
      this.rng,
    );
  }

  /**
   * The overhang being sheared off: debris in the dropped cone's own tint,
   * thrown out on the side it hung over. It is the only feedback that says
   * *which way* you were late, so it is directional on purpose.
   */
  trim(x: number, y: number, variant: number, side: number): void {
    this.grit.system.emit(
      {
        x,
        y: y + 0.18,
        z: 0,
        count: 16,
        speed: 2.4,
        speedJitter: 2.2,
        lift: 2.4,
        life: 0.7,
        lifeJitter: 0.4,
        color: rgb(friendProfile(variant).tint),
        colorJitter: 0.3,
        spread: 0.14,
        direction: Math.sign(side) || 1,
      },
      this.rng,
    );
  }

  /**
   * The perfect drop: a tight upward fountain of accent sparks. Bigger with the
   * combo, so a streak is visibly escalating rather than repeating — the reward
   * has to keep paying or the player stops chasing it.
   */
  perfect(x: number, y: number, combo: number): void {
    const scale = Math.min(1 + combo * 0.22, 2.6);
    this.sparks.system.emit(
      {
        x,
        y: y + 0.2,
        z: 0,
        count: Math.round(20 * scale),
        speed: 1.1,
        speedJitter: 1.5,
        lift: 3.4 * scale,
        life: 0.65,
        lifeJitter: 0.4,
        color: SPARK_COLOR,
        colorJitter: 0.25,
        spread: 0.22,
      },
      this.rng,
    );
    this.sparks.system.emit(
      {
        x,
        y: y + 0.1,
        z: 0,
        count: 10,
        speed: 2.2 * scale,
        speedJitter: 1.4,
        lift: 0.8,
        life: 0.4,
        lifeJitter: 0.25,
        color: ACCENT_COLOR,
        colorJitter: 0.2,
        spread: 0.1,
      },
      this.rng,
    );
  }

  /** The miss: the cone that fell past the tower, coming apart on the deck. */
  collapse(x: number, variant: number): void {
    this.grit.system.emit(
      {
        x,
        y: 0.1,
        z: 0,
        count: 40,
        speed: 3.4,
        speedJitter: 3,
        lift: 2.6,
        life: 1,
        lifeJitter: 0.6,
        color: rgb(friendProfile(variant).tint),
        colorJitter: 0.45,
        spread: 0.3,
      },
      this.rng,
    );
  }

  update(dt: number): void {
    this.grit.update(dt);
    this.sparks.update(dt);
  }

  /** Wipe both pools — a restart must not inherit the last miss's debris. */
  clear(): void {
    this.grit.system.clear();
    this.sparks.system.clear();
    this.rng = createRng(DUST_SEED);
    this.update(0);
  }
}
