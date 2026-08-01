import { describe, expect, it } from 'vitest';
import { ARCADE_ACTIONS, isArcadeAction } from './contracts.ts';
import {
  actionForKey,
  actionForSwipe,
  actionForTap,
  isTapTravel,
  moveCursor,
  routeAction,
  SWIPE_THRESHOLD,
  TAP_SLOP,
} from './input.ts';

describe('keyboard mapping', () => {
  it('maps the arrows', () => {
    expect(actionForKey('ArrowLeft')).toBe('left');
    expect(actionForKey('ArrowRight')).toBe('right');
    expect(actionForKey('ArrowUp')).toBe('up');
    expect(actionForKey('ArrowDown')).toBe('down');
  });

  it('maps WASD to the same four directions', () => {
    expect(actionForKey('a')).toBe('left');
    expect(actionForKey('d')).toBe('right');
    expect(actionForKey('w')).toBe('up');
    expect(actionForKey('s')).toBe('down');
  });

  it('is case-insensitive, so Shift and Caps Lock never break steering', () => {
    expect(actionForKey('A')).toBe('left');
    expect(actionForKey('D')).toBe('right');
    expect(actionForKey('W')).toBe('up');
    expect(actionForKey('S')).toBe('down');
    expect(actionForKey('ARROWLEFT')).toBe('left');
  });

  it('maps Space and Enter to primary, Escape to back', () => {
    expect(actionForKey(' ')).toBe('primary');
    expect(actionForKey('Enter')).toBe('primary');
    expect(actionForKey('Escape')).toBe('back');
  });

  it('ignores keys the game does not own', () => {
    expect(actionForKey('q')).toBeNull();
    expect(actionForKey('Tab')).toBeNull();
    expect(actionForKey('F5')).toBeNull();
    expect(actionForKey('Shift')).toBeNull();
  });

  it('every mapped key produces a declared action', () => {
    for (const key of ['ArrowLeft', 'd', 'w', 'S', ' ', 'Enter', 'Escape']) {
      const action = actionForKey(key);
      expect(action).not.toBeNull();
      expect(isArcadeAction(action)).toBe(true);
    }
    expect(ARCADE_ACTIONS).toHaveLength(6);
  });
});

describe('gesture mapping', () => {
  it('a horizontal swipe past the threshold picks a side', () => {
    expect(actionForSwipe(-80, 0)).toBe('left');
    expect(actionForSwipe(80, 0)).toBe('right');
  });

  it('a vertical swipe past the threshold picks an axis end', () => {
    expect(actionForSwipe(0, -80)).toBe('up');
    expect(actionForSwipe(0, 80)).toBe('down');
  });

  it('resolves a diagonal on its dominant axis only', () => {
    // Mostly sideways with a wobble: still one lane change, never two actions.
    expect(actionForSwipe(70, 22)).toBe('right');
    // Mostly vertical: a scroll-shaped drag must not nudge sideways.
    expect(actionForSwipe(22, -70)).toBe('up');
  });

  it('travel under the threshold is not a swipe at all', () => {
    expect(actionForSwipe(SWIPE_THRESHOLD - 1, 0)).toBeNull();
    expect(actionForSwipe(0, SWIPE_THRESHOLD - 1)).toBeNull();
    expect(actionForSwipe(0, 0)).toBeNull();
    // Dominant axis short even though the other one is long enough in total.
    expect(actionForSwipe(20, 12)).toBeNull();
  });

  it('commits exactly at the threshold', () => {
    expect(actionForSwipe(SWIPE_THRESHOLD, 0)).toBe('right');
    expect(actionForSwipe(0, SWIPE_THRESHOLD)).toBe('down');
  });

  it('a still finger is a tap, a travelled one is not', () => {
    expect(isTapTravel(0, 0)).toBe(true);
    expect(isTapTravel(TAP_SLOP, -TAP_SLOP)).toBe(true);
    expect(isTapTravel(TAP_SLOP + 1, 0)).toBe(false);
    expect(isTapTravel(0, TAP_SLOP + 1)).toBe(false);
  });

  it('a tap is the same intent as Space', () => {
    expect(actionForTap()).toBe('primary');
    expect(actionForTap()).toBe(actionForKey(' '));
  });
});

