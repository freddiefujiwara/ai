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
  id: 'c1', status: 'replied', round: 1,
  created_at: '2026-11-25T01:00:00.000Z', last_activity_at: '2026-11-25T01:00:00.000Z',
  title: '', preview: 'Markdown確認用の会話',
};

let app;
let el;

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.pushState(null, '', '/');
  localStorage.clear();
  localStorage.setItem(
    'ai:session:v1',
    JSON.stringify({ token: 'dummy', role: 'owner', expiresAt: '2999-01-01T00:00:00.000Z' }),
  );
  localStorage.setItem('ai:seen:v1', '{}');
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

describe('markdown rendering in thread view', () => {
  it('renders received replies as markdown but keeps sent text plain', async () => {
    result.mockImplementation(async () => ({
      ok: true, id: 'c1', status: 'replied', round: 1, title: '',
      messages: [
        { round: 1, direction: 'out', text: '送信側の **太字** です', at: '2026-11-25T01:00:00.000Z' },
        {
          round: 1, direction: 'in',
          text: '## 回答です\n\nこれは **太字** です\n\n- 項目1\n- 項目2',
          at: '2026-11-25T01:05:00.000Z',
        },
      ],
    }));
    app = createApp(App);
    app.mount(el);
    await flush();
    el.querySelector('.request-row').click();
    await flush();

    const bubbles = [...el.querySelectorAll('.bubble')];
    expect(bubbles).toHaveLength(2);

    // Sent message: markdown source stays literal, no elements.
    const out = bubbles.find((b) => b.classList.contains('out'));
    expect(out.querySelector('.md-body')).toBeNull();
    expect(out.querySelector('strong')).toBeNull();
    expect(out.textContent).toContain('**太字**');

    // Received message: rendered HTML with heading, bold and list.
    const inn = bubbles.find((b) => b.classList.contains('in'));
    const body = inn.querySelector('.md-body');
    expect(body).not.toBeNull();
    expect(body.querySelector('h2')?.textContent).toContain('回答です');
    expect(body.querySelector('strong')?.textContent).toBe('太字');
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(inn.textContent).not.toContain('**');
  });

  it('does not let raw HTML or images from a reply into the DOM', async () => {
    result.mockImplementation(async () => ({
      ok: true, id: 'c1', status: 'replied', round: 1, title: '',
      messages: [
        { round: 1, direction: 'out', text: '依頼です', at: '2026-11-25T01:00:00.000Z' },
        {
          round: 1, direction: 'in',
          text: '本文です <script>alert(1)</script> <img src="https://example.com/x.png" onerror="alert(2)"> ![代替](https://example.com/y.png)',
          at: '2026-11-25T01:05:00.000Z',
        },
      ],
    }));
    app = createApp(App);
    app.mount(el);
    await flush();
    el.querySelector('.request-row').click();
    await flush();

    const inn = [...el.querySelectorAll('.bubble')].find((b) => b.classList.contains('in'));
    expect(inn.textContent).toContain('本文です');
    expect(inn.querySelector('script')).toBeNull();
    // No attachments on this message, so any <img> would be markdown-born.
    expect(inn.querySelectorAll('img')).toHaveLength(0);
    expect(el.innerHTML).not.toContain('onerror');
  });
});
