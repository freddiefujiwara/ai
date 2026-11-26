# ai

ClaudeとGroq、二つのAIと話すための専用Webフロント。freddiefujiwara.com/ai/ で公開する（旧 /muse から改名。リダイレクトは置いていない）。

- 見た目と構成は /reader・/xuexi と同じ（Vue 3 + Vite、共通のデザイントークンとステージングバナー）
- ログインは Google Sign-In（本人のGoogleアカウントのみ）。IDトークンを ai-gas の `exchange_session` で検証し、30日セッションに交換する
- 会話ごとに相手のAI（エンジン）を選ぶ。Muse は ai-gas がメールで Muse（メールボックスのアドレスは ai-gas のスクリプトプロパティ MUSE_EMAIL で管理）と橋渡しし、送信後は結果を5秒間隔でポーリング表示する。Groq は ai-gas がその場で呼び、即時応答する。前回選んだエンジンは端末の localStorage（`ai:engine:v1`）に覚える
- 会話一覧は表示中に60秒間隔で背景更新し、しばらく裏に回って戻ったときも取り直す（reader と同じ流儀）。まだ見ていない返信がある会話には未読ドットと「未読 N」ピルが付く。見た状態は端末の localStorage（`ai:seen:v1`、ステージングは `:staging` 付き）だけに持ち、サーバーへは送らない。セッションのキーも `ai:session:v1`（旧 `muse:` 始まりから改名したため、初回は再ログインが要る）
- API の URL はビルド時に CI シークレット `API` で `src/config.js` の `<API>` を置換する（reader と同じ方式）

運用は他のフロントと同じ：PR → ステージング（/ai/staging/）で確認 → マージ → 本番。
