<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { GOOGLE_CLIENT_ID } from './config.js';
import { loadSession, saveSession, clearSession } from './lib/session.js';
import { exchangeSession, ask, answer, result, listRequests, rename, deleteRequest } from './lib/api.js';
import { normalizeRequests, mergeMessages, threadTitle, statusLabel, shouldPoll, formatDateTime, displayTitle } from './lib/chat.js';

const session = ref(null);
const signingIn = ref(false);
const googleScriptError = ref(false);
const bootError = ref('');
const signinEl = ref(null);

const view = ref('list'); // 'list' | 'thread'
const requests = ref([]);
const listLoading = ref(false);
const listError = ref('');

const currentId = ref(null);
const currentStatus = ref('');
const currentTitle = ref('');
const messages = ref([]);
const draft = ref('');
const sending = ref(false);
const threadError = ref('');
const threadLoading = ref(false);
const deleting = ref(false);
const editingTitle = ref(false);
const titleDraft = ref('');
const savingTitle = ref(false);
let pollTimer = null;

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
}

async function onCredential(response) {
  signingIn.value = true;
  bootError.value = '';
  try {
    const data = await exchangeSession(response.credential);
    adoptSession(data);
    await loadList();
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
  stopPolling();
  if (window.google) window.google.accounts.id.disableAutoSelect();
  nextTick(renderSigninButton);
}

async function loadList() {
  if (!session.value) return;
  listLoading.value = true;
  listError.value = '';
  try {
    const data = await listRequests(session.value.token);
    requests.value = normalizeRequests(data.requests);
  } catch (e) {
    if (!handleAuthFailure(e)) listError.value = '会話一覧を取得できませんでした。';
  } finally {
    listLoading.value = false;
  }
}

function openNew() {
  currentId.value = null;
  currentStatus.value = '';
  currentTitle.value = '';
  messages.value = [];
  threadError.value = '';
  editingTitle.value = false;
  view.value = 'thread';
}

async function openThread(id) {
  currentId.value = id;
  currentTitle.value = (requests.value.find((r) => r.id === id)?.title || '');
  messages.value = [];
  threadError.value = '';
  editingTitle.value = false;
  view.value = 'thread';
  threadLoading.value = true;
  try {
    await refreshThread();
  } finally {
    threadLoading.value = false;
  }
}

function backToList() {
  stopPolling();
  view.value = 'list';
  loadList();
}

async function refreshThread() {
  if (!session.value || !currentId.value) return;
  try {
    const data = await result(session.value.token, currentId.value);
    currentStatus.value = data.status;
    if (typeof data.title === 'string') currentTitle.value = data.title;
    messages.value = mergeMessages(messages.value, data.messages);
    if (shouldPoll(data.status)) startPolling();
    else stopPolling();
  } catch (e) {
    if (!handleAuthFailure(e)) threadError.value = '会話を取得できませんでした。';
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
      const data = await ask(session.value.token, text);
      currentId.value = data.id;
      currentStatus.value = data.status;
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

async function doDelete(id, label) {
  if (deleting.value || !session.value || !id) return;
  if (!window.confirm(`「${label}」を削除しますか？この操作は取り消せません。`)) return;
  deleting.value = true;
  threadError.value = '';
  listError.value = '';
  try {
    await deleteRequest(session.value.token, id);
    if (view.value === 'thread' && id === currentId.value) {
      stopPolling();
      currentId.value = null;
      currentTitle.value = '';
      messages.value = [];
      backToList();
    } else {
      await loadList();
    }
  } catch (e) {
    if (!handleAuthFailure(e)) {
      const msg = '削除できませんでした。もう一度お試しください。';
      if (view.value === 'thread') threadError.value = msg;
      else listError.value = msg;
    }
  } finally {
    deleting.value = false;
  }
}

function deleteFromList(r) {
  doDelete(r.id, displayTitle(r));
}

function deleteCurrent() {
  doDelete(currentId.value, title.value);
}

onMounted(async () => {
  const saved = loadSession();
  if (saved) {
    session.value = saved;
    await loadList();
  } else {
    renderSigninButton();
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <nav class="site-nav">
    <a class="brand" href="/muse/">
      <span class="brand-mark">M</span>
      <span class="brand-text">
        <span class="brand-name">Muse</span>
        <span class="brand-sub">Claudeと話す</span>
      </span>
    </a>
    <span></span>
    <span v-if="session" class="session-note">
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
        <button class="ghost-btn" type="button" :disabled="listLoading" @click="loadList">更新</button>
      </div>
      <p v-if="listError" class="error">{{ listError }}</p>
      <p v-if="listLoading" class="meta"><span class="spinner"></span>読み込んでいます…</p>
      <p v-else-if="requests.length === 0" class="meta">まだ会話がありません。「新しい会話」から始められます。</p>
      <ul v-else class="request-list">
        <li v-for="r in requests" :key="r.id" class="request-item">
          <button class="request-row" type="button" @click="openThread(r.id)">
            <span class="req-main">
              <span class="req-title">{{ displayTitle(r) }}</span>
              <span class="req-sub">
                <span class="status-chip" :class="r.status">{{ statusLabel(r.status) }}</span>
                <span>{{ formatDateTime(r.created_at) }}</span>
                <span class="req-meta">往復 {{ r.round }}</span>
              </span>
            </span>
          </button>
          <button class="danger-btn" type="button" :disabled="deleting" @click="deleteFromList(r)">削除</button>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="thread-head">
        <button class="ghost-btn" type="button" @click="backToList">← 一覧</button>
        <span class="thread-title">{{ currentId ? title : '新しい会話' }}</span>
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
        <template v-else>
          <button class="ghost-btn" type="button" @click="startEditTitle">名前を変更</button>
          <button class="danger-btn" type="button" :disabled="deleting" @click="deleteCurrent()">{{ deleting ? '削除中…' : '削除' }}</button>
        </template>
      </div>
      <p v-if="threadError" class="error">{{ threadError }}</p>
      <p v-if="threadLoading" class="meta thread-loading"><span class="spinner"></span>読み込んでいます…</p>
      <div v-else class="messages">
        <div v-for="(m, i) in messages" :key="i" class="bubble" :class="m.direction">
          {{ m.text }}<span class="bubble-meta">{{ formatDateTime(m.at) }}</span>
        </div>
      </div>
      <p v-if="isPending && !threadLoading" class="pending-note"><span class="spinner"></span>返信を待っています（目安1〜2分、最大10分）</p>
      <p v-if="currentStatus === 'timeout' && !threadLoading" class="error">10分経っても返信がありませんでした。続きを送ると再開できます。</p>
      <form class="composer" @submit.prevent="send">
        <textarea v-model="draft" rows="3" placeholder="Museへの依頼を書く" :disabled="sending || threadLoading"></textarea>
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
