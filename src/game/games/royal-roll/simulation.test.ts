import { describe, expect, it } from 'vitest';
import { createRng } from '../../entities/rng.ts';
import { buildFormation, FORMATION_SIZE, KING_VALUE } from './formation.ts';
import {
  applyFriction,
  collide,
  frictionSpeed,
  REST_SPEED,
  speedOf,
  type Disc,
} from './physics.ts';
import { comboMultiplier, MAX_COMBO, STRIKE_BONUS } from './scoring.ts';
import {
  AIM_STEP,
  clampAim,
  MAX_AIM,
  RoyalRoll,
  SETTLE_DURATION,
  THROWS_PER_RUN,
  type RoyalRollTarget,
} from './simulation.ts';

/** Advance the game in realistic 60fps slices. */
function tick(game: RoyalRoll, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) game.update(step);
}

/** Play one throw all the way through to the next `aiming` phase. */
function playThrow(game: RoyalRoll, aim = 0): void {
  game.setAim(aim);
  game.launch();
  for (let i = 0; i < 3000 && game.phase === 'rolling'; i++) game.update(1 / 60);
  tick(game, SETTLE_DURATION + 0.1);
}

function disc(overrides: Partial<Disc> = {}): Disc {
  return { x: 0, z: 0, vx: 0, vz: 0, radius: 0.4, mass: 1, ...overrides };
}

describe('Royal Roll: aim bounds and input increments', () => {
  it('starts aimed straight down the lane, ready to throw', () => {
    const game = new RoyalRoll();
    expect(game.aimAngle).toBe(0);
    expect(game.phase).toBe('aiming');
    expect(game.status).toBe('playing');
    expect(game.throwNumber).toBe(1);
  });

  it('left and right move the aim by exactly one increment each', () => {
    const game = new RoyalRoll();
    expect(game.adjustAim(1)).toBe(true);
    expect(game.aimAngle).toBeCloseTo(AIM_STEP, 10);
    expect(game.adjustAim(1)).toBe(true);
    expect(game.aimAngle).toBeCloseTo(AIM_STEP * 2, 10);
    expect(game.adjustAim(-1)).toBe(true);
    expect(game.aimAngle).toBeCloseTo(AIM_STEP, 10);
  });

  it('clamps at both ends of the arc instead of wrapping or running away', () => {
    const game = new RoyalRoll();
    for (let i = 0; i < 200; i++) game.adjustAim(1);
    expect(game.aimAngle).toBe(MAX_AIM);
    // Already at the edge: another press changes nothing and reports so.
    expect(game.adjustAim(1)).toBe(false);
    expect(game.aimAngle).toBe(MAX_AIM);

    for (let i = 0; i < 200; i++) game.adjustAim(-1);
    expect(game.aimAngle).toBe(-MAX_AIM);
    expect(game.adjustAim(-1)).toBe(false);
  });

  it('clampAim rejects junk and out-of-arc angles', () => {
    expect(clampAim(0)).toBe(0);
    expect(clampAim(99)).toBe(MAX_AIM);
    expect(clampAim(-99)).toBe(-MAX_AIM);
    expect(clampAim(Number.NaN)).toBe(0);
  });

  it('setAim clamps too, and reports when nothing moved', () => {
    const game = new RoyalRoll();
    expect(game.setAim(10)).toBe(true);
    expect(game.aimAngle).toBe(MAX_AIM);
    expect(game.setAim(MAX_AIM)).toBe(false);
  });

  it('refuses aim changes once the throw has left the launch line', () => {
    const game = new RoyalRoll();
    game.setAim(0.12);
    game.launch();
    expect(game.phase).toBe('rolling');
    expect(game.adjustAim(1)).toBe(false);
    expect(game.setAim(-0.3)).toBe(false);
    expect(game.aimAngle).toBeCloseTo(0.12, 10);
  });
});

