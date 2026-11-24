import { describe, it, expect } from 'vitest';
import { normalizeBase, listPath, threadPath, threadIdFromPath, isThreadId } from '../src/lib/route.js';

const PROD = '/muse/';
const STAGING = '/muse/staging/';
const ID = 'abc123-def_456';

describe('normalizeBase / listPath', () => {
  it('keeps a well-formed base and repairs missing slashes', () => {
    expect(normalizeBase(PROD)).toBe('/muse/');
    expect(normalizeBase('/muse')).toBe('/muse/');
    expect(normalizeBase('muse')).toBe('/muse/');
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase(undefined)).toBe('/');
    expect(listPath(STAGING)).toBe('/muse/staging/');
  });
});

describe('threadPath', () => {
  it('builds a thread URL under each base', () => {
    expect(threadPath(ID, PROD)).toBe(`/muse/${ID}`);
    expect(threadPath(ID, STAGING)).toBe(`/muse/staging/${ID}`);
    expect(threadPath(ID, '/')).toBe(`/${ID}`);
  });

  it('falls back to the list path for a bad id', () => {
    expect(threadPath('', PROD)).toBe('/muse/');
    expect(threadPath('a/b', PROD)).toBe('/muse/');
    expect(threadPath(null, PROD)).toBe('/muse/');
  });
});

describe('threadIdFromPath', () => {
  it('parses a thread id under each base', () => {
    expect(threadIdFromPath(`/muse/${ID}`, PROD)).toBe(ID);
    expect(threadIdFromPath(`/muse/staging/${ID}`, STAGING)).toBe(ID);
    // a trailing slash is tolerated
    expect(threadIdFromPath(`/muse/${ID}/`, PROD)).toBe(ID);
    // a UUID-shaped id parses as-is
    expect(threadIdFromPath('/muse/123e4567-e89b-12d3-a456-426614174000', PROD)).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('returns null for the list path and for other apps', () => {
    expect(threadIdFromPath('/muse/', PROD)).toBeNull();
    expect(threadIdFromPath('/muse', PROD)).toBeNull();
    expect(threadIdFromPath('/other/abc', PROD)).toBeNull();
    expect(threadIdFromPath('/', PROD)).toBeNull();
  });

  it('returns null for multi-segment or invalid-character paths', () => {
    expect(threadIdFromPath('/muse/a/b', PROD)).toBeNull();
    expect(threadIdFromPath('/muse/staging/extra', PROD)).toBeNull();
    expect(threadIdFromPath('/muse/a%20b', PROD)).toBeNull();
    expect(threadIdFromPath('/muse/a.b', PROD)).toBeNull();
    expect(threadIdFromPath('/muse/日本語', PROD)).toBeNull();
    expect(threadIdFromPath('', PROD)).toBeNull();
    expect(threadIdFromPath(null, PROD)).toBeNull();
    expect(threadIdFromPath(undefined, PROD)).toBeNull();
  });

  it('round-trips with threadPath', () => {
    expect(threadIdFromPath(threadPath(ID, PROD), PROD)).toBe(ID);
    expect(threadIdFromPath(threadPath(ID, STAGING), STAGING)).toBe(ID);
  });
});

describe('isThreadId', () => {
  it('accepts only one segment of safe characters', () => {
    expect(isThreadId(ID)).toBe(true);
    expect(isThreadId('a/b')).toBe(false);
    expect(isThreadId('')).toBe(false);
    expect(isThreadId(42)).toBe(false);
  });
});
