import { describe, expect, it } from 'vitest';
import { FRIENDS } from '../../friends/roster.ts';
import { GameStore } from '../../state.ts';
import {
  CARRIER_SPAN,
  DROP_SPEED,
  LANDING_SCORE,
  MAX_CARRIER_SPEED,
  PERFECT_BONUS,
  PERFECT_WINDOW,
  TOWER_BASE_HEIGHT,
  TOWER_BASE_WIDTH,
  carrierSpeedForHeight,
} from './rules.ts';
import { TOWER_CAST_BAG, TowerGame, type DropOutcome } from './stack.ts';

/** Advance the simulation in realistic 60fps slices. */
function tick(game: TowerGame, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step);
}

/** A game mid-run, with the store already started. */
function playing(options: { seed?: number; onDrop?: (o: DropOutcome) => void } = {}): {
  store: GameStore;
  game: TowerGame;
} {
  const store = new GameStore();
  store.selectGame('tower');
  const game = new TowerGame(store, options);
  store.start();
  game.reset();
  return { store, game };
}

/**
 * Drop from `x` and run the simulation until the cone has resolved, stopping on
 * the very frame it does — so a test can inspect the state the landing left
 * rather than the state the carriage has since run on to.
 */
function dropAt(game: TowerGame, x: number): void {
  game.placeCarrier(x);
  if (!game.drop()) return;
  for (let i = 0; i < 600 && game.fallingCone !== null; i++) game.update(1 / 60);
}

describe('TowerGame: the opening state', () => {
  it('starts with only the base pad, nothing in the air, no combo', () => {
    const { game } = playing();
    expect(game.stackEntries).toHaveLength(1);
    expect(game.stackHeight).toBe(0);
    expect(game.fallingCone).toBeNull();
    expect(game.combo).toBe(0);
    expect(game.score).toBe(0);
    const pad = game.stackEntries[0];
    expect(pad.width).toBe(TOWER_BASE_WIDTH);
    expect(pad.height).toBe(TOWER_BASE_HEIGHT);
    expect(game.towerTop).toBe(TOWER_BASE_HEIGHT);
  });

  it('parks the carriage on the left rail running right', () => {
    const { game } = playing();
    expect(game.carrierX).toBe(-CARRIER_SPAN);
    expect(game.carrierDirection).toBe(1);
  });

  it('hands the carriage a real cast member', () => {
    const { game } = playing();
    expect(TOWER_CAST_BAG).toContain(game.carriedVariant);
    expect(game.carriedVariant).toBeLessThan(FRIENDS.length);
  });
});

describe('TowerGame: the carriage', () => {
  it('stays inside its rails however long it runs', () => {
    const { game } = playing();
    for (let i = 0; i < 2_000; i++) {
      game.update(1 / 60);
      expect(game.carrierX).toBeGreaterThanOrEqual(-CARRIER_SPAN - 1e-9);
      expect(game.carrierX).toBeLessThanOrEqual(CARRIER_SPAN + 1e-9);
    }
  });

  it('reverses direction when it reaches a rail', () => {
    const { game } = playing();
    expect(game.carrierDirection).toBe(1);
    // Travel the full span at the opening speed, plus a hair.
    tick(game, (CARRIER_SPAN * 2) / carrierSpeedForHeight(0) + 0.1);
    expect(game.carrierDirection).toBe(-1);
    tick(game, (CARRIER_SPAN * 2) / carrierSpeedForHeight(0) + 0.1);
    expect(game.carrierDirection).toBe(1);
  });

  it('stays on the rails even when a single frame overshoots the whole span', () => {
    const { game } = playing();
    // A pathologically long frame: several spans in one step.
    game.update(10);
    expect(game.carrierX).toBeGreaterThanOrEqual(-CARRIER_SPAN);
    expect(game.carrierX).toBeLessThanOrEqual(CARRIER_SPAN);
  });

  it('idles on the menu, runs in play, and stops dead on game over', () => {
    const store = new GameStore();
    store.selectGame('tower');
    const game = new TowerGame(store);

    // Menu: the cabinet is running live behind the select panel, so the gantry
    // idles — but nothing is at stake, because a drop is refused outside a run.
    tick(game, 0.5);
    expect(game.carrierX).toBeGreaterThan(-CARRIER_SPAN);
    expect(game.drop()).toBe(false);
    expect(game.stackHeight).toBe(0);

    store.start();
    game.reset();
    tick(game, 0.5);
    expect(game.carrierX).toBeGreaterThan(-CARRIER_SPAN);

    dropAt(game, CARRIER_SPAN);
    expect(store.getState().status).toBe('gameover');
    const frozen = game.carrierX;
    tick(game, 1);
    expect(game.carrierX).toBe(frozen);
  });

  it('speeds up as the tower grows', () => {
    const { game } = playing();
    const opening = game.carrierSpeed;
    for (let i = 0; i < 6; i++) dropAt(game, 0);
    expect(game.stackHeight).toBe(6);
    expect(game.carrierSpeed).toBeGreaterThan(opening);
    expect(game.carrierSpeed).toBe(carrierSpeedForHeight(6));
    expect(game.carrierSpeed).toBeLessThanOrEqual(MAX_CARRIER_SPEED);
  });

  it('holds still while a cone is in the air — the drop is the only thing moving', () => {
    const { game } = playing();
    game.placeCarrier(0.4);
    game.drop();
    const x = game.carrierX;
    tick(game, 0.05);
    expect(game.fallingCone).not.toBeNull();
    expect(game.carrierX).toBe(x);
  });
});

