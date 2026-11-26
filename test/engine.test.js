import { describe, it, expect } from 'vitest';
import { loadEnginePref, saveEnginePref, ENGINE_PREF_KEY } from '../src/lib/engine.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

describe('engine preference', () => {
  it('defaults to Muse when nothing is stored', () => {
    expect(loadEnginePref(fakeStorage())).toBe('Muse');
  });

  it('round-trips groq and normalizes junk to Muse', () => {
    const s = fakeStorage();
    saveEnginePref('groq', s);
    expect(s.map.get(ENGINE_PREF_KEY)).toBe('groq');
    expect(loadEnginePref(s)).toBe('groq');
    saveEnginePref('something-else', s);
    expect(loadEnginePref(s)).toBe('Muse');
  });

  it('survives a throwing storage', () => {
    const broken = {
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
    };
    expect(loadEnginePref(broken)).toBe('Muse');
    expect(() => saveEnginePref('groq', broken)).not.toThrow();
  });
});
