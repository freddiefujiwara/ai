// 新規会話のエンジン選択 (端末ローカルの好み)。会話が始まれば
// エンジンはサーバー側の会話データが正で、ここは「次に始める
// 会話の初期値」を覚えるだけ。本番・ステージングで分けても
// 害はないが、単なる表示の好みなのでキーは共通にする。
import { normalizeEngine } from './chat.js';

export const ENGINE_PREF_KEY = 'ai:engine:v1';

export function loadEnginePref(storage = localStorage) {
  try {
    return normalizeEngine(storage.getItem(ENGINE_PREF_KEY));
  } catch {
    return 'Muse';
  }
}

export function saveEnginePref(engine, storage = localStorage) {
  try {
    storage.setItem(ENGINE_PREF_KEY, normalizeEngine(engine));
  } catch {
    // 保存できなくても、その場の選択自体は使える。
  }
}