describe('status-aware routing', () => {
  it('the menu owns every action except back', () => {
    expect(routeAction('menu', 'left')).toBe('menu');
    expect(routeAction('menu', 'right')).toBe('menu');
    expect(routeAction('menu', 'up')).toBe('menu');
    expect(routeAction('menu', 'down')).toBe('menu');
    expect(routeAction('menu', 'primary')).toBe('menu');
    // There is nothing above the menu to go back to.
    expect(routeAction('menu', 'back')).toBe('ignore');
  });

  it('a running game receives everything but back', () => {
    expect(routeAction('playing', 'left')).toBe('runtime');
    expect(routeAction('playing', 'right')).toBe('runtime');
    expect(routeAction('playing', 'up')).toBe('runtime');
    expect(routeAction('playing', 'down')).toBe('runtime');
    expect(routeAction('playing', 'primary')).toBe('runtime');
    expect(routeAction('playing', 'back')).toBe('back');
  });

  it('primary never both starts a run and fires an in-game action', () => {
    // The whole point of routing on status: once playing, primary belongs to
    // the runtime and can no longer mean "start". The two routes are disjoint.
    expect(routeAction('menu', 'primary')).toBe('menu');
    expect(routeAction('playing', 'primary')).toBe('runtime');
    expect(routeAction('gameover', 'primary')).toBe('start');
    const routes = (['menu', 'playing', 'gameover'] as const).map((status) =>
      routeAction(status, 'primary'),
    );
    expect(new Set(routes).size).toBe(3);
  });

  it('gameover restarts on primary and leaves on back', () => {
    expect(routeAction('gameover', 'primary')).toBe('start');
    expect(routeAction('gameover', 'back')).toBe('back');
  });

  it('gameover drops directions, so a reflex dodge moves nothing', () => {
    expect(routeAction('gameover', 'left')).toBe('ignore');
    expect(routeAction('gameover', 'right')).toBe('ignore');
    expect(routeAction('gameover', 'up')).toBe('ignore');
    expect(routeAction('gameover', 'down')).toBe('ignore');
  });

  it('routes every action from every status without falling through', () => {
    for (const status of ['menu', 'playing', 'gameover'] as const) {
      for (const action of ARCADE_ACTIONS) {
        expect(typeof routeAction(status, action)).toBe('string');
      }
    }
  });
});

describe('grid cursor', () => {
  // The shipped shape: four cards in two columns.
  const move = (i: number, a: Parameters<typeof moveCursor>[3]) =>
    moveCursor(i, 4, 2, a);

  it('walks right and left within a row, wrapping inside that row', () => {
    expect(move(0, 'right')).toBe(1);
    expect(move(1, 'right')).toBe(0); // wraps within row 0, not into row 1
    expect(move(1, 'left')).toBe(0);
    expect(move(0, 'left')).toBe(1);
    expect(move(2, 'right')).toBe(3);
    expect(move(3, 'right')).toBe(2);
  });

  it('walks down and up a column, wrapping', () => {
    expect(move(0, 'down')).toBe(2);
    expect(move(2, 'down')).toBe(0);
    expect(move(2, 'up')).toBe(0);
    expect(move(0, 'up')).toBe(2);
    expect(move(1, 'down')).toBe(3);
    expect(move(3, 'up')).toBe(1);
  });

  it('reaches all four cards from any start using arrows only', () => {
    for (let start = 0; start < 4; start++) {
      const reached = new Set<number>([start]);
      let i = start;
      // Two rights and two downs is enough to sweep a 2×2.
      for (const action of ['right', 'down', 'right', 'down'] as const) {
        i = move(i, action);
        reached.add(i);
      }
      expect(reached.size).toBe(4);
    }
  });

  it('non-directional actions leave the cursor alone', () => {
    expect(move(2, 'primary')).toBe(2);
    expect(move(2, 'back')).toBe(2);
  });

  it('clamps a junk index instead of returning one', () => {
    expect(move(-5, 'right')).toBe(1); // clamped to 0, then moved
    expect(move(99, 'left')).toBe(2); // clamped to 3, then moved within row 1
  });

  it('handles a ragged last row without landing on a missing cell', () => {
    // Five cards, two columns: row 2 holds only index 4.
    const ragged = (i: number, a: Parameters<typeof moveCursor>[3]) =>
      moveCursor(i, 5, 2, a);
    expect(ragged(4, 'right')).toBe(4); // alone in its row
    expect(ragged(4, 'left')).toBe(4);
    expect(ragged(3, 'down')).toBe(1); // column 1 has no row-2 cell; wraps up
    expect(ragged(2, 'down')).toBe(4);
    expect(ragged(4, 'down')).toBe(0);
    for (let i = 0; i < 5; i++) {
      for (const a of ['left', 'right', 'up', 'down'] as const) {
        const next = ragged(i, a);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(5);
      }
    }
  });

  it('an empty grid has no cursor to move', () => {
    expect(moveCursor(0, 0, 2, 'right')).toBe(0);
  });
});
