// 返信文 (受信メッセージ) の Markdown レンダリング。
// /blog と同じ marked を使うが、こちらはメール経由で届く文面を
// 相手にするため、生HTMLは DOMPurify で必ず浄化してから渡す。
// 送信文 (自分が書いた文) には使わない: App.vue 側で受信側だけに
// 適用する。

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// チャットの返信は1行改行がそのまま改行の意味を持つことが多いので、
// blog (デフォルト) と違って breaks: true で改行として出す。
marked.setOptions({ breaks: true });

// リンクは新規タブで開く。marked の出力に後付けするのではなく、
// 浄化の最終段で a 要素へ属性を付け、危険な href は DOMPurify が
// 先に落とした後であることを保証する。
let linkHookReady = false;
function ensureLinkHook() {
  if (linkHookReady) return;
  linkHookReady = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
  });
}

// Markdown 文字列を浄化済み HTML 文字列にする。
// - img は許可しない (添付画像は App.vue の別枠表示が担う)。
// - script 等の危険な要素・属性・URLスキームは DOMPurify の
//   デフォルトで除去される。
export function renderMarkdown(text) {
  ensureLinkHook();
  const raw = marked.parse(typeof text === 'string' ? text : '');
  return DOMPurify.sanitize(raw, { FORBID_TAGS: ['img'] });
}
