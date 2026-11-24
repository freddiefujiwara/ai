// muse-gas の /exec JSON API へのラッパー。
// GAS の Web App はカスタムヘッダー付きのリクエストで CORS プリフライトが
// 通らないため、reader と同じく Content-Type: text/plain で JSON 文字列を
// 送る (サーバー側は postData.contents を JSON.parse する)。
import { API_URL } from '../config.js';
import { withRetry } from './retry.js';

function isRetryable(err) {
  if (err instanceof TypeError) return true;
  return /^HTTP 5\d\d$/.test(String((err && err.message) || ''));
}

async function requestJson(url, init, { fetcher = fetch, retries = 1, retryDelayMs = 900, timeoutMs = 30000 } = {}) {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetcher(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || 'api_error');
    }
    return data;
  }, { retries, retryDelayMs, isRetryable });
}

export async function postJson(body, { apiUrl = API_URL, ...opts } = {}) {
  if (!apiUrl) throw new Error('api_not_configured');
  return requestJson(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }, opts);
}

export async function getJson(params, { apiUrl = API_URL, ...opts } = {}) {
  if (!apiUrl) throw new Error('api_not_configured');
  const qs = new URLSearchParams(params).toString();
  return requestJson(`${apiUrl}?${qs}`, { method: 'GET' }, opts);
}

// Google IDトークンをセッションに交換する。
// -> { ok, sessionToken, expiresAt }
export function exchangeSession(idToken, opts) {
  return postJson({ action: 'exchange_session', idToken }, opts);
}

// 新しい依頼を送る。-> { ok, id, status: 'pending' }
export function ask(sessionToken, prompt, opts) {
  return postJson({ action: 'ask', sessionToken, prompt }, opts);
}

// 同じ会話に続きを送る。-> { ok, id, status: 'pending', round }
export function answer(sessionToken, id, text, opts) {
  return postJson({ action: 'answer', sessionToken, id, text }, opts);
}

// 会話の状態とメッセージ一覧。-> { ok, id, status, round, messages }
export function result(sessionToken, id, opts) {
  return getJson({ action: 'result', sessionToken, id }, opts);
}

// 会話の一覧 (新しい順)。-> { ok, requests: [{id, status, round, ...}] }
export function listRequests(sessionToken, opts) {
  return getJson({ action: 'list', sessionToken }, opts);
}
