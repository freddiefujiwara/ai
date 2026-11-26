import { describe, it, expect } from 'vitest';
import {
  seenKey, loadSeen, saveSeen, seedSeen, markSeen, pruneSeen, isUnread, unreadIds,
} from '../src/lib/seen.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const req = (id, status, round) => ({ id, status, round });

describe('seen storage', () => {
  it('splits keys between production and staging', () => {
    expect(seenKey({})).toBe('ai:seen:v1');
    expect(seenKey({ VITE_STAGING: '1' })).toBe('ai:seen:v1:staging');
  });

  it('returns null when the key is absent (first run) and {} when stored empty', () => {
    const st = fakeStorage();
    expect(loadSeen(st, {})).toBeNull();
    saveSeen({}, st, {});
    expect(loadSeen(st, {})).toEqual({});
  });

  it('round-trips the seen map and drops malformed entries', () => {
    const st = fakeStorage();
    saveSeen({ a: { repliedRound: 2 }, b: { repliedRound: 'x' }, c: 3 }, st, {});
    expect(loadSeen(st, {})).toEqual({ a: { repliedRound: 2 } });
  });
});

describe('unread detection', () => {
  it('flags a replied thread whose round has not been seen', () => {
    expect(isUnread(req('a', 'replied', 1), {})).toBe(true);
    expect(isUnread(req('a', 'replied', 2), { a: { repliedRound: 1 } })).toBe(true);
  });

  it('does not flag a seen reply, a pending thread, or a timeout', () => {
    const seen = { a: { repliedRound: 1 }, b: { repliedRound: 1 }, c: { repliedRound: 1 } };
    expect(isUnread(req('a', 'replied', 1), seen)).toBe(false);
    expect(isUnread(req('b', 'pending', 2), seen)).toBe(false);
    expect(isUnread(req('c', 'timeout', 2), seen)).toBe(false);
  });

  it('collects unread ids across the list', () => {
    const list = [req('a', 'replied', 3), req('b', 'replied', 1), req('c', 'pending', 1)];
    expect(unreadIds(list, { a: { repliedRound: 2 }, b: { repliedRound: 1 } })).toEqual(['a']);
  });
});

describe('seed / mark / prune', () => {
  it('seeds only replied threads as seen (first-run baseline)', () => {
    const list = [req('a', 'replied', 2), req('b', 'pending', 1), req('c', 'timeout', 4)];
    expect(seedSeen(list)).toEqual({ a: { repliedRound: 2 } });
    // After seeding, existing replies are not unread, but a newer
    // round of replies is.
    const seen = seedSeen(list);
    expect(isUnread(req('a', 'replied', 2), seen)).toBe(false);
    expect(isUnread(req('a', 'replied', 3), seen)).toBe(true);
  });

  it('markSeen returns a new map with the round recorded', () => {
    const before = { a: { repliedRound: 1 } };
    const after = markSeen(before, 'a', 2);
    expect(after).toEqual({ a: { repliedRound: 2 } });
    expect(before).toEqual({ a: { repliedRound: 1 } });
  });

  it('pruneSeen drops entries for threads no longer in the list', () => {
    const seen = { a: { repliedRound: 1 }, gone: { repliedRound: 5 } };
    expect(pruneSeen(seen, [req('a', 'replied', 1)])).toEqual({ a: { repliedRound: 1 } });
  });
});
