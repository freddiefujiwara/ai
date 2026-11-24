# muse

メール経由でClaudeと話すための専用Webフロント。freddiefujiwara.com/muse/ で公開する。

- 見た目と構成は /reader・/xuexi と同じ（Vue 3 + Vite、共通のデザイントークンとステージングバナー）
- ログインは Google Sign-In（本人のGmailアドレスのみ）。IDトークンを muse-gas の `exchange_session` で検証し、30日セッションに交換する
- 会話は muse-gas がメールで Muse（freddiefujiwara@muse.ai）と橋渡しする。送信後は結果を5秒間隔でポーリング表示する
- API の URL はビルド時に CI シークレット `API` で `src/config.js` の `<API>` を置換する（reader と同じ方式）

運用は他のフロントと同じ：PR → ステージング（/muse/staging/）で確認 → マージ → 本番。
