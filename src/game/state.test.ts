import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  CENTER_LANE,
  GameStore,
  LANE_COUNT,
} from './state.ts';

describe('GameStore', () => {
  it('starts in the menu, centred, stopped, with nothing collected', () => {
    const store = new GameStore();
    expect(store.getState()).toEqual({
      status: 'menu',
      score: 0,
      lane: CENTER_LANE,
      speed: 0,
      friends: 0,
    });
  });

  it('transitions menu -> playing -> gameover and preserves score/friends', () => {
    const store = new GameStore();

    store.start();
    expect(store.getState().status).toBe('playing');
    expect(store.getState().speed).toBe(BASE_SPEED);

    store.addScore(10);
    store.addScore(5);
    store.addFriends();
    store.addFriends(2);
    expect(store.getState().score).toBe(15);
    expect(store.getState().friends).toBe(3);

    store.gameOver();
    expect(store.getState().status).toBe('gameover');
    // score and friends survive the transition; motion stops.
    expect(store.getState().score).toBe(15);
    expect(store.getState().friends).toBe(3);
    expect(store.getState().speed).toBe(0);
  });

  it('ignores score/friend/lane-driving actions outside of play', () => {
    const store = new GameStore();
    store.addScore(10);
    store.addFriends(4);
    expect(store.getState().score).toBe(0);
    expect(store.getState().friends).toBe(0);
  });

  it('clamps lane requests into 0..LANE_COUNT-1', () => {
    const store = new GameStore();
    store.start();

    store.setLane(0);
    expect(store.getState().lane).toBe(0);

    store.setLane(-5);
    expect(store.getState().lane).toBe(0);

    store.setLane(LANE_COUNT + 10);
    expect(store.getState().lane).toBe(LANE_COUNT - 1);

    // fractional requests round to the nearest lane.
    store.setLane(1.4);
    expect(store.getState().lane).toBe(1);
    store.setLane(1.6);
    expect(store.getState().lane).toBe(2);
  });

  it('setSpeed never goes negative', () => {
    const store = new GameStore();
    store.setSpeed(40);
    expect(store.getState().speed).toBe(40);
    store.setSpeed(-99);
    expect(store.getState().speed).toBe(0);
  });

  it('restart from gameover returns a clean, playable state', () => {
    const store = new GameStore();
    store.start();
    store.addScore(50);
    store.addFriends(3);
    store.setLane(2);
    store.gameOver();

    // start() from gameover is the restart path.
    store.start();
    expect(store.getState()).toEqual({
      status: 'playing',
      score: 0,
      lane: CENTER_LANE,
      speed: BASE_SPEED,
      friends: 0,
    });
  });

  it('reset() returns to a clean menu', () => {
    const store = new GameStore();
    store.start();
    store.addScore(20);
    store.setLane(0);
    store.reset();
    expect(store.getState()).toEqual({
      status: 'menu',
      score: 0,
      lane: CENTER_LANE,
      speed: 0,
      friends: 0,
    });
  });

  it('start() is a no-op while already playing', () => {
    const store = new GameStore();
    store.start();
    store.addScore(7);
    store.start();
    expect(store.getState().score).toBe(7);
  });

  it('notifies subscribers on transition, not on no-op setLane', () => {
    const store = new GameStore();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.status));

    store.start();
    store.setLane(CENTER_LANE); // same lane -> no notification
    store.gameOver();

    expect(seen).toEqual(['playing', 'gameover']);
  });
});