describe('Royal Roll: launching', () => {
  it('a launch sends the roller down the lane at the aimed angle', () => {
    const game = new RoyalRoll();
    game.setAim(MAX_AIM);
    expect(game.launch()).toBe(true);
    expect(game.phase).toBe('rolling');
    // Aimed right: it must actually be travelling right AND forward.
    expect(game.roller.vx).toBeGreaterThan(0);
    expect(game.roller.vz).toBeGreaterThan(0);

    const startZ = game.roller.z;
    tick(game, 0.4);
    expect(game.roller.z).toBeGreaterThan(startZ);
    expect(game.roller.x).toBeGreaterThan(0);
  });

  it('rejects a launch outside the aiming phase', () => {
    const game = new RoyalRoll();
    game.launch();
    expect(game.phase).toBe('rolling');
    // A second commit mid-roll must not re-fire the roller.
    const before = { x: game.roller.x, z: game.roller.z };
    expect(game.launch()).toBe(false);
    expect(game.roller.z).toBe(before.z);

    // ...nor during the result beat.
    for (let i = 0; i < 3000 && game.phase === 'rolling'; i++) game.update(1 / 60);
    expect(game.phase).toBe('settling');
    expect(game.launch()).toBe(false);
  });

  it('rejects a launch after the run is over', () => {
    const game = new RoyalRoll({ throws: 2 });
    playThrow(game);
    playThrow(game);
    expect(game.status).toBe('gameover');
    expect(game.launch()).toBe(false);
  });
});

describe('Royal Roll: the disc solver', () => {
  it('friction reduces speed monotonically and reaches an exact stop', () => {
    let speed = 9.5;
    let previous = Number.POSITIVE_INFINITY;
    let steps = 0;
    while (speed > 0 && steps < 10_000) {
      speed = frictionSpeed(speed, 1 / 240);
      expect(speed).toBeLessThan(previous);
      previous = speed;
      steps++;
    }
    // Not merely small: exactly zero, which is what makes "everything has
    // settled" a real check rather than a timeout.
    expect(speed).toBe(0);
    expect(steps).toBeLessThan(10_000);
  });

  it('a disc below the rest threshold is snapped to a full stop', () => {
    const body = disc({ vx: REST_SPEED * 0.5, vz: 0 });
    applyFriction(body, 1 / 240);
    expect(speedOf(body)).toBe(0);
  });

  it('friction never reverses a disc or leaves it drifting', () => {
    const body = disc({ vz: 6 });
    for (let i = 0; i < 4000; i++) applyFriction(body, 1 / 240);
    expect(body.vz).toBe(0);
  });

  it('a collision transfers velocity from the mover to the struck disc', () => {
    const mover = disc({ x: 0, z: 0, vz: 6, mass: 2.2 });
    const struck = disc({ x: 0, z: 0.7, vz: 0, mass: 1 });
    const impact = collide(mover, struck);

    expect(impact).toBeGreaterThan(0);
    // Momentum went forward into the struck disc...
    expect(struck.vz).toBeGreaterThan(2);
    // ...and came out of the mover, which is still going forward but slower.
    expect(mover.vz).toBeLessThan(6);
    expect(mover.vz).toBeGreaterThan(0);
    // Overlap was resolved: they are no longer inside one another.
    expect(Math.hypot(struck.x - mover.x, struck.z - mover.z)).toBeGreaterThanOrEqual(
      mover.radius + struck.radius - 1e-9,
    );
  });

  it('an off-centre hit redirects both discs sideways', () => {
    const mover = disc({ x: 0, z: 0, vz: 6, mass: 2.2 });
    const struck = disc({ x: 0.45, z: 0.55, vz: 0, mass: 1 });
    collide(mover, struck);
    // The struck disc is thrown out to its own side...
    expect(struck.vx).toBeGreaterThan(0);
    // ...and the mover recoils the other way. That deflection is the game.
    expect(mover.vx).toBeLessThan(0);
  });

  it('discs that are not touching are left completely alone', () => {
    const a = disc({ x: 0, z: 0, vz: 6 });
    const b = disc({ x: 0, z: 5, vz: 0 });
    expect(collide(a, b)).toBe(0);
    expect(a.vz).toBe(6);
    expect(b.vz).toBe(0);
  });

  it('discs already separating are not given a second impulse', () => {
    const a = disc({ x: 0, z: 0, vz: -1 });
    const b = disc({ x: 0, z: 0.7, vz: 3 });
    expect(collide(a, b)).toBe(0);
    expect(b.vz).toBe(3);
  });
});

