<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { GOOGLE_CLIENT_ID } from './config.js';
import { loadSession, saveSession, clearSession } from './lib/session.js';
import { exchangeSession, ask, answer, result, listRequests, rename, deleteRequest } from './lib/api.js';
import { normalizeRequests, mergeMessages, threadTitle, statusLabel, shouldPoll, formatDateTime, displayTitle, normalizeEngine, engineLabel } from './lib/chat.js';
import { loadEnginePref, saveEnginePref } from './lib/engine.js';
import { threadIdFromPath, threadPath, listPath } from './lib/route.js';
import { loadSeen, saveSeen, seedSeen, markSeen, pruneSeen, unreadIds } from './lib/seen.js';

// スレッド毎URLの土台。本番は "/muse/"、ステージングは
// "/muse/staging/" (Vite の BASE_URL)。深リンクの復元は
// index.html / 404.html の spa-github-pages 方式が担う。
const BASE_URL = import.meta.env.BASE_URL;
const appBase = listPath(BASE_URL);

const session = ref(null);
const signingIn = ref(false);
const googleScriptError = ref(false);
const bootError = ref('');
const signinEl = ref(null);

const view = ref('list'); // 'list' | 'thread'
const requests = ref([]);
const listLoading = ref(false);
const listRefreshing = ref(false);
const listError = ref('');

const currentId = ref(null);
const currentStatus = ref('');
const currentTitle = ref('');
// 会話のエンジン。既存会話はサーバーの値が正 (currentEngine)、
// 新規会話は端末に覚えた前回の選択 (newEngine) から始める。
const currentEngine = ref('Muse');
const newEngine = ref('Muse');
try { newEngine.value = loadEnginePref(); } catch { /* 既定の Muse */ }
const effectiveEngine = computed(() => (currentId.value ? currentEngine.value : newEngine.value));
const composerPlaceholder = computed(() =>
  effectiveEngine.value === 'groq' ? 'Groqへの質問を書く（即時応答）' : 'Claudeへの依頼を書く');
const messages = ref([]);
const draft = ref('');
const sending = ref(false);
const threadError = ref('');
const threadLoading = ref(false);
const threadRefreshing = ref(false);
let threadRefreshInFlight = null;
// 削除のインライン確認 (reader のフィード削除と同じ流儀):
// window.confirm は使わず、押した行・操作行の中に確認を展開する。
// 同時に展開するのは1件だけで、実行中は対象IDを deletingId に持つ。
const confirmDeleteId = ref(null);
const deletingId = ref(null);
// 削除済みIDの墓標: 削除前に始まった背景更新が古い一覧で完了しても、
// 消した会話が復活しないようにする。サーバー側の一覧から消えた
// ことが確認できたIDは、その時点で墓標を外す。
const deletedIds = ref(new Set());
const editingTitle = ref(false);
const titleDraft = ref('');
const savingTitle = ref(false);
let pollTimer = null;
// 一覧の背景更新 (reader と同じ流儀): 一覧を表示している間は
// 60秒間隔で裏で取り直し、しばらく裏に回って戻ってきたときも
// (60秒を超えていたら) その場で取り直す。どちらも画面を
// ブロックせず、実行中にもう一度呼ばれたら同じ Promise を返す。
const LIST_REFRESH_MS = 60_000;
let listPollTimer = null;
let listRefreshInFlight = null;
let listHiddenAt = 0;
// 「見た返信」の記録 (端末ローカルのみ)。null は未読み込み、
// 読み込み済みでキー自体が無かった場合は初回として一覧で初期化する。
const seenMap = ref(null);
const unreadIdSet = computed(() => new Set(unreadIds(requests.value, seenMap.value || {})));
const unreadCount = computed(() => unreadIdSet.value.size);
// 起動時のURLに会話IDがあり、まだログインしていない場合に保持し、
// ログイン完了後にその会話を開くための置き場。
let pendingThreadId = null;

// ---- URL (History API) ----
// 現在のURLが指す会話ID (一覧なら null)。
function routeThreadId() {
  return threadIdFromPath(window.location.pathname, BASE_URL);
}

function pushThreadUrl(id) {
  const path = threadPath(id, BASE_URL);
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
}

function pushListUrl() {
  if (window.location.pathname !== appBase) window.history.pushState(null, '', appBase);
}

function replaceListUrl() {
  if (window.location.pathname !== appBase) window.history.replaceState(null, '', appBase);
}

