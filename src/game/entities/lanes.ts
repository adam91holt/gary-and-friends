/**
 * The lane <-> world-X mapping, in the pure layer.
 *
 * This is world geometry, not rendering: collision, spawning and Gary's own
 * lateral position all need it, and all of them must run under Vitest without
 * three.js. `src/scene/road.ts` re-exports these so the renderer's existing
 * import path stays exactly as the foundation ticket pinned it.
 */
import { CENTER_LANE, LANE_COUNT } from '../state.ts';

/** Distance between lane centres (world units). */
export const LANE_WIDTH = 2.4;

/** Half-width of the drivable road surface: outer lane centre + half a lane. */
export const ROAD_HALF = LANE_WIDTH * 1.5;

/** Map a lane index to world-space X. Clamps, so junk in never means NaN out. */
export function laneToX(lane: number): number {
  const rounded = Math.round(lane);
  const clamped = Number.isNaN(rounded)
    ? 0
    : Math.max(0, Math.min(LANE_COUNT - 1, rounded));
  return (clamped - CENTER_LANE) * LANE_WIDTH;
}
