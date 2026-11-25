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
  title: '', preview: '詳細確認用の会話',
};

const OUT_MSG = { round: 1, direction: 'out', text: '依頼です', at: '2026-11-25T01:00:00.000Z' };

let app;
let el;

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  // A previous test may have pushed a thread URL; reset it so the
  // app does not deep-link straight into that conversation on mount.
  window.history.pushState(null, '', '/');
  localStorage.clear();
  localStorage.setItem(
    'muse:session:v1',
    JSON.stringify({ token: 'dummy', role: 'owner', expiresAt: '2999-01-01T00:00:00.000Z' }),
  );
  localStorage.setItem('muse:seen:v1', '{}');
  document.body.innerHTML = '';
  el = document.createElement('div');
  document.body.appendChild(el);
  listRequests.mockImplementation(async () => ({ ok: true, requests: [{ ...THREAD }] }));
});

afterEach(() => {
  if (app) app.unmount();
  app = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mountAndOpen(resultImpl) {
  result.mockImplementation(resultImpl);
  app = createApp(App);
  app.mount(el);
  await flush();
  el.querySelector('.request-row').click();
  await flush();
}

describe('thread view header refresh', () => {
  it('shows the refresh button in the header and re-fetches the open thread in the background', async () => {
    let calls = 0;
    let releaseSecond;
    await mountAndOpen(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          ok: true, id: 'c1', status: 'pending', round: 1, title: '',
          messages: [{ ...OUT_MSG }],
        });
      }
      return new Promise((resolve) => {
        releaseSecond = () => resolve({
          ok: true, id: 'c1', status: 'replied', round: 1, title: '',
          messages: [
            { ...OUT_MSG },
            { round: 1, direction: 'in', text: '手動更新で届いた返信です', at: '2026-11-25T01:05:00.000Z' },
          ],
        });
      });
    });
    expect(result).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('依頼です');

    // The header refresh button is present in the thread view too.
    const refresh = el.querySelector('.site-nav .session-note .nav-refresh');
    expect(refresh).not.toBeNull();
    expect(refresh.textContent).toContain('更新');
    expect(refresh.disabled).toBe(false);

    // Clicking re-fetches the open conversation right away. While
    // the fetch is in flight the button shows the busy label, and
    // the thread stays on screen (no blocking loading UI).
    refresh.click();
    await flush();
    expect(result).toHaveBeenCalledTimes(2);
    expect(refresh.disabled).toBe(true);
    expect(refresh.textContent).toContain('更新中…');
    expect(el.querySelector('.thread-loading')).toBeNull();
    expect(el.textContent).toContain('依頼です');

    releaseSecond();
    await flush();
    expect(el.textContent).toContain('手動更新で届いた返信です');
    expect(refresh.disabled).toBe(false);
    expect(refresh.textContent).toContain('更新');
  });

  it('hides the refresh button for a brand-new (unsaved) conversation', async () => {
    result.mockImplementation(async () => ({ ok: true, id: 'c1', status: 'pending', round: 1, title: '', messages: [] }));
    app = createApp(App);
    app.mount(el);
    await flush();
    // List view: the button is there.
    expect(el.querySelector('.site-nav .session-note .nav-refresh')).not.toBeNull();

    // A new conversation has no id yet, so there is nothing to refresh.
    el.querySelector('.chat-actions .primary-btn').click();
    await flush();
    expect(el.querySelector('.thread-title')?.textContent).toContain('新しい会話');
    expect(el.querySelector('.site-nav .session-note .nav-refresh')).toBeNull();
  });
});

describe('reply attachments', () => {
  it('renders attachment thumbnails linked to their url under the message text', async () => {
    await mountAndOpen(async () => ({
      ok: true, id: 'c1', status: 'replied', round: 2, title: '',
      messages: [
        { ...OUT_MSG },
        {
          round: 1, direction: 'in', text: '画像を添付しました', at: '2026-11-25T01:05:00.000Z',
          attachments: [
            { name: 'dummy-one.png', url: 'https://example.com/dummy-one.png' },
            { name: 'dummy-two.png', url: 'https://example.com/dummy-two.png' },
          ],
        },
        { round: 2, direction: 'in', text: '添付なしの返信です', at: '2026-11-25T01:10:00.000Z' },
      ],
    }));

    const bubbles = [...el.querySelectorAll('.bubble')];
    expect(bubbles).toHaveLength(3);

    // The message with attachments shows both thumbnails, each
    // wrapped in a link to the original url.
    const withImg = bubbles.find((b) => b.textContent.includes('画像を添付しました'));
    const imgs = withImg.querySelectorAll('.attachment-img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/dummy-one.png');
    expect(imgs[0].getAttribute('alt')).toBe('dummy-one.png');
    const link = imgs[0].closest('a');
    expect(link.getAttribute('href')).toBe('https://example.com/dummy-one.png');
    expect(link.getAttribute('target')).toBe('_blank');

    // Messages without attachments render no image at all.
    const plain = bubbles.find((b) => b.textContent.includes('添付なしの返信です'));
    expect(plain.querySelectorAll('img')).toHaveLength(0);
    expect(bubbles[0].querySelectorAll('img')).toHaveLength(0);

    // A failed image load hides that attachment link only; the
    // message text and the other attachment stay in place.
    imgs[0].dispatchEvent(new Event('error'));
    await flush();
    expect(link.style.display).toBe('none');
    expect(imgs[1].closest('a').style.display).not.toBe('none');
    expect(withImg.textContent).toContain('画像を添付しました');
  });
});