const year = new Date().getFullYear();
const currentRequest = computed(() => requests.value.find((r) => r.id === currentId.value) || null);
const title = computed(() => {
  const custom = (currentTitle.value || '').trim();
  if (custom) return custom;
  return threadTitle(messages.value, currentRequest.value?.created_at);
});
const isPending = computed(() => shouldPoll(currentStatus.value));

function adoptSession(data) {
  const s = { token: data.sessionToken, role: data.role || 'owner', expiresAt: data.expiresAt || null };
  saveSession(s);
  session.value = s;
  seenMap.value = loadSeen();
}

async function onCredential(response) {
  signingIn.value = true;
  bootError.value = '';
  try {
    const data = await exchangeSession(response.credential);
    adoptSession(data);
    await loadList();
    // 深リンクで来てログインした場合は、その会話を直接開く。
    const id = pendingThreadId || routeThreadId();
    pendingThreadId = null;
    if (id) await openThread(id, { push: false });
  } catch (e) {
    bootError.value = 'ログインに失敗しました。このアプリは本人のGoogleアカウントでのみ利用できます。';
  } finally {
    signingIn.value = false;
  }
}

function renderSigninButton() {
  const render = () => {
    if (!window.google) {
      googleScriptError.value = true;
      return;
    }
    googleScriptError.value = false;
    if (!signinEl.value) {
      nextTick(render);
      return;
    }
    window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
    window.google.accounts.id.renderButton(signinEl.value, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
    });
  };
  if (window.google) render();
  else if (document.readyState === 'complete') render();
  else window.addEventListener('load', render, { once: true });
}

function handleAuthFailure(e) {
  if (e && e.message === 'unauthorized') {
    clearSession();
    session.value = null;
    view.value = 'list';
    stopPolling();
    bootError.value = 'ログインの有効期限が切れました。もう一度ログインしてください。';
    nextTick(renderSigninButton);
    return true;
  }
  return false;
}

function signOut() {
  clearSession();
  session.value = null;
  view.value = 'list';
  currentId.value = null;
  currentTitle.value = '';
  messages.value = [];
  pendingThreadId = null;
  stopPolling();
  replaceListUrl();
  if (window.google) window.google.accounts.id.disableAutoSelect();
  nextTick(renderSigninButton);
}

// 取得した一覧を画面と「見た返信」の記録へ反映する。初回だけは、
// その時点で既に返信が付いている会話を見た扱いにして初期化する。
function applyList(data) {
  const server = normalizeRequests(data.requests);
  if (deletedIds.value.size > 0) {
    // 墓標がある間は、サーバーがまだ返している (=削除前の古い応答の
    // 可能性がある) IDだけを除外して表示する。サーバーの一覧から
    // 消えたIDは削除が確定したので墓標を外す。
    const serverIds = new Set(server.map((r) => r.id));
    deletedIds.value = new Set([...deletedIds.value].filter((id) => serverIds.has(id)));
    requests.value = server.filter((r) => !deletedIds.value.has(r.id));
  } else {
    requests.value = server;
  }
  if (seenMap.value === null) {
    seenMap.value = seedSeen(requests.value);
    saveSeen(seenMap.value);
  } else {
    seenMap.value = pruneSeen(seenMap.value, requests.value);
    saveSeen(seenMap.value);
  }
}

// background=true は定期取得・復帰時の背景更新用: 読み込み表示や
// エラー表示で画面をちらつかせず、失敗したら前回の一覧を残す
// (認証切れだけは従来どおりサインイン画面へ倒す)。
async function loadList({ background = false } = {}) {
  if (!session.value) return;
  if (!background) {
    listLoading.value = true;
    listError.value = '';
  }
  try {
    const data = await listRequests(session.value.token);
    applyList(data);
  } catch (e) {
    if (!handleAuthFailure(e) && !background) listError.value = '会話一覧を取得できませんでした。';
  } finally {
    if (!background) listLoading.value = false;
  }
}

// 背景更新の多重実行防止 (reader の refreshInBackground と同じ形)。
function refreshListInBackground() {
  if (listRefreshInFlight) return listRefreshInFlight;
  listRefreshing.value = true;
  const run = loadList({ background: true });
  listRefreshInFlight = run;
  const clear = () => {
    if (listRefreshInFlight === run) {
      listRefreshInFlight = null;
      listRefreshing.value = false;
    }
  };
  run.then(clear, clear);
  return run;
}

