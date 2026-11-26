import { describe, it, expect, vi } from 'vitest';
import { postJson, getJson, exchangeSession, ask, rename, deleteRequest } from '../src/lib/api.js';

function okFetcher(data, seen) {
  return vi.fn(async (url, init) => {
    if (seen) seen.push({ url, init });
    return { ok: true, status: 200, json: async () => data };
  });
}

describe('api wrapper', () => {
  it('posts JSON as text/plain (GAS CORS pattern)', async () => {
    const seen = [];
    const data = await postJson({ action: 'ask' }, { apiUrl: 'https://example.invalid/exec', fetcher: okFetcher({ ok: true, id: 'x' }, seen) });
    expect(data.id).toBe('x');
    expect(seen[0].init.headers['Content-Type']).toContain('text/plain');
    expect(JSON.parse(seen[0].init.body)).toEqual({ action: 'ask' });
  });

  it('maps ok:false to an error with the server error name', async () => {
    await expect(
      postJson({ action: 'ask' }, { apiUrl: 'https://example.invalid/exec', fetcher: okFetcher({ ok: false, error: 'unauthorized' }) }),
    ).rejects.toThrow('unauthorized');
  });

  it('builds GET queries for result/list', async () => {
    const seen = [];
    await getJson({ action: 'list', sessionToken: 'tok' }, { apiUrl: 'https://example.invalid/exec', fetcher: okFetcher({ ok: true, requests: [] }, seen) });
    expect(seen[0].url).toContain('action=list');
    expect(seen[0].url).toContain('sessionToken=tok');
  });

  it('rename and delete send the documented bodies', async () => {
    const seen = [];
    const f = okFetcher({ ok: true, id: 'x', title: 't' }, seen);
    await rename('s', 'x', 'Dummy title', { apiUrl: 'https://example.invalid/exec', fetcher: f });
    expect(JSON.parse(seen[0].init.body)).toEqual({ action: 'rename', sessionToken: 's', id: 'x', title: 'Dummy title' });
    await deleteRequest('s', 'x', { apiUrl: 'https://example.invalid/exec', fetcher: f });
    expect(JSON.parse(seen[1].init.body)).toEqual({ action: 'delete', sessionToken: 's', id: 'x' });
  });

  it('exchange_session and ask send the documented bodies', async () => {
    const seen = [];
    const f = okFetcher({ ok: true, sessionToken: 's' }, seen);
    await exchangeSession('id-token', { apiUrl: 'https://example.invalid/exec', fetcher: f });
    expect(JSON.parse(seen[0].init.body)).toEqual({ action: 'exchange_session', idToken: 'id-token' });
    await ask('s', 'hello', undefined, { apiUrl: 'https://example.invalid/exec', fetcher: f });
    expect(JSON.parse(seen[1].init.body)).toEqual({ action: 'ask', sessionToken: 's', prompt: 'hello' });
  });

  it('ask sends engine only for groq conversations', async () => {
    const seen = [];
    const f = okFetcher({ ok: true, id: 'x', status: 'replied', engine: 'groq' }, seen);
    await ask('s', 'quick question', 'groq', { apiUrl: 'https://example.invalid/exec', fetcher: f });
    expect(JSON.parse(seen[0].init.body)).toEqual({ action: 'ask', sessionToken: 's', prompt: 'quick question', engine: 'groq' });
    await ask('s', 'deep request', 'Muse', { apiUrl: 'https://example.invalid/exec', fetcher: f });
    expect(JSON.parse(seen[1].init.body)).toEqual({ action: 'ask', sessionToken: 's', prompt: 'deep request' });
  });
});
