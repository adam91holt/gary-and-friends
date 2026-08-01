import { describe, expect, it } from 'vitest';
import { GAME_IDS } from './arcade/contracts.ts';
import {
  HIGH_SCORE_KEY,
  highScoreKey,
  isNewBest,
  loadAllHighScores,
  loadGameHighScore,
  loadHighScore,
  parseHighScore,
  resolveHighScore,
  submitGameHighScore,
  submitHighScore,
  type StoragePort,
} from './highScore.ts';

/** An in-memory stand-in for localStorage — the persistence boundary as data. */
function memoryStorage(initial: Record<string, string> = {}): StoragePort & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** A browser with storage disabled: every access throws. */
const hostileStorage: StoragePort = {
  getItem() {
    throw new Error('SecurityError: storage disabled');
  },
  setItem() {
    throw new Error('SecurityError: storage disabled');
  },
};

describe('parseHighScore', () => {
  it('reads a stored integer', () => {
    expect(parseHighScore('420')).toBe(420);
  });

  it('floors fractional stored values', () => {
    expect(parseHighScore('420.9')).toBe(420);
  });

  it('treats a missing or junk value as no score', () => {
    expect(parseHighScore(null)).toBe(0);
    expect(parseHighScore('')).toBe(0);
    expect(parseHighScore('NaN')).toBe(0);
    expect(parseHighScore('not a score')).toBe(0);
    expect(parseHighScore('-17')).toBe(0);
    expect(parseHighScore('Infinity')).toBe(0);
    expect(parseHighScore('999999999999999999999')).toBe(0);
  });
});

describe('isNewBest', () => {
  it('is true only when strictly greater', () => {
    expect(isNewBest(101, 100)).toBe(true);
    expect(isNewBest(100, 100)).toBe(false);
    expect(isNewBest(99, 100)).toBe(false);
  });

  it('counts any positive score as a best when there is none yet', () => {
    expect(isNewBest(1, 0)).toBe(true);
    expect(isNewBest(0, 0)).toBe(false);
  });

  it('rejects non-finite scores', () => {
    expect(isNewBest(Number.NaN, 0)).toBe(false);
    expect(isNewBest(Number.POSITIVE_INFINITY, 0)).toBe(false);
  });
});

describe('resolveHighScore', () => {
  it('reports and keeps a new best', () => {
    expect(resolveHighScore(250, 100)).toEqual({ best: 250, isNew: true });
  });

  it('holds the old best when the run fell short', () => {
    expect(resolveHighScore(50, 100)).toEqual({ best: 100, isNew: false });
  });

  it('ties do not claim a record', () => {
    expect(resolveHighScore(100, 100)).toEqual({ best: 100, isNew: false });
  });
});

describe('persistence boundary', () => {
  it('loads a previously stored best', () => {
    const storage = memoryStorage({ [HIGH_SCORE_KEY]: '888' });
    expect(loadHighScore(storage)).toBe(888);
  });

  it('loads 0 with no storage at all', () => {
    expect(loadHighScore(null)).toBe(0);
  });

  it('writes only when the run beat the best', () => {
    const storage = memoryStorage();

    expect(submitHighScore(storage, 120, 0)).toEqual({ best: 120, isNew: true });
    expect(storage.data[HIGH_SCORE_KEY]).toBe('120');

    expect(submitHighScore(storage, 90, 120)).toEqual({
      best: 120,
      isNew: false,
    });
    expect(storage.data[HIGH_SCORE_KEY]).toBe('120');

    expect(submitHighScore(storage, 500, 120)).toEqual({
      best: 500,
      isNew: true,
    });
    expect(storage.data[HIGH_SCORE_KEY]).toBe('500');
  });

  it('round-trips through the stored string', () => {
    const storage = memoryStorage();
    submitHighScore(storage, 1337, 0);
    expect(loadHighScore(storage)).toBe(1337);
  });

  it('degrades gracefully when storage throws', () => {
    expect(loadHighScore(hostileStorage)).toBe(0);
    // Still reports the session best; it simply will not survive a reload.
    expect(submitHighScore(hostileStorage, 300, 10)).toEqual({
      best: 300,
      isNew: true,
    });
  });
});

describe('per-game keys', () => {
  it('keeps the highway on its original un-namespaced key', () => {
    // Load-bearing for upgrades: an existing player's record lives here.
    expect(highScoreKey('highway')).toBe('gary.highScore.v1');
    expect(HIGH_SCORE_KEY).toBe('gary.highScore.v1');
  });

  it('namespaces every other game', () => {
    expect(highScoreKey('tower')).toBe('gary.highScore.tower.v1');
    expect(highScoreKey('coneball')).toBe('gary.highScore.coneball.v1');
    expect(highScoreKey('royal-roll')).toBe('gary.highScore.royal-roll.v1');
  });

  it('gives every game a distinct key', () => {
    const keys = GAME_IDS.map(highScoreKey);
    expect(new Set(keys).size).toBe(GAME_IDS.length);
  });

  it('a pre-arcade stored best is still read as the highway best', () => {
    // The exact upgrade scenario: storage written before the cabinet existed.
    const storage = memoryStorage({ 'gary.highScore.v1': '4242' });
    expect(loadGameHighScore(storage, 'highway')).toBe(4242);
    expect(loadHighScore(storage)).toBe(4242);
    // ...and it did NOT leak into the new games.
    expect(loadGameHighScore(storage, 'tower')).toBe(0);
  });

  it('records are independent per game', () => {
    const storage = memoryStorage();

    expect(submitGameHighScore(storage, 'tower', 80, 0)).toEqual({
      best: 80,
      isNew: true,
    });
    expect(submitGameHighScore(storage, 'coneball', 12, 0)).toEqual({
      best: 12,
      isNew: true,
    });

    expect(storage.data['gary.highScore.tower.v1']).toBe('80');
    expect(storage.data['gary.highScore.coneball.v1']).toBe('12');
    // Beating the tower record must not touch coneball's, or the highway's.
    expect(submitGameHighScore(storage, 'tower', 500, 80).best).toBe(500);
    expect(loadGameHighScore(storage, 'coneball')).toBe(12);
    expect(loadGameHighScore(storage, 'highway')).toBe(0);
  });

  it('a worse run leaves that game’s key untouched', () => {
    const storage = memoryStorage({ 'gary.highScore.tower.v1': '300' });
    expect(submitGameHighScore(storage, 'tower', 200, 300)).toEqual({
      best: 300,
      isNew: false,
    });
    expect(storage.data['gary.highScore.tower.v1']).toBe('300');
  });

  it('loadAllHighScores reports one number per game', () => {
    const storage = memoryStorage({
      'gary.highScore.v1': '900',
      'gary.highScore.coneball.v1': '17',
    });
    expect(loadAllHighScores(storage, GAME_IDS)).toEqual({
      highway: 900,
      tower: 0,
      coneball: 17,
      'royal-roll': 0,
    });
  });

  it('loadAllHighScores degrades to zeroes without storage', () => {
    expect(loadAllHighScores(null, GAME_IDS)).toEqual({
      highway: 0,
      tower: 0,
      coneball: 0,
      'royal-roll': 0,
    });
    expect(loadAllHighScores(hostileStorage, GAME_IDS).tower).toBe(0);
  });
});
