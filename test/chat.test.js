import { describe, it, expect } from 'vitest';
import { normalizeRequests, mergeMessages, threadTitle, shouldPoll, formatDateTime, statusLabel, displayTitle } from '../src/lib/chat.js';

describe('normalizeRequests', () => {
  it('drops junk and duplicate ids, keeps order', () => {
    const out = normalizeRequests([
      { id: 'a', status: 'replied', round: 2 },
      { id: 'a', status: 'pending', round: 1 },
      { status: 'pending' },
      null,
      { id: 'b' },
    ]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out[0].round).toBe(2);
    expect(out[1].status).toBe('pending');
  });
  it('keeps title and preview, defaults them to empty strings', () => {
    const out = normalizeRequests([
      { id: 'a', title: 'Named', preview: 'First line' },
      { id: 'b' },
    ]);
    expect(out[0].title).toBe('Named');
    expect(out[0].preview).toBe('First line');
    expect(out[1].title).toBe('');
    expect(out[1].preview).toBe('');
  });
  it('returns [] for non-arrays', () => {
    expect(normalizeRequests(null)).toEqual([]);
  });
});

describe('mergeMessages', () => {
  const out1 = { round: 1, direction: 'out', text: 'hi', at: '2026-11-25T00:00:00.000Z' };
  const in1 = { round: 1, direction: 'in', text: 'hello', at: '2026-11-25T00:01:00.000Z' };
  it('dedupes and orders out before in within a round', () => {
    expect(mergeMessages([out1], [in1, out1])).toEqual([out1, in1]);
    expect(mergeMessages([], [])).toEqual([]);
  });
});

describe('displayTitle', () => {
  it('prefers the custom title, then preview, then the date', () => {
    expect(displayTitle({ title: 'Named', preview: 'Prev', created_at: '2026-11-25T00:00:00.000Z' })).toBe('Named');
    expect(displayTitle({ title: '', preview: 'Prev', created_at: '2026-11-25T00:00:00.000Z' })).toBe('Prev');
    expect(displayTitle({ title: '', preview: '', created_at: '2026-11-25T00:00:00.000Z' })).toContain('2026');
    // an old backend that returns neither title nor preview still works
    expect(displayTitle({ created_at: '2026-11-25T00:00:00.000Z' })).toContain('2026');
    expect(displayTitle({})).toBe('会話');
    expect(displayTitle(null)).toBe('会話');
  });
});

describe('threadTitle / labels / polling', () => {
  it('uses the first outgoing line', () => {
    expect(threadTitle([{ direction: 'out', text: '一行目\n二行目' }])).toBe('一行目');
    expect(threadTitle([], '2026-11-25T00:00:00.000Z')).toContain('2026');
  });
  it('labels and poll decision', () => {
    expect(statusLabel('pending')).toBe('返信待ち');
    expect(shouldPoll('pending')).toBe(true);
    expect(shouldPoll('replied')).toBe(false);
  });
  it('formats dates, empty on garbage', () => {
    expect(formatDateTime('not-a-date')).toBe('');
    expect(formatDateTime('2026-11-25T05:47:00.000Z')).toMatch(/2026\/11\/25/);
  });
});
