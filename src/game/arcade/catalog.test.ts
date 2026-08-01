import { describe, expect, it } from 'vitest';
import { FRIENDS } from '../friends/roster.ts';
import { castSize, GAMES, gameEntry, GRID_COLUMNS } from './catalog.ts';
import { GAME_IDS, isGameId } from './contracts.ts';

describe('the game catalog', () => {
  it('has exactly one entry per declared game id, in the same order', () => {
    expect(GAMES.map((g) => g.id)).toEqual([...GAME_IDS]);
  });

  it('ids are unique', () => {
    const ids = GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every id narrows through the type guard, and junk does not', () => {
    for (const game of GAMES) expect(isGameId(game.id)).toBe(true);
    expect(isGameId('pinball')).toBe(false);
    expect(isGameId('')).toBe(false);
    expect(isGameId(null)).toBe(false);
    expect(isGameId(0)).toBe(false);
  });

  it('ids are safe to use as storage-key fragments and DOM attributes', () => {
    for (const game of GAMES) {
      expect(game.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('every cast index lands inside the friends roster', () => {
    for (const game of GAMES) {
      for (const index of game.cast.friends) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(FRIENDS.length);
      }
    }
  });

  it('never bills the same friend twice on one card', () => {
    for (const game of GAMES) {
      const cast = game.cast.friends;
      expect(new Set(cast).size).toBe(cast.length);
    }
  });

  it('every game bills somebody', () => {
    for (const game of GAMES) expect(castSize(game)).toBeGreaterThan(0);
  });

  it('every entry carries the copy a card needs to render', () => {
    for (const game of GAMES) {
      expect(game.title.length).toBeGreaterThan(0);
      expect(game.shortTitle.length).toBeGreaterThan(0);
      // A description short enough to be a label isn't a description.
      expect(game.description.length).toBeGreaterThan(30);
      expect(game.controls.length).toBeGreaterThanOrEqual(2);
      for (const hint of game.controls) {
        expect(hint.keys.length).toBeGreaterThan(0);
        expect(hint.action.length).toBeGreaterThan(0);
      }
    }
  });

  it('titles and short titles are unique, so no two cards read alike', () => {
    expect(new Set(GAMES.map((g) => g.title)).size).toBe(GAMES.length);
    expect(new Set(GAMES.map((g) => g.shortTitle)).size).toBe(GAMES.length);
  });

  it('every preview is a Vite-resolved webp URL', () => {
    for (const game of GAMES) {
      expect(typeof game.preview).toBe('string');
      expect(game.preview.length).toBeGreaterThan(0);
      expect(game.preview).toContain('.webp');
      // A hand-written path would mean the file isn't in the graph and would
      // survive being deleted. Vite always resolves through src/assets.
      expect(game.preview).toMatch(/previews[/\\-]/);
    }
    // Whether the emitted URL is base-relative (it must be — production is a
    // GitHub Pages SUBPATH) depends on the BUILD, not on this module, so that
    // is asserted against the real bundle in e2e/arcade-menu.spec.ts.
  });

  it('previews are distinct — no card borrows another game’s art', () => {
    expect(new Set(GAMES.map((g) => g.preview)).size).toBe(GAMES.length);
  });

  it('the highway and Royal Roll are the playable games today', () => {
    expect(gameEntry('highway').playable).toBe(true);
    expect(gameEntry('royal-roll').playable).toBe(true);
    expect(GAMES.filter((g) => g.playable).map((g) => g.id)).toEqual([
      'highway',
      'royal-roll',
    ]);
  });

  it('gameEntry round-trips every id and throws on an unknown one', () => {
    for (const game of GAMES) expect(gameEntry(game.id)).toBe(game);
    expect(() =>
      gameEntry('pinball' as unknown as (typeof GAME_IDS)[number]),
    ).toThrow(/Unknown game id/);
  });

  it('the grid is wide enough to be a grid', () => {
    expect(GRID_COLUMNS).toBeGreaterThanOrEqual(2);
    expect(GAMES.length).toBeGreaterThanOrEqual(GRID_COLUMNS);
  });
});
