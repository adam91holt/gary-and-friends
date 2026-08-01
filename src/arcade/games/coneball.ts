/**
 * Coneball — reserved slot.
 *
 * Placeholder runtime: two cones facing off across a court, which is the whole
 * pitch of the game. See `tower.ts` for how a sibling ticket takes this over.
 */
import type { ArcadeGameRuntime } from '../runtime.ts';
import { PlaceholderRuntime } from './placeholder.ts';

export function createConeballRuntime(): ArcadeGameRuntime {
  return new PlaceholderRuntime({
    id: 'coneball',
    // Two paddles and the ball's resting spot between them. Kept inside a ~2.6
    // unit footprint: the composed shot only has the right third of the frame
    // to work with, and a wider spread walks the outer cones off screen.
    cones: [
      { x: -1.1, y: 0, z: 0.5, height: 1.3, tint: 1 },
      { x: 1.1, y: 0, z: -0.5, height: 1.3, tint: 4 },
      { x: 0, y: 0.9, z: 0, height: 0.5, tint: 3 },
    ],
    // Same right-of-frame composition as every other slot (see tower.ts).
    camera: {
      position: { x: -1.4, y: 2.8, z: 6.4 },
      look: { x: -2.1, y: 0.8, z: 1.2 },
    },
    metricLabel: 'Rally',
  });
}
