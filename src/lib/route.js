// URL パス ⇄ 会話ID の純粋関数。スレッド毎URL ( /muse/<id> ) のため。
//
// パスの土台 (base) は Vite の import.meta.env.BASE_URL で、本番は
// "/muse/"、ステージングは "/muse/staging/"。ここでは引数で受け取り、
// DOM や History には触らない (App.vue 側が読み書きを担う)。
//
// 深リンクの受け口は既設の spa-github-pages 方式: 存在しないパスは
// public/404.html が "/muse/?/<パス>" へ畳み、index.html 冒頭の
// スクリプトが元のパスへ復元する。アプリが起動した時点で
// location.pathname は "/muse/<id>" の形に戻っている前提でよい。

// 会話IDとして許す1セグメント。muse-gas のIDはUUIDだが、形式には
// 縛られず英数字・ハイフン・アンダースコアのみを許す (テストの
// ダミーIDでもそのまま動くように)。
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isThreadId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

// base を "/muse/" の形 (先頭・末尾ともスラッシュ) へそろえる。
export function normalizeBase(base) {
  let b = typeof base === 'string' && base ? base : '/';
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

// 一覧のパス。
export function listPath(base) {
  return normalizeBase(base);
}

// 会話のパス。不正なIDなら一覧のパスを返す。
export function threadPath(id, base) {
  const b = normalizeBase(base);
  return isThreadId(id) ? `${b}${id}` : b;
}

// パスから会話IDを取り出す。base 配下の1セグメントだけが対象で、
// 一覧 (base そのもの)・複数セグメント・使えない文字を含むパスは
// 「IDなし」として null を返す。
export function threadIdFromPath(pathname, base) {
  if (typeof pathname !== 'string') return null;
  const b = normalizeBase(base);
  if (!pathname.startsWith(b)) return null;
  let rest = pathname.slice(b.length);
  if (rest.endsWith('/')) rest = rest.slice(0, -1);
  if (!rest || rest.includes('/')) return null;
  return isThreadId(rest) ? rest : null;
}
