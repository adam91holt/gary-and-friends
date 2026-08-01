/**
 * Royal Roll — reserved slot.
 *
 * Placeholder runtime: Gary on his side at the top of a run of cones, which is
 * the shape of the downhill. See `tower.ts` for how a sibling ticket takes
 * this over.
 */
import type { ArcadeGameRuntime } from '../runtime.ts';
import { PlaceholderRuntime } from './placeholder.ts';

export function createRoyalRollRuntime(): ArcadeGameRuntime {
  return new PlaceholderRuntime({
    id: 'royal-roll',
    // A descending run of cones: the hill, implied by what is standing on it.
    // Kept inside a ~2.6 unit footprint (see coneball.ts) so the whole run
    // stays in the composed shot.
    cones: [
      { x: -1.3, y: 1.5, z: -0.9, height: 1.2, tint: 2 },
      { x: -0.45, y: 1.0, z: -0.3, height: 1.05, tint: 3 },
      { x: 0.45, y: 0.5, z: 0.3, height: 0.9, tint: 0 },
      { x: 1.3, y: 0, z: 0.9, height: 0.75, tint: 4 },
    ],
    // Same right-of-frame composition as every other slot (see tower.ts).
    camera: {
      position: { x: -1.4, y: 2.8, z: 6.4 },
      look: { x: -2.1, y: 1.0, z: 1.2 },
    },
    metricLabel: 'Distance',
  });
}
