# 開発と SDLC

小さく、テストで守り、CI で毎回自動検証する。人が判断し、機械が検証する。

## 構造

```
blz/
  bin/blz.mjs        CLI の入口。エラー処理と表示だけ。ロジックは持たない。
  src/core.mjs       取り込みと検証。内容アドレス化、SHA-256、マニフェスト。
  src/timestamp.mjs  OpenTimestamps の存在証明。best-effort。
  src/seed.mjs       アンカーノード。WebSeed origin とシード。
  tests/             node:test の自動テスト。ネットワークに触らない。
  .github/workflows/ CI。push と PR で npm test。
```

## 開発の流れ

1. 変更は必ずテストとセットにする。core のロジックはテストで固定する。
2. `npm test` がローカルで緑になってから push する。
3. push と PR で CI が Node 20 と 22 で自動テストする。緑でないものは入れない。
4. バージョンは semver。破壊的変更はメジャーを上げる。
5. 依存は最小に保つ。暗号は自作せず監査済みライブラリのみ。

## 走らせ方

```
npm install
npm test
node bin/blz.mjs ingest <file> --webseed http://your-origin
node bin/blz.mjs verify <manifest.json> <file>
node bin/blz.mjs seed --port 6969
```

## 動かせない一線

- 取り込みの CSAM ハッシュ照合ゲートを、公開シードの前に必ず通す。自前の分類器は作らない。
- 実データ、鍵、認証情報を Git に置かない。`.gitignore` と、コミット前の秘密検査を守る。
- 金の移動に関与するコードは書かない。決済もエスクローも取引市場も入れない。

## 実装済み（脇潰し一巡）

1. 多ノードの蘇生。複数 origin で、単一ノードを止めても完走する。`npm run test:revival`
2. カタログ公開と独立ミラー。運営が消えても別運営が生かす。`blz index` と `blz mirror` と Dockerfile。`npm run test:mirror`
3. 取り込みゲート。既知の禁止ハッシュに fail-closed で照合。`blz ingest --blocklist`。seed は cleared だけ配信。
4. OpenTimestamps の確認畳み込み。`blz upgrade`。

## タイムスタンプの定期実行

保留中の証明を Bitcoin の確認に畳み込むため、`blz upgrade` を定期で回す。Bitcoin の確認には数時間かかるので、毎週で十分。

cron の例:
```
0 3 * * 0 cd /app && node bin/blz.mjs upgrade --catalog /app/catalog >> /var/log/blz-upgrade.log 2>&1
```
常駐で回すなら: `node bin/blz.mjs upgrade --watch 1440`（1日ごと）

## 次の段（本番運用の前に必要なこと）

- 取り込み照合を、実際の PhotoDNA / NCMEC / Thorn プロバイダに差す。NCMEC ESP 登録と弁護士対応が前提。
- 財政スポンサー（CS&S 等）の傘で法人格を得る。詳細は ../OPERATING_PLAN.md。
- カタログを実際の git 公開リポジトリでミラーする。