describe('Royal Roll: the formation', () => {
  it('racks a full royal formation with exactly one king', () => {
    const targets = buildFormation(createRng(7));
    expect(targets).toHaveLength(FORMATION_SIZE);
    const royals = targets.filter((t) => t.royal);
    expect(royals).toHaveLength(1);
    expect(royals[0].value).toBe(KING_VALUE);
    // The king stands behind every guard — he is the prize at the back.
    for (const guard of targets.filter((t) => !t.royal)) {
      expect(royals[0].z).toBeGreaterThan(guard.z);
    }
  });

  it('is deterministic for a seed, and every cone has a unique id', () => {
    const a = buildFormation(createRng(99));
    const b = buildFormation(createRng(99));
    expect(a).toEqual(b);
    expect(new Set(a.map((t) => t.id)).size).toBe(a.length);
  });

  it('racks nobody on top of anybody else', () => {
    const targets = buildFormation(createRng(3));
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const gap = Math.hypot(
          targets[i].x - targets[j].x,
          targets[i].z - targets[j].z,
        );
        expect(gap).toBeGreaterThan(targets[i].radius + targets[j].radius);
      }
    }
  });
});

describe('Royal Roll: scoring', () => {
  it('pays a combo multiplier that rises with the felled count and caps', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBeGreaterThan(1);
    expect(comboMultiplier(5)).toBeGreaterThan(comboMultiplier(2));
    expect(comboMultiplier(50)).toBe(MAX_COMBO);
  });

  it('a straight throw fells cones and banks a score', () => {
    const game = new RoyalRoll({ seed: 11 });
    expect(game.score).toBe(0);
    playThrow(game, 0);

    const result = game.lastResult;
    expect(result).not.toBeNull();
    expect(result?.knocked.length).toBeGreaterThan(0);
    expect(result?.base).toBeGreaterThan(0);
    expect(game.score).toBe(result?.total);
    expect(game.score).toBeGreaterThan(0);
    expect(game.targetsDown).toBe(result?.knocked.length);
  });

  it('a throw down an empty channel fells nobody and pays nothing', () => {
    // Hard right at the barrier: the wedge is centred, so this misses it.
    const game = new RoyalRoll({ seed: 11 });
    playThrow(game, MAX_AIM);
    const result = game.lastResult;
    expect(result?.knocked).toEqual([]);
    expect(result?.total).toBe(0);
    expect(game.score).toBe(0);
    expect(game.standingCount).toBe(FORMATION_SIZE);
  });

  it('scores a target exactly once, however long the throw runs on', () => {
    const game = new RoyalRoll({ seed: 5 });
    game.launch();
    const knockedIds: number[] = [];
    for (let i = 0; i < 3000 && game.phase === 'rolling'; i++) {
      game.update(1 / 60);
      for (const target of game.targets) {
        if (!target.standing && !knockedIds.includes(target.id)) {
          knockedIds.push(target.id);
        }
      }
    }
    const result = game.lastResult;
    expect(result).not.toBeNull();
    expect(result?.knocked.length).toBeGreaterThan(0);
    // No id appears twice in the throw's ledger...
    expect(new Set(result?.knocked).size).toBe(result?.knocked.length);
    // ...and the ledger matches what actually fell during the solve.
    expect([...(result?.knocked ?? [])].sort()).toEqual([...knockedIds].sort());
    // The banked score is the ledger's total, not a double-count.
    expect(game.score).toBe(result?.total);
  });

  it('a cleared rack pays the strike bonus and re-racks for the next throw', () => {
    // Drive the formation to empty through the real settle path by knocking
    // every cone off its mark with the solver's own collision response.
    const game = new RoyalRoll({ seed: 21, throws: 3 });
    game.launch();
    // Shove every cone hard down-lane: the same bodies the solver integrates,
    // so displacement (and therefore the knock rule) is genuinely earned.
    for (const target of game.targets as RoyalRollTarget[]) target.vz = 5;
    for (let i = 0; i < 3000 && game.phase === 'rolling'; i++) game.update(1 / 60);

    const result = game.lastResult;
    expect(result?.cleared).toBe(true);
    expect(result?.knocked).toHaveLength(FORMATION_SIZE);
    expect(result?.bonus).toBe(STRIKE_BONUS);
    expect(game.score).toBeGreaterThan(STRIKE_BONUS);

    tick(game, SETTLE_DURATION + 0.1);
    expect(game.phase).toBe('aiming');
    expect(game.standingCount).toBe(FORMATION_SIZE);
  });
});

