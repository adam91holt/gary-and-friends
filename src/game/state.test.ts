import { describe, expect, it } from 'vitest';
import { GameStore } from './state.ts';

describe('GameStore', () => {
  it('starts in the menu with a zero score', () => {
    const store = new GameStore();
    expect(store.getState()).toEqual({ status: 'menu', score: 0 });
  });

  it('transitions menu -> playing -> gameover and preserves the score', () => {
    const store = new GameStore();

    store.start();
    expect(store.getState().status).toBe('playing');

    store.addScore(10);
    store.addScore(5);
    expect(store.getState().score).toBe(15);

    store.gameOver();
    expect(store.getState().status).toBe('gameover');
    // score survives the transition
    expect(store.getState().score).toBe(15);
  });

  it('notifies subscribers on transition', () => {
    const store = new GameStore();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.status));

    store.start();
    store.gameOver();

    expect(seen).toEqual(['playing', 'gameover']);
  });
});
