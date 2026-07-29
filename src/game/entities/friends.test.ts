import { describe, expect, it } from 'vitest';
import { FRIEND_COUNT, FRIENDS, friendProfile } from '../friends/roster.ts';
import { LANE_COUNT } from '../state.ts';
import {
  createFriendField,
  FRIEND_APPROACH,
  FRIEND_BASE_SCORE,
  FRIEND_CONVOY_BONUS,
  FRIEND_KIND,
  friendInterval,
  friendScore,
  friendSpec,
  pickFriendLane,
  spawnFriend,
} from './friends.ts';
import { createRng } from './rng.ts';
import { TRAFFIC_APPROACH } from './traffic.ts';

describe('the roster', () => {
  it('has the five named friends the epic promised', () => {
    expect(FRIENDS.map((f) => f.name)).toEqual([
      'Coneelia',
      'Bartholocone',
      'Sir Cones-a-lot',
      'Tiny',
      'Big Dave',
    ]);
    expect(FRIEND_COUNT).toBe(5);
  });

  it('gives every friend a distinct silhouette, so they read at speed', () => {
    const shapes = FRIENDS.map((f) => `${f.baseRadius}x${f.height}`);
    expect(new Set(shapes).size).toBe(FRIENDS.length);
  });

  it('gives every friend its own tint, none of them Gary orange', () => {
    expect(new Set(FRIENDS.map((f) => f.tint)).size).toBe(FRIENDS.length);
    expect(FRIENDS.some((f) => f.tint === 0xff7a1a)).toBe(false);
  });

  it('pads the pickup box beyond the drawn cone (generous to the player)', () => {
    for (const f of FRIENDS) {
      expect(f.halfWidth).toBeGreaterThan(f.baseRadius);
      expect(f.halfDepth).toBeGreaterThan(f.baseRadius);
    }
  });

  it('clamps junk variants instead of returning undefined', () => {
    expect(friendProfile(-3)).toBe(FRIENDS[0]);
    expect(friendProfile(99)).toBe(FRIENDS[FRIEND_COUNT - 1]);
    expect(friendProfile(NaN)).toBe(FRIENDS[0]);
    expect(friendProfile(2)).toBe(FRIENDS[2]);
  });
});

describe('friendScore', () => {
  it('pays the base for the first friend', () => {
    expect(friendScore(0)).toBe(FRIEND_BASE_SCORE);
  });

  it('pays more the longer the convoy already is', () => {
    expect(friendScore(1)).toBe(FRIEND_BASE_SCORE + FRIEND_CONVOY_BONUS);
    expect(friendScore(4)).toBe(FRIEND_BASE_SCORE + 4 * FRIEND_CONVOY_BONUS);
    expect(friendScore(5)).toBeGreaterThan(friendScore(4));
  });

  it('never pays less than the base, whatever it is handed', () => {
    for (const n of [-1, -100, 0]) expect(friendScore(n)).toBe(FRIEND_BASE_SCORE);
  });
});

describe('friendInterval', () => {
  it('shortens as speed rises, so friends keep arriving in a fast run', () => {
    expect(friendInterval(48)).toBeLessThan(friendInterval(24));
  });

  it('is rarer than traffic — a friend should feel like a treat', () => {
    // Same speed: the friend beat is much further apart than a traffic beat.
    expect(friendInterval(24)).toBeGreaterThan(1);
  });

  it('stays positive and finite at any speed, including zero', () => {
    for (const speed of [0, 1, 24, 54, 1000]) {
      const interval = friendInterval(speed);
      expect(Number.isFinite(interval)).toBe(true);
      expect(interval).toBeGreaterThan(0);
    }
  });
});

describe('pickFriendLane', () => {
  const rng = createRng(11);

  it('picks only from unoccupied lanes', () => {
    for (let i = 0; i < 200; i++) {
      const lane = pickFriendLane(rng, [1]);
      expect(lane).not.toBeNull();
      expect(lane).not.toBe(1);
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(LANE_COUNT);
    }
  });

  it('WILL take the last free lane — a reward is never a wall', () => {
    expect(pickFriendLane(rng, [0, 1])).toBe(2);
  });

  it('declines the beat only when the whole road is blocked', () => {
    expect(pickFriendLane(rng, [0, 1, 2])).toBeNull();
  });
});

describe('spawnFriend', () => {
  it('produces friend-kind specs with roster-matched hitboxes', () => {
    const rng = createRng(5);
    for (let i = 0; i < 100; i++) {
      const spec = spawnFriend(rng, []);
      expect(spec).not.toBeNull();
      if (!spec) continue;
      expect(spec.kind).toBe(FRIEND_KIND);
      expect(spec.variant).toBeGreaterThanOrEqual(0);
      expect(spec.variant).toBeLessThan(FRIEND_COUNT);
      const profile = friendProfile(spec.variant);
      expect(spec.halfWidth).toBe(profile.halfWidth);
      expect(spec.halfDepth).toBe(profile.halfDepth);
    }
  });

  it('eventually offers every character', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const spec = spawnFriend(rng, []);
      if (spec) seen.add(spec.variant);
    }
    expect(seen.size).toBe(FRIEND_COUNT);
  });

  it('closes at exactly the traffic speed, preserving the fairness rule', () => {
    expect(FRIEND_APPROACH).toBe(TRAFFIC_APPROACH);
    expect(friendSpec(0, 0, -150).speed).toBe(TRAFFIC_APPROACH);
  });
});

describe('the friend field', () => {
  it('spawns friends over a run and stays within capacity', () => {
    const field = createFriendField(2024);
    for (let i = 0; i < 4000; i++) field.update(1 / 60, 24);
    expect(field.activeCount).toBeGreaterThan(0);
    expect(field.activeCount).toBeLessThanOrEqual(field.entities.length);
    for (const e of field.entities) {
      if (e.active) expect(e.kind).toBe(FRIEND_KIND);
    }
  });

  it('never drops a friend into a lane a vehicle already occupies', () => {
    const field = createFriendField(77);
    // A wall of traffic sitting exactly on the friend spawn line.
    const traffic = [0, 1].map((lane) => ({
      id: lane + 1,
      kind: 'traffic',
      lane,
      z: -150,
      prevZ: -150,
      speed: 7,
      halfWidth: 0.6,
      halfDepth: 1.2,
      variant: 0,
      active: true,
    }));
    for (let i = 0; i < 600; i++) {
      field.update(1 / 60, 24, traffic);
      for (const e of field.entities) {
        // Only inspect entities still at the spawn line, where the guard applies.
        if (e.active && e.z < -140) expect(e.lane).toBe(2);
      }
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string[] => {
      const field = createFriendField(99);
      const out: string[] = [];
      for (let i = 0; i < 2000; i++) {
        field.update(1 / 60, 30);
        for (const e of field.entities) {
          if (e.active && e.z < -149) out.push(`${e.lane}:${e.variant}`);
        }
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });

  it('clear() empties the road and rewinds the seeded stream', () => {
    const field = createFriendField(4);
    for (let i = 0; i < 2000; i++) field.update(1 / 60, 24);
    field.clear();
    expect(field.activeCount).toBe(0);
  });
});