describe('Royal Roll: rounds and the run', () => {
  it('a settled throw hands the lane back for the next one', () => {
    const game = new RoyalRoll({ seed: 3 });
    expect(game.throwNumber).toBe(1);
    game.setAim(AIM_STEP * 2);
    game.launch();
    for (let i = 0; i < 3000 && game.phase === 'rolling'; i++) game.update(1 / 60);

    expect(game.phase).toBe('settling');
    expect(game.throwNumber).toBe(2);
    // Mid-settle the lane is still being read; the next throw is not armed yet.
    tick(game, SETTLE_DURATION * 0.5);
    expect(game.phase).toBe('settling');

    tick(game, SETTLE_DURATION);
    expect(game.phase).toBe('aiming');
    expect(game.status).toBe('playing');
    // The roller is back on the line and the aim re-centred for a clean read.
    expect(game.roller.z).toBeLessThan(1);
    expect(game.roller.vx).toBe(0);
    expect(game.roller.vz).toBe(0);
    expect(game.aimAngle).toBe(0);
  });

  it('every throw genuinely comes to rest rather than being cut off', () => {
    const game = new RoyalRoll({ seed: 8 });
    game.launch();
    for (let i = 0; i < 3000 && game.phase === 'rolling'; i++) game.update(1 / 60);
    expect(game.phase).toBe('settling');
    expect(speedOf(game.roller)).toBe(0);
    for (const target of game.targets) expect(speedOf(target)).toBe(0);
  });

  it('the throw limit ends the run', () => {
    const game = new RoyalRoll({ seed: 2, throws: 4 });
    for (let i = 1; i <= 4; i++) {
      expect(game.status).toBe('playing');
      expect(game.throwNumber).toBe(i);
      playThrow(game, i % 2 === 0 ? AIM_STEP : -AIM_STEP);
    }
    expect(game.status).toBe('gameover');
    expect(game.throwsTaken).toBe(4);
  });

  it('defaults to ten throws', () => {
    const game = new RoyalRoll({ seed: 2 });
    expect(game.throwLimitCount).toBe(THROWS_PER_RUN);
    for (let i = 0; i < THROWS_PER_RUN; i++) {
      expect(game.status).toBe('playing');
      playThrow(game);
    }
    expect(game.status).toBe('gameover');
  });

  it('restart restores the full formation, the score and throw one', () => {
    const game = new RoyalRoll({ seed: 13, throws: 2 });
    playThrow(game, 0);
    playThrow(game, 0);
    expect(game.status).toBe('gameover');
    const scored = game.score;
    expect(scored).toBeGreaterThan(0);
    expect(game.standingCount).toBeLessThan(FORMATION_SIZE);

    game.reset();
    expect(game.status).toBe('playing');
    expect(game.phase).toBe('aiming');
    expect(game.score).toBe(0);
    expect(game.throwNumber).toBe(1);
    expect(game.targetsDown).toBe(0);
    expect(game.aimAngle).toBe(0);
    expect(game.targets).toHaveLength(FORMATION_SIZE);
    expect(game.standingCount).toBe(FORMATION_SIZE);
    expect(game.lastResult).toBeNull();

    // ...and the restored rack plays the same as it did the first time.
    playThrow(game, 0);
    expect(game.score).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed and the same aims play out identically', () => {
    const play = (): number[] => {
      const game = new RoyalRoll({ seed: 77, throws: 3 });
      const scores: number[] = [];
      for (const aim of [0, AIM_STEP * 3, -AIM_STEP * 2]) {
        playThrow(game, aim);
        scores.push(game.score);
      }
      return scores;
    };
    expect(play()).toEqual(play());
  });

  it('reports events for launch, knocks and settling', () => {
    const launches: number[] = [];
    const knocks: number[] = [];
    let settled = 0;
    let over = -1;
    const game = new RoyalRoll({
      seed: 11,
      throws: 1,
      events: {
        onLaunch: (angle) => launches.push(angle),
        onKnock: (target) => knocks.push(target.id),
        onSettled: () => settled++,
        onGameOver: (score) => {
          over = score;
        },
      },
    });
    playThrow(game, 0);
    expect(launches).toEqual([0]);
    expect(knocks.length).toBeGreaterThan(0);
    expect(new Set(knocks).size).toBe(knocks.length);
    expect(settled).toBe(1);
    expect(over).toBe(game.score);
  });

  it('ignores non-positive timesteps instead of stepping backwards', () => {
    const game = new RoyalRoll({ seed: 4 });
    game.launch();
    const z = game.roller.z;
    game.update(0);
    game.update(-1);
    expect(game.roller.z).toBe(z);
  });
});
