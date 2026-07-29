import { expect, it } from 'vitest';
import { LANE_WIDTH } from '../entities/lanes.ts';
import {
  SPAWN_JITTER_MIN,
  TRAFFIC_VARIANTS,
  trafficInterval,
} from '../entities/traffic.ts';
import { MAX_SPEED } from './difficulty.ts';
import { GARY_HALF_WIDTH } from './run.ts';

it('renderer-rate damping clears the previous lane before the fastest next beat', () => {
  const available = trafficInterval(MAX_SPEED, SPAWN_JITTER_MIN);
  const travelled = LANE_WIDTH * (1 - Math.exp(-9 * available));
  const widestVehicle = Math.max(...TRAFFIC_VARIANTS.map((v) => v.halfWidth));

  expect(travelled).toBeGreaterThan(GARY_HALF_WIDTH + widestVehicle);
});