// 詳細の背景更新の多重実行防止 (一覧側と同じ形)。詳細ポーリングと
// 同じ取得処理を即時実行するだけで、読み込み表示は出さない。
function refreshThreadInBackground() {
  if (threadRefreshInFlight) return threadRefreshInFlight;
  threadRefreshing.value = true;
  const run = refreshThread();
  threadRefreshInFlight = run;
  const clear = () => {
    if (threadRefreshInFlight === run) {
      threadRefreshInFlight = null;
      threadRefreshing.value = false;
    }
  };
  run.then(clear, clear);
  return run;
}

// ヘッダーの更新ボタンの表示状態は、表示中の画面側の背景更新に合わせる。
const refreshing = computed(() => (view.value === 'list' ? listRefreshing.value : threadRefreshing.value));

// ヘッダーの手動更新も、定期取得と同じ背景更新を使う (reader の
// onManualRefresh と同じ形)。一覧では一覧を、詳細では開いている
// 会話を取り直す。どちらも読み込み表示で画面をブロックしない。
async function onManualRefresh() {
  if (!session.value) return;
  if (view.value === 'list') await refreshListInBackground();
  else if (currentId.value) await refreshThreadInBackground();
}

function startListPolling() {
  if (listPollTimer) return;
  listPollTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') refreshListInBackground();
  }, LIST_REFRESH_MS);
}

function stopListPolling() {
  if (listPollTimer) {
    clearInterval(listPollTimer);
    listPollTimer = null;
  }
}

// 一覧を表示している間だけ定期取得する (詳細側のポーリングとは別系統)。
function syncListPolling() {
  if (session.value && view.value === 'list') startListPolling();
  else stopListPolling();
}

watch([session, view], syncListPolling);

// しばらく裏に回って戻ってきたら、その場で背景更新する (reader と
// 同じ流儀)。裏にいる間はタイマー側も取得しない。
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    listHiddenAt = Date.now();
    return;
  }
  if (session.value && view.value === 'list' && listHiddenAt && Date.now() - listHiddenAt > LIST_REFRESH_MS) {
    listHiddenAt = 0;
    refreshListInBackground();
  }
}

function openNew() {
  currentId.value = null;
  currentStatus.value = '';
  currentTitle.value = '';
  currentEngine.value = 'Muse';
  messages.value = [];
  threadError.value = '';
  editingTitle.value = false;
  confirmDeleteId.value = null;
  view.value = 'thread';
}

// After the initial load of a thread, land on the latest message
// (chat-style). Only openThread calls this: polling refreshes and
// sends keep the current scroll position untouched.
async function scrollToLatest() {
  await nextTick();
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
}

// push=false は「URLは既にその会話を指している」呼び出し用
// (深リンク起動・ログイン直後・popstate)。存在しない会話だった場合は
// エラーを一覧側に出し、URLも一覧へ戻す (リトライはしない)。
async function openThread(id, { push = true } = {}) {
  currentId.value = id;
  const entry = requests.value.find((r) => r.id === id);
  currentTitle.value = entry?.title || '';
  currentEngine.value = normalizeEngine(entry?.engine);
  messages.value = [];
  threadError.value = '';
  editingTitle.value = false;
  confirmDeleteId.value = null;
  view.value = 'thread';
  threadLoading.value = true;
  let res;
  try {
    res = await refreshThread();
  } finally {
    threadLoading.value = false;
  }
  // 認証切れでセッションが消えた場合は handleAuthFailure 側の表示
  // (サインイン画面) に任せ、URLも触らない。
  if (!session.value) return;
  if (res && res.notFound) {
    stopPolling();
    currentId.value = null;
    currentStatus.value = '';
    currentTitle.value = '';
    messages.value = [];
    view.value = 'list';
    listError.value = '指定された会話が見つかりませんでした。';
    replaceListUrl();
    loadList();
    return;
  }
  if (push) pushThreadUrl(id);
  if (messages.value.length > 0) await scrollToLatest();
}

// 一覧への遷移 (削除後など内部都合のもの) は履歴に積む (push) が
// 原則で、呼び出し側の指定に従う。画面上の戻る導線はヘッダーの
// タイトルリンクとブラウザの戻るが担う。
function backToList({ push = true } = {}) {
  stopPolling();
  view.value = 'list';
  if (push) pushListUrl();
  loadList();
}

// ブラウザの戻る/進む: URLに合わせて表示を切り替える。URL自体は
// ブラウザが書き換え済みなので、ここでは push しない。
async function onPopState() {
  if (!session.value) return;
  const id = routeThreadId();
  if (id) {
    if (view.value === 'thread' && currentId.value === id) return;
    await openThread(id, { push: false });
  } else {
    if (view.value === 'list') return;
    stopPolling();
    currentId.value = null;
    currentStatus.value = '';
    currentTitle.value = '';
    messages.value = [];
    view.value = 'list';
    loadList();
  }
}