describe('TowerGame: dropping', () => {
  it('releases a cone that falls from the carriage toward the tower', () => {
    const { game } = playing();
    game.placeCarrier(0.5);
    const startY = game.carrierY;
    expect(game.drop()).toBe(true);

    const cone = game.fallingCone;
    expect(cone).not.toBeNull();
    expect(cone?.x).toBeCloseTo(0.5, 10);
    expect(cone?.y).toBeCloseTo(startY, 10);

    game.update(0.05);
    expect(game.fallingCone?.y).toBeCloseTo(startY - DROP_SPEED * 0.05, 6);
    // Still in the air, so nothing has been added to the tower yet.
    expect(game.stackHeight).toBe(0);
  });

  it('refuses a second drop while one is still in the air', () => {
    const { game } = playing();
    expect(game.drop()).toBe(true);
    expect(game.drop()).toBe(false);
    expect(game.stackHeight).toBe(0);
  });

  it('refuses to drop outside a run', () => {
    const store = new GameStore();
    store.selectGame('tower');
    const game = new TowerGame(store);
    expect(game.drop()).toBe(false);
    expect(game.fallingCone).toBeNull();
  });

  it('lands the cone on the tower and grows the stack', () => {
    const { game } = playing();
    const variant = game.carriedVariant;
    const topBefore = game.towerTop;
    dropAt(game, 0);

    expect(game.fallingCone).toBeNull();
    expect(game.stackHeight).toBe(1);
    const piece = game.stackEntries[1];
    expect(piece.variant).toBe(variant);
    expect(piece.y).toBeCloseTo(topBefore, 10);
    expect(game.towerTop).toBeGreaterThan(topBefore);
  });

  it('sends the carriage back to a rail with a new cone after a landing', () => {
    const { game } = playing();
    dropAt(game, 0);
    expect(Math.abs(game.carrierX)).toBeCloseTo(CARRIER_SPAN, 10);
    expect(game.fallingCone).toBeNull();
    expect(TOWER_CAST_BAG).toContain(game.carriedVariant);
  });
});

