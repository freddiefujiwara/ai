<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { GOOGLE_CLIENT_ID } from './config.js';
import { loadSession, saveSession, clearSession } from './lib/session.js';
import { exchangeSession, ask, answer, result, listRequests } from './lib/api.js';
import { normalizeRequests, mergeMessages, threadTitle, statusLabel, shouldPoll, formatDateTime } from './lib/chat.js';

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
const messages = ref([]);
const draft = ref('');
const sending = ref(false);
const threadError = ref('');
let pollTimer = null;

const title = computed(() => threadTitle(messages.value, requests.value.find((r) => r.id === currentId.value)?.created_at));
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
  messages.value = [];
  threadError.value = '';
  view.value = 'thread';
}

async function openThread(id) {
  currentId.value = id;
  messages.value = [];
  threadError.value = '';
  view.value = 'thread';
  await refreshThread();
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
        <li v-for="r in requests" :key="r.id">
          <button class="request-row" type="button" @click="openThread(r.id)">
            <span class="status-chip" :class="r.status">{{ statusLabel(r.status) }}</span>
            <span>{{ formatDateTime(r.created_at) }}</span>
            <span class="req-meta">往復 {{ r.round }}</span>
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="thread-head">
        <button class="ghost-btn" type="button" @click="backToList">← 一覧</button>
        <span class="thread-title">{{ currentId ? title : '新しい会話' }}</span>
      </div>
      <p v-if="threadError" class="error">{{ threadError }}</p>
      <div class="messages">
        <div v-for="(m, i) in messages" :key="i" class="bubble" :class="m.direction">
          {{ m.text }}<span class="bubble-meta">{{ formatDateTime(m.at) }}</span>
        </div>
      </div>
      <p v-if="isPending" class="pending-note"><span class="spinner"></span>返信を待っています（目安1〜2分、最大10分）</p>
      <p v-if="currentStatus === 'timeout'" class="error">10分経っても返信がありませんでした。続きを送ると再開できます。</p>
      <form class="composer" @submit.prevent="send">
        <textarea v-model="draft" rows="3" placeholder="Museへの依頼を書く" :disabled="sending"></textarea>
        <button class="primary-btn" type="submit" :disabled="sending || !draft.trim()">{{ sending ? '送信中…' : '送信' }}</button>
      </form>
    </template>
  </main>
</template>
