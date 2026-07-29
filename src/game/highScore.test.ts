import { describe, expect, it } from 'vitest';
import {
  HIGH_SCORE_KEY,
  isNewBest,
  loadHighScore,
  parseHighScore,
  resolveHighScore,
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
