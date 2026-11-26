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
import { listRequests, result, deleteRequest } from '../src/lib/api.js';

const T1 = {
  id: 'c1', status: 'replied', round: 1,
  created_at: '2026-11-25T01:00:00.000Z', last_activity_at: '2026-11-25T01:00:00.000Z',
  title: '', preview: '一件目の会話',
};
const T2 = {
  id: 'c2', status: 'replied', round: 2,
  created_at: '2026-11-25T02:00:00.000Z', last_activity_at: '2026-11-25T02:00:00.000Z',
  title: '二件目の会話', preview: '二件目のプレビュー',
};

let app;
let el;
let confirmSpy;

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

function items() {
  return [...el.querySelectorAll('.request-item')];
}

function itemWith(text) {
  return items().find((li) => li.textContent.includes(text));
}

beforeEach(() => {
  vi.useFakeTimers();
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
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  listRequests.mockImplementation(async () => ({ ok: true, requests: [{ ...T1 }, { ...T2 }] }));
  deleteRequest.mockImplementation(async () => ({ ok: true }));
});

afterEach(() => {
  if (app) app.unmount();
  app = null;
  confirmSpy.mockRestore();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mountList() {
  app = createApp(App);
  app.mount(el);
  await flush();
  expect(items()).toHaveLength(2);
}

describe('inline delete confirmation (list)', () => {
  it('opens the confirmation inside the row instead of window.confirm, hiding the row buttons', async () => {
    await mountList();
    const first = itemWith('一件目の会話');
    first.querySelector('.danger-btn').click();
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteRequest).not.toHaveBeenCalled();
    const confirmBox = first.querySelector('.delete-confirm');
    expect(confirmBox).not.toBeNull();
    expect(confirmBox.textContent).toContain('この会話を削除しますか？メッセージもすべて削除されます。');
    expect(confirmBox.textContent).toContain('本当に削除');
    expect(confirmBox.textContent).toContain('キャンセル');
    // While the confirmation is open, the row's own buttons are gone.
    expect(first.querySelector('.request-row')).toBeNull();

    // Only one confirmation is expanded at a time: opening the
    // second row closes the first one.
    const second = itemWith('二件目の会話');
    second.querySelector('.danger-btn').click();
    await flush();
    expect(itemWith('一件目の会話').querySelector('.delete-confirm')).toBeNull();
    expect(second.querySelector('.delete-confirm')).not.toBeNull();
  });

  it('cancel closes the confirmation without deleting', async () => {
    await mountList();
    const first = itemWith('一件目の会話');
    first.querySelector('.danger-btn').click();
    await flush();
    const cancel = [...first.querySelectorAll('.delete-confirm-actions button')]
      .find((b) => b.textContent.includes('キャンセル'));
    cancel.click();
    await flush();
    expect(deleteRequest).not.toHaveBeenCalled();
    expect(first.querySelector('.delete-confirm')).toBeNull();
    expect(first.querySelector('.request-row')).not.toBeNull();
    expect(items()).toHaveLength(2);
  });

  it('deletes via the API and removes the row at once, without refetching the list', async () => {
    let release;
    deleteRequest.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await mountList();
    const listCallsBefore = listRequests.mock.calls.length;

    const first = itemWith('一件目の会話');
    first.querySelector('.danger-btn').click();
    await flush();
    const doIt = [...first.querySelectorAll('.delete-confirm-actions button')]
      .find((b) => b.textContent.includes('本当に削除'));
    doIt.click();
    await flush();

    // While the delete is in flight: busy label and disabled buttons.
    expect(deleteRequest).toHaveBeenCalledWith('dummy', 'c1');
    expect(doIt.disabled).toBe(true);
    expect(doIt.textContent).toContain('削除中...');

    release({ ok: true });
    await flush();
    expect(itemWith('一件目の会話')).toBeUndefined();
    expect(items()).toHaveLength(1);
    // The row disappeared locally; the list was not refetched.
    expect(listRequests.mock.calls.length).toBe(listCallsBefore);
  });

  it('does not resurrect a deleted conversation when a stale background refresh lands', async () => {
    await mountList();
    const first = itemWith('一件目の会話');
    first.querySelector('.danger-btn').click();
    await flush();
    const doIt = [...first.querySelectorAll('.delete-confirm-actions button')]
      .find((b) => b.textContent.includes('本当に削除'));
    doIt.click();
    await flush();
    expect(itemWith('一件目の会話')).toBeUndefined();

    // The periodic background refresh still returns the pre-delete
    // list (a fetch that started before the delete): the deleted
    // conversation must stay gone.
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(itemWith('一件目の会話')).toBeUndefined();
    expect(items()).toHaveLength(1);
  });

  it('treats a not-found delete as already deleted and keeps the list consistent', async () => {
    deleteRequest.mockImplementation(async () => { throw new Error('request not found'); });
    await mountList();
    const first = itemWith('一件目の会話');
    first.querySelector('.danger-btn').click();
    await flush();
    const doIt = [...first.querySelectorAll('.delete-confirm-actions button')]
      .find((b) => b.textContent.includes('本当に削除'));
    doIt.click();
    await flush();
    expect(itemWith('一件目の会話')).toBeUndefined();
    expect(items()).toHaveLength(1);
    expect(el.textContent).toContain('その会話は既に削除されています。');
  });
});

describe('inline delete confirmation (thread)', () => {
  it('shows the same confirmation in the thread actions and returns to the list after deleting', async () => {
    result.mockImplementation(async () => ({
      ok: true, id: 'c1', status: 'replied', round: 1, title: '',
      messages: [{ round: 1, direction: 'out', text: '依頼です', at: '2026-11-25T01:00:00.000Z' }],
    }));
    await mountList();
    itemWith('一件目の会話').querySelector('.request-row').click();
    await flush();
    expect(el.querySelector('.thread-actions')).not.toBeNull();

    const del = [...el.querySelectorAll('.thread-actions button')]
      .find((b) => b.textContent.trim() === '削除');
    del.click();
    await flush();
    expect(confirmSpy).not.toHaveBeenCalled();
    const confirmBox = el.querySelector('.thread-actions .delete-confirm');
    expect(confirmBox).not.toBeNull();
    expect(confirmBox.textContent).toContain('この会話を削除しますか？メッセージもすべて削除されます。');
    // The other action buttons are hidden while confirming.
    expect(el.querySelector('.thread-actions').textContent).not.toContain('名前を変更');

    const doIt = [...confirmBox.querySelectorAll('button')]
      .find((b) => b.textContent.includes('本当に削除'));
    doIt.click();
    await flush();
    expect(deleteRequest).toHaveBeenCalledWith('dummy', 'c1');
    // Back on the list, and the deleted conversation is not there
    // even though the refetch still returns the stale list.
    expect(el.querySelector('.request-list')).not.toBeNull();
    expect(itemWith('一件目の会話')).toBeUndefined();
    expect(itemWith('二件目の会話')).not.toBeUndefined();
  });
});