describe('TowerGame: precision, trimming and combo', () => {
  it('awards the precision bonus for a centred landing and keeps the width', () => {
    const { game } = playing();
    dropAt(game, 0);
    expect(game.stackEntries[1].perfect).toBe(true);
    expect(game.stackEntries[1].width).toBeCloseTo(TOWER_BASE_WIDTH, 10);
    expect(game.combo).toBe(1);
    expect(game.score).toBe(LANDING_SCORE + PERFECT_BONUS);
  });

  it('trims the overhang off a scruffy landing, narrowing the tower', () => {
    const { game } = playing();
    dropAt(game, 0.7);
    const piece = game.stackEntries[1];
    expect(piece.perfect).toBe(false);
    expect(piece.width).toBeCloseTo(TOWER_BASE_WIDTH - 0.7, 10);
    expect(piece.width).toBeLessThan(TOWER_BASE_WIDTH);
    // The next cone can only be as wide as what it has to land on.
    expect(game.carriedWidth).toBeCloseTo(piece.width, 10);
    expect(game.combo).toBe(0);
  });

  it('builds a combo across consecutive centred landings, and breaks it', () => {
    const { game } = playing();
    dropAt(game, 0);
    dropAt(game, PERFECT_WINDOW * 0.5);
    expect(game.combo).toBe(2);
    const comboScore = game.score;
    // A scruffy-but-legal landing resets the streak.
    dropAt(game, 0.5);
    expect(game.combo).toBe(0);
    expect(game.score).toBeGreaterThan(comboScore); // it still paid something
  });

  it('a combo run scores more than the same number of scruffy landings', () => {
    const perfect = playing();
    for (let i = 0; i < 4; i++) dropAt(perfect.game, 0);

    const scruffy = playing();
    // Comfortably outside the perfect window, comfortably inside a miss.
    for (const offset of [0.15, -0.16, 0.15, -0.14]) dropAt(scruffy.game, offset);

    expect(perfect.game.stackHeight).toBe(4);
    expect(scruffy.game.stackHeight).toBe(4);
    expect(perfect.game.score).toBeGreaterThan(scruffy.game.score);
  });

  it('reports every drop through the callback, landed or not', () => {
    const outcomes: DropOutcome[] = [];
    const { game } = playing({ onDrop: (o) => outcomes.push(o) });
    dropAt(game, 0);
    dropAt(game, 0.6);
    dropAt(game, 9);

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0].perfect).toBe(true);
    expect(outcomes[0].trimmed).toBe(0);
    expect(outcomes[0].points).toBeGreaterThan(0);
    expect(outcomes[1].perfect).toBe(false);
    expect(outcomes[1].trimmed).toBeGreaterThan(0);
    expect(outcomes[2].landed).toBe(false);
    expect(outcomes[2].points).toBe(0);
  });
});

describe('TowerGame: tower growth', () => {
  it('each landing raises the tower by the piece that landed', () => {
    const { game } = playing();
    for (let i = 0; i < 5; i++) {
      const before = game.towerTop;
      const carried = game.carriedVariant;
      dropAt(game, 0);
      const grown = game.towerTop - before;
      expect(grown).toBeGreaterThan(0);
      expect(grown).toBeCloseTo(FRIENDS[carried].height * 0.55, 10);
    }
    expect(game.stackHeight).toBe(5);
  });

  it('the carriage always hangs above whatever the tower has become', () => {
    const { game } = playing();
    for (let i = 0; i < 8; i++) {
      dropAt(game, 0);
      expect(game.carrierY).toBeGreaterThan(game.towerTop);
    }
  });

  it('cycles the cast rather than stacking one repeated silhouette', () => {
    const { game } = playing();
    for (let i = 0; i < 14; i++) dropAt(game, 0);
    const variants = game.stackEntries.slice(1).map((e) => e.variant);
    expect(new Set(variants).size).toBeGreaterThan(1);
    // Tiny (3) and Big Dave (4) are the billed pair, and the bag is weighted
    // toward them, so a run of this length must feature both.
    expect(variants).toContain(3);
    expect(variants).toContain(4);
  });
});

describe('TowerGame: missing', () => {
  it('a drop clean off the tower ends the run', () => {
    const { store, game } = playing();
    dropAt(game, CARRIER_SPAN);
    expect(store.getState().status).toBe('gameover');
    expect(game.stackHeight).toBe(0);
  });

  it('a run ended by a miss keeps the score already banked', () => {
    const { store, game } = playing();
    dropAt(game, 0);
    const banked = game.score;
    expect(banked).toBeGreaterThan(0);
    dropAt(game, CARRIER_SPAN);
    expect(store.getState().status).toBe('gameover');
    expect(store.getState().score).toBe(banked);
  });

  it('game over stops the world: the carriage and the score freeze', () => {
    const { store, game } = playing();
    dropAt(game, CARRIER_SPAN);
    const x = game.carrierX;
    const score = game.score;
    tick(game, 2);
    expect(game.carrierX).toBe(x);
    expect(game.score).toBe(score);
    expect(store.getState().status).toBe('gameover');
  });

  it('a narrowed tower can genuinely be missed — the trim has consequences', () => {
    const { store, game } = playing();
    // Four deliberate overhangs shave the pad down to a sliver...
    for (const offset of [0.28, -0.26, 0.24, -0.2]) {
      dropAt(game, offset);
      if (store.getState().status !== 'playing') break;
    }
    const remaining = game.carriedWidth;
    expect(remaining).toBeLessThan(TOWER_BASE_WIDTH / 2);

    // ...and an offset that would have been a comfortable landing on the full
    // pad now misses entirely.
    if (store.getState().status === 'playing') {
      dropAt(game, game.stackEntries[game.stackEntries.length - 1].x + remaining + 0.3);
      expect(store.getState().status).toBe('gameover');
    }
  });
});

