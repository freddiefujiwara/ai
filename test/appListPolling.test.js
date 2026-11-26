import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from 'vue';

vi.mock('../src/lib/api.js', () => ({
  exchangeSession: vi.fn(),
  ask: vi.fn(),
  answer: vi.fn(),
  result: vi.fn(),
  listRequests: vi.fn(),
  rename: vi.fn(),
  deleteRequest: vi.fn(),
}));

import App from '../src/App.vue';
import { listRequests, result } from '../src/lib/api.js';

const THREAD = {
  id: 'c1', status: 'pending', round: 1,
  created_at: '2026-11-25T01:00:00.000Z', last_activity_at: '2026-11-25T01:00:00.000Z',
  title: '', preview: 'ポーリング確認用の会話',
};

let app;
let el;

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(
    'ai:session:v1',
    JSON.stringify({ token: 'dummy', role: 'owner', expiresAt: '2999-01-01T00:00:00.000Z' }),
  );
  // Seen storage initialized (empty): replies are unread until opened.
  localStorage.setItem('ai:seen:v1', '{}');
  document.body.innerHTML = '';
  el = document.createElement('div');
  document.body.appendChild(el);
});

afterEach(() => {
  if (app) app.unmount();
  app = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('list background polling and unread flags', () => {
  it('refreshes the list every 60s, flags a new reply as unread, and clears it once opened', async () => {
    let current = [{ ...THREAD }];
    listRequests.mockImplementation(async () => ({ ok: true, requests: current }));
    result.mockImplementation(async () => ({
      ok: true, id: 'c1', status: 'replied', round: 1, title: '',
      messages: [
        { round: 1, direction: 'out', text: '依頼です', at: '2026-11-25T01:00:00.000Z' },
        { round: 1, direction: 'in', text: '返信です', at: '2026-11-25T01:05:00.000Z' },
      ],
    }));

    app = createApp(App);
    app.mount(el);
    await flush();

    // Initial load: one list call, thread shown, no unread flag yet.
    expect(listRequests).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.req-title')?.textContent).toContain('ポーリング確認用の会話');
    expect(el.querySelector('.unread-dot')).toBeNull();
    expect(el.querySelector('.unread-pill')).toBeNull();

    // A reply lands on the server; the next periodic refresh (60s)
    // picks it up without any manual reload and flags it unread.
    current = [{ ...THREAD, status: 'replied', last_activity_at: '2026-11-25T01:05:00.000Z' }];
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(listRequests.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(el.querySelector('.unread-dot')).not.toBeNull();
    expect(el.querySelector('.unread-pill')?.textContent).toContain('未読 1');

    // Opening the thread marks the reply as seen...
    el.querySelector('.request-row').click();
    await flush();
    expect(el.textContent).toContain('返信です');

    // ...and while the thread is open, the list polling stays off
    // (it must not fight the thread polling).
    const callsInThread = listRequests.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(listRequests.mock.calls.length).toBe(callsInThread);

    // Back to the list (popstate): the unread flag is gone.
    window.history.pushState(null, '', '/muse/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();
    expect(el.querySelector('.req-title')?.textContent).toContain('ポーリング確認用の会話');
    expect(el.querySelector('.unread-dot')).toBeNull();
    expect(el.querySelector('.unread-pill')).toBeNull();
  });

  it('places the manual refresh in the header and runs it as a non-blocking background refresh', async () => {
    let calls = 0;
    let releaseRefresh;
    listRequests.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({ ok: true, requests: [{ ...THREAD }] });
      }
      return new Promise((resolve) => {
        releaseRefresh = () => resolve({
          ok: true,
          requests: [{ ...THREAD, status: 'replied', last_activity_at: '2026-11-25T01:05:00.000Z' }],
        });
      });
    });
    result.mockImplementation(async () => ({ ok: true, id: 'c1', status: 'pending', round: 1, title: '', messages: [] }));

    app = createApp(App);
    app.mount(el);
    await flush();

    // Reader places refresh in the global header's session-note area,
    // not in the list action row.
    const header = el.querySelector('.site-nav');
    const refresh = header.querySelector('.session-note .nav-refresh');
    expect(refresh).not.toBeNull();
    expect(refresh.textContent).toContain('更新');
    expect(el.querySelector('.chat-actions .nav-refresh')).toBeNull();
    expect(el.querySelector('.chat-actions .unread-pill')).toBeNull();

    // Clicking it starts a second fetch right away. While that fetch
    // is in flight the button shows the reader-style busy label and
    // the existing list stays on screen (no blocking loading row).
    refresh.click();
    await flush();
    expect(listRequests).toHaveBeenCalledTimes(2);
    expect(refresh.disabled).toBe(true);
    expect(refresh.textContent).toContain('更新中…');
    expect(el.querySelector('.req-title')?.textContent).toContain('ポーリング確認用の会話');
    expect(el.textContent).not.toContain('読み込んでいます…');

    releaseRefresh();
    await flush();
    expect(refresh.disabled).toBe(false);
    expect(refresh.textContent).toContain('更新');
    expect(header.querySelector('.session-note .unread-pill')?.textContent).toContain('未読 1');
    expect(el.querySelector('.unread-dot')).not.toBeNull();
  });

  it('refreshes immediately when returning to the foreground after more than 60s away', async () => {
    listRequests.mockImplementation(async () => ({ ok: true, requests: [{ ...THREAD }] }));
    result.mockImplementation(async () => ({ ok: true, id: 'c1', status: 'pending', round: 1, title: '', messages: [] }));

    app = createApp(App);
    app.mount(el);
    await flush();
    expect(listRequests).toHaveBeenCalledTimes(1);

    // Hide the page, let 61s pass, then show it again: reader-style
    // foreground refresh fires right away (no full interval wait).
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    // While hidden, the interval does not fetch.
    expect(listRequests).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(listRequests).toHaveBeenCalledTimes(2);

    delete document.visibilityState;
  });
});
