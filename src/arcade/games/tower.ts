/**
 * Cone Tower — reserved slot.
 *
 * Placeholder runtime: it draws the stack the finished game is about (a pile
 * of the crew, leaning), enters/leaves cleanly and reports a trivial snapshot.
 * The sibling ticket replaces the body of `createTowerRuntime` with a real
 * `ArcadeGameRuntime` and flips `playable` in the catalog — nothing outside
 * this file and `src/game/arcade/catalog.ts` needs to change.
 *
 * Per-game deterministic test commands go through `ArcadeCommandMap`
 * declaration merging (see src/game/arcade/contracts.ts) and `handleCommand`,
 * so `src/testApi.ts` stays untouched too.
 */
import type { ArcadeGameRuntime } from '../runtime.ts';
import { PlaceholderRuntime } from './placeholder.ts';

export function createTowerRuntime(): ArcadeGameRuntime {
  return new PlaceholderRuntime({
    id: 'tower',
    // A stack, slightly out of true — the game is about that lean.
    cones: [
      { x: 0, y: 0, z: 0, height: 1.5, tint: 4 },
      { x: 0.1, y: 1.5, z: -0.05, height: 1.25, tint: 1 },
      { x: -0.06, y: 2.75, z: 0.08, height: 1.0, tint: 0 },
      { x: 0.14, y: 3.75, z: 0, height: 0.8, tint: 3 },
    ],
    // Framed like the highway's hero shot: the panel docks left, so the stage
    // is composed off to the RIGHT of frame. Every slot uses the same offset,
    // so walking the grid never makes the subject jump across the screen.
    camera: {
      position: { x: -1.4, y: 3.0, z: 6.2 },
      look: { x: -2.1, y: 2.0, z: 1.2 },
    },
    metricLabel: 'Height',
  });
}
