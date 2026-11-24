// 会話まわりの純粋な整形・判定。API や DOM には触らない。

export const STATUS_LABELS = {
  pending: '返信待ち',
  replied: '返信あり',
  timeout: 'タイムアウト',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '');
}

// 一覧の並びは API が新しい順で返す前提だが、欠けた項目は落とし、
// id の重複は先勝ちで除く (背景更新で同じ一覧を何度も取り込むため)。
export function normalizeRequests(requests) {
  if (!Array.isArray(requests)) return [];
  const seen = new Set();
  const out = [];
  for (const r of requests) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      status: typeof r.status === 'string' ? r.status : 'pending',
      round: Number(r.round || 1),
      created_at: r.created_at || '',
      last_activity_at: r.last_activity_at || '',
      title: typeof r.title === 'string' ? r.title : '',
      preview: typeof r.preview === 'string' ? r.preview : '',
    });
  }
  return out;
}

// メッセージの同一性は (round, direction, at) で見る。ポーリングで
// 取り直した一覧と手元の楽観表示を重ねても二重にならないようにする。
function messageKey(m) {
  return `${m.round}|${m.direction}|${m.at}`;
}

export function mergeMessages(existing, incoming) {
  const byKey = new Map();
  for (const m of [...(existing || []), ...(incoming || [])]) {
    if (!m || typeof m.text !== 'string') continue;
    byKey.set(messageKey(m), {
      round: Number(m.round || 1),
      direction: m.direction === 'in' ? 'in' : 'out',
      text: m.text,
      at: m.at || '',
    });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    if (a.direction !== b.direction) return a.direction === 'out' ? -1 : 1;
    return String(a.at).localeCompare(String(b.at));
  });
}

// 会話のタイトルは最初の送信文の1行目 (50字まで)。無ければ日時にする。
export function threadTitle(messages, fallbackDate) {
  const firstOut = (messages || []).find((m) => m.direction === 'out');
  if (firstOut) {
    const line = String(firstOut.text).split('\n')[0].trim();
    if (line) return line.slice(0, 50);
  }
  return fallbackDate ? formatDateTime(fallbackDate) : '会話';
}

// 一覧での表示タイトル: カスタム名 > プレビュー (最初の送信文) > 日時。
// title/preview が無い旧バックエンドの応答でも従来どおり日時に落ちる。
export function displayTitle(request, fallbackDate) {
  const r = request || {};
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (title) return title;
  const preview = typeof r.preview === 'string' ? r.preview.trim() : '';
  if (preview) return preview;
  const date = fallbackDate || r.created_at || '';
  return date ? formatDateTime(date) : '会話';
}

export function shouldPoll(status) {
  return status === 'pending';
}

// ISO 文字列を端末ローカルの "2026/11/25 5:47" 形式にする。
// 解釈できない値は空文字。
export function formatDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`;
}
