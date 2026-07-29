/**
 * Deterministic pseudo-random source for spawn logic.
 *
 * Pure — no three.js, no DOM. Gameplay must never call `Math.random()` directly:
 * every random decision goes through an `Rng` so a run can be replayed exactly
 * (Vitest asserts on spawn sequences, Playwright seeds before a screenshot).
 */

/** A [0, 1) generator. Same seed -> same sequence, forever. */
export type Rng = () => number;

/**
 * mulberry32 — small, fast, good enough distribution for spawn jitter, and
 * (unlike Math.random) reproducible.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an integer in [0, count). */
export function randomIndex(rng: Rng, count: number): number {
  return Math.min(count - 1, Math.floor(rng() * count));
}

/** Uniform float in [min, max). */
export function randomRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}
