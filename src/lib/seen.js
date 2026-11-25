// 「見た返信」の端末ローカル記録。reader の既読管理と同じ流儀で、
// 既読はサーバーへ送らず、この端末の中だけで持つ。
// 本番とステージングで localStorage キーを分ける (session と同じ理由:
// 本番の記録をステージングが読む混線の防止)。
import { isStagingBuild } from '../staging-banner.js';

export function seenKey(env) {
  return isStagingBuild(env) ? 'muse:seen:v1:staging' : 'muse:seen:v1';
}

// 記録の形: { [会話ID]: { repliedRound: number } }
// repliedRound は「その会話で返信を見た最新のラウンド」。会話の
// ラウンドは続きを送るたびに増え、返信はそのラウンドに付くので、
// 「返信あり (replied) かつ repliedRound 未満」＝まだ見ていない返信。
// キー自体が無い場合は null を返し、「初回 (既存分は見たことにする
// 初期化が要る)」と「初期化済みで空」とを区別する。
export function loadSeen(storage = localStorage, env) {
  try {
    const raw = storage.getItem(seenKey(env));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, v] of Object.entries(parsed)) {
      const n = Number(v && v.repliedRound);
      if (Number.isFinite(n)) out[id] = { repliedRound: n };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSeen(seen, storage = localStorage, env) {
  try {
    storage.setItem(seenKey(env), JSON.stringify(seen || {}));
  } catch {
    // 保存できなくても、その場の未読表示自体は使える。
  }
}

// 初回の初期化: その時点で既に返信が付いている会話は「見た」扱いに
// し、使い始めていきなり全件が未読になるのを避ける。新しく届く
// 返信だけが未読になる。
export function seedSeen(requests) {
  const out = {};
  for (const r of requests || []) {
    if (r && r.status === 'replied') out[r.id] = { repliedRound: Number(r.round || 1) };
  }
  return out;
}

// そのラウンドの返信を見たことにする (新しいオブジェクトを返す)。
export function markSeen(seen, id, round) {
  if (!id) return seen || {};
  const n = Number(round);
  return { ...(seen || {}), [id]: { repliedRound: Number.isFinite(n) ? n : 1 } };
}

// 一覧に残っていない会話の記録は落とす (記録が際限なく増えないように)。
export function pruneSeen(seen, requests) {
  const ids = new Set((requests || []).map((r) => r && r.id));
  const out = {};
  for (const [id, v] of Object.entries(seen || {})) {
    if (ids.has(id)) out[id] = v;
  }
  return out;
}

// 未読 = 返信あり (replied) で、そのラウンドの返信をまだ見ていない。
export function isUnread(request, seen) {
  if (!request || request.status !== 'replied') return false;
  const entry = seen ? seen[request.id] : undefined;
  const seenRound = entry ? Number(entry.repliedRound) : NaN;
  return !(Number.isFinite(seenRound) && seenRound >= Number(request.round || 1));
}

export function unreadIds(requests, seen) {
  return (requests || []).filter((r) => isUnread(r, seen)).map((r) => r.id);
}
