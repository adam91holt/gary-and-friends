/**
 * Shared materials. One cache, so four games drawing the same plastic cone
 * share one program and one GPU upload instead of four.
 *
 * A pre-wired contract: the placeholder runtimes already build their meshes
 * through `sharedStandard()`, so when the graphics child replaces the bodies
 * with its own (custom shaders, a shared env map, a matcap atlas) every game
 * inherits the upgrade without editing a single runtime.
 */
import { MeshStandardMaterial, type ColorRepresentation } from 'three';

/** The knobs a caller is allowed to vary. Anything else is house style. */
export interface StandardSpec {
  readonly color: ColorRepresentation;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: ColorRepresentation;
  readonly emissiveIntensity?: number;
}

/** House defaults: matte-ish plastic, which is what the whole cast is made of. */
const DEFAULT_ROUGHNESS = 0.55;
const DEFAULT_METALNESS = 0.05;

const cache = new Map<string, MeshStandardMaterial>();

function key(spec: StandardSpec): string {
  return [
    String(spec.color),
    spec.roughness ?? DEFAULT_ROUGHNESS,
    spec.metalness ?? DEFAULT_METALNESS,
    String(spec.emissive ?? ''),
    spec.emissiveIntensity ?? 1,
  ].join('|');
}

/**
 * Get (or build) a shared standard material for this spec.
 *
 * Callers must treat the result as IMMUTABLE — it is shared, so mutating it
 * recolours every other mesh using the same spec. A game that needs to animate
 * a material property should call `ownStandard()` for an uncached instance.
 */
export function sharedStandard(spec: StandardSpec): MeshStandardMaterial {
  const id = key(spec);
  const existing = cache.get(id);
  if (existing) return existing;
  const material = ownStandard(spec);
  cache.set(id, material);
  return material;
}

/** An UNSHARED material with the same house defaults, safe to mutate/animate. */
export function ownStandard(spec: StandardSpec): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness ?? DEFAULT_ROUGHNESS,
    metalness: spec.metalness ?? DEFAULT_METALNESS,
  });
  if (spec.emissive !== undefined) {
    material.emissive.set(spec.emissive);
    material.emissiveIntensity = spec.emissiveIntensity ?? 1;
  }
  return material;
}

/** How many distinct shared materials are live. Useful to the graphics child. */
export function sharedMaterialCount(): number {
  return cache.size;
}

/** Free every cached material. The shell calls this only on teardown. */
export function disposeShared(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
}
