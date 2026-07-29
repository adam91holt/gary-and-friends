import { it } from 'vitest';
import { laneToX } from '../entities/lanes.ts';
import { GameStore } from '../state.ts';
import { Run } from './run.ts';

it('dbg', () => {
  const store = new GameStore();
  const run = new Run(store, { seed: 4242 });
  store.start();
  run.reset();
  for (let i = 0; i < 3000; i++) {
    const clearance = [0, 1, 2].map((lane) => {
      let nearest = Infinity;
      for (const e of run.traffic.entities) {
        if (!e.active || e.lane !== lane || e.z > 0) continue;
        nearest = Math.min(nearest, -e.z);
      }
      return nearest;
    });
    let best = 0;
    for (let l = 1; l < 3; l++) if (clearance[l] > clearance[best]) best = l;
    store.setLane(best);
    run.setGaryX(laneToX(best));
    const laneBefore = store.getState().lane;
    run.update(1 / 60);
    if (store.getState().status !== 'playing') {
      console.log('DIED iter', i, 'want', best, 'actual', laneBefore, 'clear', clearance);
      console.log(
        'near:',
        JSON.stringify(
          run.traffic.entities
            .filter((e) => e.active && e.z > -30)
            .map((e) => ({ lane: e.lane, z: +e.z.toFixed(2), p: +e.prevZ.toFixed(2) })),
        ),
      );
      break;
    }
  }
});
