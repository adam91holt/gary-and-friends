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
      selectedGame: 'highway',
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

  it('ignores score/friend/lane/speed actions outside of play', () => {
    const store = new GameStore();
    store.addScore(10);
    store.addFriends(4);
    store.setLane(2);
    store.setSpeed(40);
    expect(store.getState()).toEqual({
      status: 'menu',
      score: 0,
      lane: CENTER_LANE,
      speed: 0,
      friends: 0,
      selectedGame: 'highway',
    });

    store.start();
    store.setLane(2);
    store.gameOver();
    store.setLane(0);
    store.setSpeed(40);
    expect(store.getState().lane).toBe(2);
    expect(store.getState().speed).toBe(0);
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

  it('setSpeed changes playing speed but never goes negative', () => {
    const store = new GameStore();
    store.start();
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
      selectedGame: 'highway',
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
      selectedGame: 'highway',
    });
  });

  it('start() is a no-op while already playing', () => {
    const store = new GameStore();
    store.start();
    store.addScore(7);
    store.start();
    expect(store.getState().score).toBe(7);
  });

  it('boots pointed at the highway', () => {
    expect(new GameStore().getState().selectedGame).toBe('highway');
  });

  it('selectGame switches the cabinet from the menu', () => {
    const store = new GameStore();
    store.selectGame('coneball');
    expect(store.getState().selectedGame).toBe('coneball');
    // Nothing else moved: selection is not a run.
    expect(store.getState().status).toBe('menu');
    expect(store.getState().speed).toBe(0);
  });

  it('selectGame is refused while playing and at gameover', () => {
    const store = new GameStore();
    store.selectGame('tower');
    store.start();
    store.selectGame('coneball');
    expect(store.getState().selectedGame).toBe('tower');

    store.gameOver();
    store.selectGame('royal-roll');
    expect(store.getState().selectedGame).toBe('tower');
  });

  it('start() carries the selected game into the run', () => {
    const store = new GameStore();
    store.selectGame('royal-roll');
    store.start();
    expect(store.getState().selectedGame).toBe('royal-roll');
    expect(store.getState().status).toBe('playing');
  });

  it('restart from gameover replays the same game', () => {
    const store = new GameStore();
    store.selectGame('coneball');
    store.start();
    store.addScore(30);
    store.gameOver();
    store.start();
    expect(store.getState().selectedGame).toBe('coneball');
    expect(store.getState().score).toBe(0);
  });

  it('returnToMenu clears the run but keeps the selection', () => {
    const store = new GameStore();
    store.selectGame('tower');
    store.start();
    store.addScore(90);
    store.addFriends(2);
    store.setLane(0);
    store.gameOver();

    store.returnToMenu();
    expect(store.getState()).toEqual({
      status: 'menu',
      score: 0,
      lane: CENTER_LANE,
      speed: 0,
      friends: 0,
      selectedGame: 'tower',
    });
  });

  it('returnToMenu is refused from the menu and mid-run', () => {
    const store = new GameStore();
    store.returnToMenu();
    expect(store.getState().status).toBe('menu');

    store.start();
    store.addScore(12);
    store.returnToMenu();
    // A live run cannot be abandoned to the menu: only gameover offers the door.
    expect(store.getState().status).toBe('playing');
    expect(store.getState().score).toBe(12);
  });

  it('reset() returns to the default game as well as the default state', () => {
    const store = new GameStore();
    store.selectGame('coneball');
    store.reset();
    expect(store.getState().selectedGame).toBe('highway');
  });

  it('selecting the already-selected game notifies nobody', () => {
    const store = new GameStore();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.selectedGame));

    store.selectGame('tower');
    store.selectGame('tower');
    store.selectGame('highway');

    expect(seen).toEqual(['tower', 'highway']);
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
