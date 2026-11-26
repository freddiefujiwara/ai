import { describe, it, expect } from 'vitest';
import { saveSession, loadSession, clearSession, sessionKey } from '../src/lib/session.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('session storage', () => {
  it('splits keys between production and staging', () => {
    expect(sessionKey({})).toBe('ai:session:v1');
    expect(sessionKey({ VITE_STAGING: '1' })).toBe('ai:session:v1:staging');
  });

  it('round-trips a session and drops it after expiry', () => {
    const st = fakeStorage();
    saveSession({ token: 'tok', role: 'owner', expiresAt: '2999-01-01T00:00:00.000Z' }, st, {});
    expect(loadSession(st, {})?.token).toBe('tok');
    saveSession({ token: 'old', expiresAt: '2000-01-01T00:00:00.000Z' }, st, {});
    expect(loadSession(st, {})).toBeNull();
  });

  it('clears the session', () => {
    const st = fakeStorage();
    saveSession({ token: 'tok' }, st, {});
    clearSession(st, {});
    expect(loadSession(st, {})).toBeNull();
  });
});