// 戻り値で成否を返す (openThread が「会話が無い」を判別するため)。
// それ以外の呼び出し元 (送信後・ポーリング) は従来どおり無視する。
async function refreshThread() {
  if (!session.value || !currentId.value) return { ok: false, notFound: false };
  try {
    const data = await result(session.value.token, currentId.value);
    currentStatus.value = data.status;
    if (typeof data.engine === 'string') currentEngine.value = normalizeEngine(data.engine);
    if (typeof data.title === 'string') currentTitle.value = data.title;
    messages.value = mergeMessages(messages.value, data.messages);
    // 開いている会話の返信は見た扱いにする (詳細側のポーリングで
    // 届いた返信も、一覧へ戻ったときに未読にならないように)。
    if (data.status === 'replied') {
      seenMap.value = markSeen(seenMap.value || {}, currentId.value, data.round);
      saveSeen(seenMap.value);
    }
    if (shouldPoll(data.status)) startPolling();
    else stopPolling();
    return { ok: true, notFound: false };
  } catch (e) {
    if (handleAuthFailure(e)) return { ok: false, notFound: false };
    threadError.value = '会話を取得できませんでした。';
    return { ok: false, notFound: e && e.message === 'request not found' };
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshThread, 5000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function send() {
  const text = draft.value.trim();
  if (!text || sending.value || !session.value) return;
  sending.value = true;
  threadError.value = '';
  try {
    if (!currentId.value) {
      const data = await ask(session.value.token, text, newEngine.value);
      currentId.value = data.id;
      currentStatus.value = data.status;
      currentEngine.value = normalizeEngine(data.engine || newEngine.value);
      saveEnginePref(newEngine.value);
      // 新しい会話はIDが発行された時点で、その会話のURLにする。
      pushThreadUrl(data.id);
    } else {
      const data = await answer(session.value.token, currentId.value, text);
      currentStatus.value = data.status;
    }
    draft.value = '';
    await refreshThread();
  } catch (e) {
    if (!handleAuthFailure(e)) threadError.value = '送信できませんでした。もう一度お試しください。';
  } finally {
    sending.value = false;
  }
}

function startEditTitle() {
  if (!currentId.value) return;
  titleDraft.value = currentTitle.value || '';
  editingTitle.value = true;
}

function cancelEditTitle() {
  editingTitle.value = false;
}

async function saveTitle() {
  if (!currentId.value || savingTitle.value || !session.value) return;
  savingTitle.value = true;
  threadError.value = '';
  try {
    const data = await rename(session.value.token, currentId.value, titleDraft.value.trim());
    currentTitle.value = data.title || '';
    const entry = requests.value.find((r) => r.id === currentId.value);
    if (entry) entry.title = currentTitle.value;
    editingTitle.value = false;
  } catch (e) {
    if (!handleAuthFailure(e)) threadError.value = '名前を保存できませんでした。';
  } finally {
    savingTitle.value = false;
  }
}

function askDeleteFromList(r) {
  confirmDeleteId.value = r.id;
}

function askDeleteCurrent() {
  if (currentId.value) confirmDeleteId.value = currentId.value;
}

function cancelDelete() {
  if (deletingId.value) return;
  confirmDeleteId.value = null;
}

// 削除が確定した会話を、その場で画面と記録から落とす。再取得を
// 待たないので、成功した瞬間に一覧から消える (reader と同じ)。
function applyDeletedLocally(id) {
  deletedIds.value = new Set([...deletedIds.value, id]);
  requests.value = requests.value.filter((r) => r.id !== id);
  if (seenMap.value && seenMap.value[id]) {
    const next = { ...seenMap.value };
    delete next[id];
    seenMap.value = next;
    saveSeen(seenMap.value);
  }
  confirmDeleteId.value = null;
  if (view.value === 'thread' && id === currentId.value) {
    stopPolling();
    currentId.value = null;
    currentTitle.value = '';
    messages.value = [];
    backToList();
  }
}

async function doDelete(id) {
  if (deletingId.value || !session.value || !id) return;
  deletingId.value = id;
  threadError.value = '';
  listError.value = '';
  try {
    await deleteRequest(session.value.token, id);
    applyDeletedLocally(id);
  } catch (e) {
    if (handleAuthFailure(e)) return;
    if (e && e.message === 'request not found') {
      // 既に消えていた場合も、一覧から落として整合させる
      // (reader の not_found の流儀)。
      const wasThreadTarget = view.value === 'thread' && id === currentId.value;
      applyDeletedLocally(id);
      if (wasThreadTarget || view.value === 'list') listError.value = 'その会話は既に削除されています。';
      else threadError.value = 'その会話は既に削除されています。';
    } else {
      // 確認は開いたままにして、その場で再試行できるようにする。
      const msg = '削除できませんでした。もう一度お試しください。';
      if (view.value === 'thread') threadError.value = msg;
      else listError.value = msg;
    }
  } finally {
    deletingId.value = null;
  }
}

// 読み込めなかった添付画像はリンクごと隠す。壊れた画像アイコンを
// 残さず、本文の表示はそのまま保つ。
function onAttachmentError(e) {
  const img = e.target;
  const link = img && typeof img.closest === 'function' ? img.closest('a') : null;
  if (link) link.style.display = 'none';
  else if (img) img.style.display = 'none';
}

onMounted(async () => {
  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibilityChange);
  const initialId = routeThreadId();
  const saved = loadSession();
  if (saved) {
    session.value = saved;
    seenMap.value = loadSeen();
    await loadList();
    // 深リンク: URLの会話を直接開く (最下部スクロール込み)。
    if (initialId && session.value) await openThread(initialId, { push: false });
  } else {
    // 未ログインならIDを保持し、ログイン完了後に開く。
    pendingThreadId = initialId;
    renderSigninButton();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  stopPolling();
  stopListPolling();
});
</script>

<template>
  <nav class="site-nav">
    <a class="brand" :href="appBase">
      <span class="brand-mark">智</span>
      <span class="brand-text">
        <span class="brand-name">AI</span>
        <span class="brand-sub">AIと話す</span>
      </span>
    </a>
    <span></span>
    <span v-if="session" class="session-note">
      <span v-if="view === 'list' && unreadCount > 0" class="unread-pill">未読 {{ unreadCount }}</span>
      <button
        v-if="view === 'list' || currentId"
        class="ghost nav-refresh"
        type="button"
        :disabled="refreshing"
        @click="onManualRefresh"
      >{{ refreshing ? '更新中…' : '更新' }}</button>
      <button class="ghost-btn" type="button" @click="signOut">サインアウト</button>
    </span>
  </nav>

  <main class="chat-layout">
    <template v-if="!session">
      <section class="panel center signin-box">
        <p>Googleログインが必要です</p>
        <p class="hint">本人のGoogleアカウントでのみ利用できます。</p>
        <div ref="signinEl"></div>
        <p v-if="signingIn" class="meta">ログインしています…</p>
        <p v-if="googleScriptError" class="error">Googleログインを読み込めませんでした。通信環境を確認して、ページを再読み込みしてください。</p>
        <p v-if="bootError" class="error">{{ bootError }}</p>
      </section>
    </template>

    <template v-else-if="view === 'list'">
      <div class="chat-actions">
        <button class="primary-btn" type="button" @click="openNew">新しい会話</button>
      </div>
      <p v-if="listError" class="error">{{ listError }}</p>
      <p v-if="listLoading" class="meta"><span class="spinner"></span>読み込んでいます…</p>
      <p v-else-if="requests.length === 0" class="meta">まだ会話がありません。「新しい会話」から始められます。</p>
      <ul v-else class="request-list">
        <li v-for="r in requests" :key="r.id" class="request-item">
          <div v-if="confirmDeleteId === r.id" class="delete-confirm">
            <p>この会話を削除しますか？メッセージもすべて削除されます。</p>
            <div class="delete-confirm-actions">
              <button class="danger-btn" type="button" :disabled="deletingId === r.id" @click="doDelete(r.id)">{{ deletingId === r.id ? '削除中...' : '本当に削除' }}</button>
              <button class="ghost-btn" type="button" :disabled="deletingId === r.id" @click="cancelDelete">キャンセル</button>
            </div>
          </div>
          <template v-else>
            <button class="request-row" type="button" @click="openThread(r.id)">
              <span v-if="unreadIdSet.has(r.id)" class="unread-dot" aria-label="未読の返信"></span>
              <span class="req-main">
                <span class="req-title">{{ displayTitle(r) }}</span>
                <span class="req-sub">
                  <span class="status-chip" :class="r.status">{{ statusLabel(r.status) }}</span>
                  <span class="engine-chip" :class="r.engine">{{ engineLabel(r.engine) }}</span>
                  <span>{{ formatDateTime(r.created_at) }}</span>
                  <span class="req-meta">往復 {{ r.round }}</span>
                </span>
              </span>
            </button>
            <button class="danger-btn" type="button" @click="askDeleteFromList(r)">削除</button>
          </template>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="thread-head">
        <span class="thread-title">{{ currentId ? title : '新しい会話' }}</span>
        <span v-if="currentId" class="engine-chip" :class="currentEngine">{{ engineLabel(currentEngine) }}</span>
      </div>
      <div v-if="currentId" class="thread-actions">
        <template v-if="editingTitle">
          <input
            v-model="titleDraft"
            class="title-input"
            type="text"
            maxlength="100"
            placeholder="会話の名前（空でクリア）"
            :disabled="savingTitle"
            @keydown.enter.prevent="saveTitle"
            @keydown.esc.prevent="cancelEditTitle"
          />
          <button class="ghost-btn" type="button" :disabled="savingTitle" @click="saveTitle">{{ savingTitle ? '保存中…' : '保存' }}</button>
          <button class="ghost-btn" type="button" :disabled="savingTitle" @click="cancelEditTitle">キャンセル</button>
        </template>
        <div v-else-if="confirmDeleteId === currentId" class="delete-confirm">
          <p>この会話を削除しますか？メッセージもすべて削除されます。</p>
          <div class="delete-confirm-actions">
            <button class="danger-btn" type="button" :disabled="deletingId === currentId" @click="doDelete(currentId)">{{ deletingId === currentId ? '削除中...' : '本当に削除' }}</button>
            <button class="ghost-btn" type="button" :disabled="deletingId === currentId" @click="cancelDelete">キャンセル</button>
          </div>
        </div>
        <template v-else>
          <button class="ghost-btn" type="button" @click="startEditTitle">名前を変更</button>
          <button class="danger-btn" type="button" @click="askDeleteCurrent()">削除</button>
        </template>
      </div>
      <p v-if="threadError" class="error">{{ threadError }}</p>
      <p v-if="threadLoading" class="meta thread-loading"><span class="spinner"></span>読み込んでいます…</p>
      <div v-else class="messages">
        <div v-for="(m, i) in messages" :key="i" class="bubble" :class="m.direction">
          {{ m.text }}<span class="bubble-meta">{{ formatDateTime(m.at) }}</span>
          <span v-if="m.attachments && m.attachments.length" class="bubble-attachments">
            <a
              v-for="(a, j) in m.attachments"
              :key="j"
              class="attachment-link"
              :href="a.url"
              target="_blank"
              rel="noopener"
            ><img
              class="attachment-img"
              :src="a.url"
              :alt="a.name || '添付画像'"
              loading="lazy"
              @error="onAttachmentError"
            /></a>
          </span>
        </div>
      </div>
      <p v-if="isPending && !threadLoading" class="pending-note"><span class="spinner"></span>返信を待っています（目安1〜2分、最大10分）</p>
      <p v-if="currentStatus === 'timeout' && !threadLoading" class="error">10分経っても返信がありませんでした。続きを送ると再開できます。</p>
      <div v-if="!currentId" class="engine-toggle" role="group" aria-label="相手のAIを選ぶ">
        <button
          type="button"
          class="engine-option"
          :class="{ active: newEngine === 'Muse' }"
          :aria-pressed="newEngine === 'Muse'"
          @click="newEngine = 'Muse'"
        >Muse<span class="engine-note">じっくり・メール経由</span></button>
        <button
          type="button"
          class="engine-option"
          :class="{ active: newEngine === 'groq' }"
          :aria-pressed="newEngine === 'groq'"
          @click="newEngine = 'groq'"
        >Groq<span class="engine-note">即時応答</span></button>
      </div>
      <form class="composer" @submit.prevent="send">
        <textarea v-model="draft" rows="3" :placeholder="composerPlaceholder" :disabled="sending || threadLoading"></textarea>
        <button class="primary-btn" type="submit" :disabled="sending || threadLoading || !draft.trim()">{{ sending ? '送信中…' : '送信' }}</button>
      </form>
    </template>

    <footer class="site-footer">
      <div class="foot-links">
        <a href="https://freddiefujiwara.com/" target="_blank" rel="noopener">トップ <span class="arr">↗</span></a>
      </div>
      <p class="copy">© {{ year }} freddiefujiwara.com</p>
    </footer>
  </main>
</template>
