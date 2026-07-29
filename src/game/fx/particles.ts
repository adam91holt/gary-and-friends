/**
 * The particle simulation. Pure: no three.js, no DOM, no `window` — it owns
 * nothing but numbers in flat typed arrays, which is exactly the shape a
 * `BufferGeometry` wants. `src/scene/particles.ts` wraps these arrays in
 * `Points` and flags them dirty; it never decides where a particle goes.
 *
 * Deliberately DIY rather than a particle library: the whole system is ~150
 * lines, it recycles a fixed pool (no allocation per hop), and because it is
 * pure it is unit-tested at any timestep — the same deal the entity field made.
 *
 * ── Fade model ──────────────────────────────────────────────────────────────
 * Particles fade by darkening their per-vertex colour toward black rather than
 * by animating opacity. Under additive blending on a dark road that IS a fade,
 * and it means the whole visual state of the system lives in two attribute
 * arrays that upload in one go, with no per-particle material.
 */
import type { Rng } from '../entities/rng.ts';

export interface ParticleConfig {
  /** Fixed pool size. The system never allocates past this. */
  readonly capacity: number;
  /** Vertical acceleration (world-units/s², negative falls). */
  readonly gravity: number;
  /** Exponential velocity damping per second. Air, basically. */
  readonly drag: number;
  /**
   * Shapes brightness over a particle's life. 1 = linear fade, >1 holds bright
   * then drops away late (which is what makes a spark read as a spark).
   */
  readonly fade: number;
}

export interface EmitOptions {
  /** Emission origin, world space. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How many particles to try to emit (capped by free slots). */
  readonly count: number;
  /** Base outward speed in the XZ plane. */
  readonly speed: number;
  /** Random extra on top of `speed` (0..speedJitter). */
  readonly speedJitter?: number;
  /** Upward bias added to the initial velocity. */
  readonly lift?: number;
  /** Seconds a particle lives. */
  readonly life: number;
  /** Random extra life (0..lifeJitter). */
  readonly lifeJitter?: number;
  /** Base colour, linear 0..1 RGB. */
  readonly color: readonly [number, number, number];
  /** Per-particle multiplicative colour variation (0..1). */
  readonly colorJitter?: number;
  /** Constant +Z drift, e.g. the road rushing past under a dust puff. */
  readonly drift?: number;
  /** Spawn scatter radius around the origin. */
  readonly spread?: number;
}

/**
 * A pooled particle system. Positions and colours are exposed directly so the
 * renderer can hand them to a `BufferAttribute` once and never copy again.
 */
export class Particles {
  /** xyz per particle. Dead particles keep their last position (colour is 0). */
  readonly positions: Float32Array;
  /** rgb per particle, already faded. Dead particles are exactly black. */
  readonly colors: Float32Array;

  private readonly velocities: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drift: Float32Array;
  private readonly config: ParticleConfig;
  private cursor = 0;
  private alive = 0;

  constructor(config: ParticleConfig) {
    this.config = config;
    const n = config.capacity;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.baseColors = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.drift = new Float32Array(n);
  }

  /** How many particles are currently live. Projected onto the test API. */
  get aliveCount(): number {
    return this.alive;
  }

  /** Pool size. */
  get capacity(): number {
    return this.config.capacity;
  }

  /**
   * Emit a burst. Returns how many particles actually spawned — a burst that
   * arrives with the pool full is quietly clipped rather than stealing a live
   * particle, because a puff losing three grains is invisible while a spark
   * vanishing mid-flight is not.
   */
  emit(options: EmitOptions, rng: Rng): number {
    const {
      x, y, z,
      count,
      speed,
      speedJitter = 0,
      lift = 0,
      life,
      lifeJitter = 0,
      color,
      colorJitter = 0,
      drift = 0,
      spread = 0,
    } = options;

    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const slot = this.freeSlot();
      if (slot === -1) break;

      // Cheap uniform-ish direction on the XZ plane, biased upward by `lift`.
      const angle = rng() * Math.PI * 2;
      const magnitude = speed + rng() * speedJitter;
      const p = slot * 3;
      this.positions[p] = x + (rng() - 0.5) * 2 * spread;
      this.positions[p + 1] = y + rng() * spread;
      this.positions[p + 2] = z + (rng() - 0.5) * 2 * spread;
      this.velocities[p] = Math.cos(angle) * magnitude;
      this.velocities[p + 1] = lift * (0.55 + rng() * 0.9);
      this.velocities[p + 2] = Math.sin(angle) * magnitude;

      const tint = 1 - rng() * colorJitter;
      this.baseColors[p] = color[0] * tint;
      this.baseColors[p + 1] = color[1] * tint;
      this.baseColors[p + 2] = color[2] * tint;
      this.colors[p] = this.baseColors[p];
      this.colors[p + 1] = this.baseColors[p + 1];
      this.colors[p + 2] = this.baseColors[p + 2];

      const span = life + rng() * lifeJitter;
      this.life[slot] = span;
      this.maxLife[slot] = span;
      this.drift[slot] = drift;
      this.alive++;
      spawned++;
    }
    return spawned;
  }

  /** Advance every live particle one step. No-op for dt <= 0. */
  update(dt: number): void {
    if (dt <= 0) return;
    const { gravity, drag, fade } = this.config;
    const damping = Math.exp(-drag * dt);

    for (let i = 0; i < this.config.capacity; i++) {
      const remaining = this.life[i];
      if (remaining <= 0) continue;

      const next = remaining - dt;
      if (next <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = next;

      const p = i * 3;
      this.velocities[p] *= damping;
      this.velocities[p + 1] = this.velocities[p + 1] * damping + gravity * dt;
      this.velocities[p + 2] *= damping;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += (this.velocities[p + 2] + this.drift[i]) * dt;

      const t = next / this.maxLife[i];
      const brightness = Math.pow(t, fade);
      this.colors[p] = this.baseColors[p] * brightness;
      this.colors[p + 1] = this.baseColors[p + 1] * brightness;
      this.colors[p + 2] = this.baseColors[p + 2] * brightness;
    }
  }

  /** Extinguish everything (a restart must not inherit the last crash's dust). */
  clear(): void {
    for (let i = 0; i < this.config.capacity; i++) {
      if (this.life[i] > 0) this.kill(i);
    }
    this.alive = 0;
    this.cursor = 0;
  }

  private kill(index: number): void {
    this.life[index] = 0;
    const p = index * 3;
    this.colors[p] = 0;
    this.colors[p + 1] = 0;
    this.colors[p + 2] = 0;
    if (this.alive > 0) this.alive--;
  }

  /** Next free slot, scanning from a rotating cursor. -1 when the pool is full. */
  private freeSlot(): number {
    const n = this.config.capacity;
    for (let i = 0; i < n; i++) {
      const slot = (this.cursor + i) % n;
      if (this.life[slot] <= 0) {
        this.cursor = (slot + 1) % n;
        return slot;
      }
    }
    return -1;
  }
}
