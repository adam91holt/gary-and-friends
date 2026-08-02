/**
 * Contact sparks for Big Bounce.
 *
 * A thin wrapper over the SAME pure `Particles` pool the highway's fx layer
 * uses (`game/fx/particles.ts`), for the same reason: the physics is pure and
 * unit-tested, this only owns the `Points` and the emit recipes. Nothing here
 * decides where a particle goes.
 *
 * Two pools, because they want different physics: bright weightless sparks off
 * a bounce, and heavier debris off a smashed drum that actually falls.
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
import { createRng, type Rng } from '../../../game/entities/rng.ts';
import { Particles } from '../../../game/fx/particles.ts';
import { ACCENT, ACCENT_2, FRIEND_TINTS } from '../../../theme.ts';

/** Linear RGB triple from a packed hex colour, for the pure layer's `color`. */
function rgb(hex: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

const SPARK_COLOR = rgb(ACCENT_2);
const WALL_COLOR = rgb(ACCENT);
const WHITE = rgb(0xfff3e2);
const DRUM_COLORS = [rgb(FRIEND_TINTS[4]), rgb(FRIEND_TINTS[1]), rgb(FRIEND_TINTS[3])];

const SEED = 0x51ab;

/** A soft round sprite. Procedural, like the highway's — no runtime asset fetch. */
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
  private readonly position: BufferAttribute;
  private readonly color: BufferAttribute;
  private readonly alpha: BufferAttribute;

  constructor(readonly system: Particles, sprite: Texture, size: number) {
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(system.positions, 3);
    this.color = new BufferAttribute(system.colors, 3);
    this.alpha = new BufferAttribute(system.alphas, 1);
    this.position.setUsage(DynamicDrawUsage);
    this.color.setUsage(DynamicDrawUsage);
    this.alpha.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    geometry.setAttribute('alpha', this.alpha);

    const material = new PointsMaterial({
      size,
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    // Same per-particle alpha injection the highway's pools use, and the same
    // cache key, so the two games share one compiled program.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float alpha;\nvarying float vParticleAlpha;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleAlpha = alpha;');
      shader.fragmentShader = `varying float vParticleAlpha;\n${shader.fragmentShader}`
        .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vParticleAlpha;\n#include <alphatest_fragment>');
    };
    material.customProgramCacheKey = () => 'particle-alpha-v1';
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    this.system.update(dt);
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

export class Sparks {
  readonly group = new Group();

  private readonly sparks: Pool;
  private readonly debris: Pool;
  private rng: Rng = createRng(SEED);

  constructor() {
    this.group.name = 'ConeballSparks';
    const sprite = createSprite();
    // Bounce sparks: light, fast, gone in a third of a second.
    this.sparks = new Pool(
      new Particles({ capacity: 300, gravity: -2.2, drag: 2.4, fade: 1.7 }),
      sprite,
      0.13,
    );
    // Drum shrapnel: heavier, ballistic, and it falls.
    this.debris = new Pool(
      new Particles({ capacity: 260, gravity: -9.5, drag: 0.7, fade: 1.2 }),
      sprite,
      0.16,
    );
    this.group.add(this.sparks.points, this.debris.points);
  }

  /** Live particles across both pools. Projected onto the runtime's snapshot. */
  get liveCount(): number {
    return this.sparks.system.aliveCount + this.debris.system.aliveCount;
  }

  /** A bounce off a barrier or the gantry. */
  wall(x: number, y: number, z: number): void {
    this.sparks.system.emit(
      {
        x, y, z,
        count: 12,
        speed: 1.6,
        speedJitter: 2.2,
        lift: 1.4,
        life: 0.26,
        lifeJitter: 0.16,
        color: WALL_COLOR,
        colorJitter: 0.3,
        spread: 0.08,
      },
      this.rng,
    );
  }

  /** A return off the board. Bigger than a wall tap: the player did this one. */
  paddle(x: number, y: number, z: number): void {
    this.sparks.system.emit(
      {
        x, y, z,
        count: 26,
        speed: 2.4,
        speedJitter: 2.8,
        lift: 2.6,
        life: 0.36,
        lifeJitter: 0.24,
        color: SPARK_COLOR,
        colorJitter: 0.28,
        spread: 0.14,
      },
      this.rng,
    );
    this.sparks.system.emit(
      {
        x, y, z,
        count: 8,
        speed: 1.1,
        speedJitter: 1.3,
        lift: 1.9,
        life: 0.24,
        lifeJitter: 0.14,
        color: WHITE,
        colorJitter: 0.12,
        spread: 0.08,
      },
      this.rng,
    );
  }

  /** A drum bursting: shrapnel in that row's own colour, plus a white core. */
  target(x: number, y: number, z: number, row: number): void {
    this.debris.system.emit(
      {
        x, y, z,
        count: 34,
        speed: 3.1,
        speedJitter: 3.4,
        lift: 4.2,
        life: 0.85,
        lifeJitter: 0.55,
        color: DRUM_COLORS[row % DRUM_COLORS.length],
        colorJitter: 0.35,
        spread: 0.24,
      },
      this.rng,
    );
    this.debris.system.emit(
      {
        x, y, z,
        count: 12,
        speed: 1.8,
        speedJitter: 2,
        lift: 3,
        life: 0.4,
        lifeJitter: 0.24,
        color: WHITE,
        colorJitter: 0.15,
        spread: 0.12,
      },
      this.rng,
    );
  }

  /** The ball dying behind the board: a low, cold scatter along the floor. */
  miss(x: number, z: number): void {
    this.debris.system.emit(
      {
        x,
        y: 0.24,
        z,
        count: 26,
        speed: 2.6,
        speedJitter: 2.2,
        lift: 1.2,
        life: 0.7,
        lifeJitter: 0.4,
        color: rgb(0xff4d5e),
        colorJitter: 0.3,
        spread: 0.18,
      },
      this.rng,
    );
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.debris.update(dt);
  }

  /** Wipe both pools — a restart must not inherit the last run's sparks. */
  clear(): void {
    this.sparks.system.clear();
    this.debris.system.clear();
    this.rng = createRng(SEED);
    this.update(0);
  }
}