describe('TowerGame: reset', () => {
  it('restart clears every falling and stacked object and restores the opening', () => {
    const { store, game } = playing();
    dropAt(game, 0);
    dropAt(game, 0.4);
    // ...and leave a cone genuinely mid-air, so the reset has something to clear.
    game.placeCarrier(1);
    expect(game.drop()).toBe(true);
    game.update(1 / 60);
    expect(game.fallingCone).not.toBeNull();
    tick(game, 3); // let it land, then miss the next one to end the run
    dropAt(game, CARRIER_SPAN);
    expect(store.getState().status).toBe('gameover');

    store.start();
    game.reset();

    expect(game.stackEntries).toHaveLength(1);
    expect(game.stackHeight).toBe(0);
    expect(game.fallingCone).toBeNull();
    expect(game.combo).toBe(0);
    expect(game.score).toBe(0);
    expect(game.carrierX).toBe(-CARRIER_SPAN);
    expect(game.carrierDirection).toBe(1);
    expect(game.carriedWidth).toBe(TOWER_BASE_WIDTH);
    expect(game.carrierSpeed).toBe(carrierSpeedForHeight(0));
  });
});

describe('TowerGame: determinism', () => {
  it('the same seed produces the same cast sequence', () => {
    const sequence = (seed: number): number[] => {
      const { game } = playing({ seed });
      const variants: number[] = [game.carriedVariant];
      for (let i = 0; i < 10; i++) {
        dropAt(game, 0);
        variants.push(game.carriedVariant);
      }
      return variants;
    };

    expect(sequence(99)).toEqual(sequence(99));
    // ...and a different seed genuinely varies it, or the seed does nothing.
    const a = sequence(99);
    const b = sequence(12345);
    expect(a).not.toEqual(b);
  });

  it('resetting rewinds the sequence, so a restart replays identically', () => {
    const { store, game } = playing({ seed: 2024 });
    const first: number[] = [];
    for (let i = 0; i < 6; i++) {
      first.push(game.carriedVariant);
      dropAt(game, 0);
    }

    dropAt(game, CARRIER_SPAN);
    store.start();
    game.reset();

    const second: number[] = [];
    for (let i = 0; i < 6; i++) {
      second.push(game.carriedVariant);
      dropAt(game, 0);
    }
    expect(second).toEqual(first);
  });

  it('the outcome does not depend on the frame rate', () => {
    const played = (step: number): { height: number; score: number; width: number } => {
      const { game } = playing({ seed: 7 });
      for (const offset of [0, 0.3, -0.25, 0, 0.4]) {
        game.placeCarrier(offset);
        game.drop();
        for (let t = 0; t < 3; t += step) game.update(step);
      }
      return {
        height: game.stackHeight,
        score: game.score,
        width: Math.round(game.carriedWidth * 1e6) / 1e6,
      };
    };
    expect(played(1 / 30)).toEqual(played(1 / 60));
    expect(played(1 / 144)).toEqual(played(1 / 60));
  });
});

describe('TowerGame: the deterministic carriage hook', () => {
  it('parks the carriage inside the rails and reports success', () => {
    const { game } = playing();
    expect(game.placeCarrier(1.2, -1)).toBe(true);
    expect(game.carrierX).toBeCloseTo(1.2, 10);
    expect(game.carrierDirection).toBe(-1);
  });

  it('clamps a request beyond the rails rather than teleporting off them', () => {
    const { game } = playing();
    game.placeCarrier(99);
    expect(game.carrierX).toBe(CARRIER_SPAN);
    game.placeCarrier(-99);
    expect(game.carrierX).toBe(-CARRIER_SPAN);
  });

  it('refuses while a cone is in the air, or outside a run', () => {
    const { game } = playing();
    game.drop();
    expect(game.placeCarrier(0)).toBe(false);

    const store = new GameStore();
    store.selectGame('tower');
    const idle = new TowerGame(store);
    expect(idle.placeCarrier(0)).toBe(false);
  });

  it('sets up the situation only — the real rules still decide the outcome', () => {
    // Parked dead centre, the shipping landing rule must call it perfect...
    const centred = playing();
    dropAt(centred.game, 0);
    expect(centred.game.stackEntries[1].perfect).toBe(true);

    // ...and parked off the pad, the same rule must end the run. The hook
    // cannot force either result; it only chooses where the carriage stands.
    const missed = playing();
    dropAt(missed.game, TOWER_BASE_WIDTH);
    expect(missed.store.getState().status).toBe('gameover');
  });
});
