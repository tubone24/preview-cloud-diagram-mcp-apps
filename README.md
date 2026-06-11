# AWS構成図 MCP App

AWS公式アーキテクチャアイコンを使ってAWS構成図をインタラクティブに描画する [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) サーバーです。Cloudflare Workers 上で動作し、Claude.ai / Claude Code などのMCPクライアントから利用できます。

Claudeが構成を説明・提案するときに `render_aws_diagram` ツールを呼ぶと、会話内にUI（構成図）がインライン表示されます。要素はトラフィックの入口側から順に並べる契約になっており、ツール引数のストリーミングに合わせてUIが先頭からプログレッシブに描画します。

## アーキテクチャ

```
+------------------+         +---------------------------------------------+
|  MCPクライアント  |  HTTPS  |  Cloudflare Worker (aws-diagram-mcp)        |
|  (Claude.ai等)   +-------->|                                             |
|                  |  /mcp   |  src/server/index.ts                        |
|  +------------+  |         |   +-- McpServer (リクエストごとに生成)       |
|  | iframe UI  |<-----------|   |    +-- tool: render_aws_diagram (UI付き)|
|  | (構成図)    |  ui://...  |   |    +-- tool: list_aws_icons            |
|  +------------+  |         |   |    +-- resource: ui://aws-diagram/     |
+------------------+         |   |         app.html (public/index.html)   |
                             |   +-- それ以外のパス --> env.ASSETS (public/)|
                             +---------------------------------------------+

ビルドパイプライン:
  assets/aws-icons/** --build:icons--> src/generated/icon-manifest.json ほか
  src/ui/**           --build:ui----> public/index.html (vite, 単一HTML)
```

- `src/shared/diagram-spec.ts` … DiagramSpec型（サーバー・UI共通の契約）
- `src/server/` … MCPサーバー（Worker本体）
- `src/ui/` … 構成図レンダラ（viteで単一HTMLにビルドされ `public/index.html` になる）
- `src/generated/icon-manifest.json` … アイコンカタログ（306サービス + 47リソース + 13グループ、エイリアス57件）

## セットアップ

```bash
npm install

# アイコンマニフェスト生成（assets/aws-icons から src/generated/ を生成）
npm run build:icons

# UIビルド（vite → public/index.html）
npm run build:ui

# ローカル起動（http://localhost:8787/mcp がMCPエンドポイント）
npx wrangler dev
```

`npm run dev` で build:ui と wrangler dev をまとめて実行できます。

## Cloudflareへのデプロイ

GitHub Actions により、`main` ブランチへの push で自動デプロイされます。事前にリポジトリの **Settings > Secrets and variables > Actions** で以下のSecretsを設定してください。

| Secret | 取得方法 |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | [Cloudflareダッシュボード](https://dash.cloudflare.com/profile/api-tokens) > Create Token > 「Edit Cloudflare Workers」テンプレートで作成 |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareダッシュボードのWorkers & Pages画面右側に表示されるAccount ID |

手動デプロイする場合:

```bash
npm run deploy
```

デプロイ後のMCPエンドポイントは `https://aws-diagram-mcp.<account>.workers.dev/mcp` です。

## Claude.aiへの登録（カスタムコネクタ）

1. Claude.ai の **Settings > Connectors** を開く
2. **Add custom connector** をクリック
3. URLに `https://aws-diagram-mcp.<account>.workers.dev/mcp` を入力（認証は不要）
4. 追加後、チャットでAWS構成について質問すると、Claudeが `render_aws_diagram` を呼び出して構成図を表示します

例: 「CloudFront + ALB + ECSの一般的なWeb構成を図で説明して」

## ツール仕様

### render_aws_diagram（UI付きツール）

AWS構成図を描画します。結果は `ui://aws-diagram/app.html` のUIにインライン表示されます。

入力:

| フィールド | 型 | 説明 |
|-----------|----|------|
| `title` | `string?` | 図のタイトル |
| `elements` | `DiagramElement[]` | 構成要素。**入口側（user/client）から処理の流れの順**に並べる。groupは中の要素より先に宣言する |

`DiagramElement`（`type` による discriminated union）:

- **group** — `{ type: "group", id, kind, label?, parent? }`
  - `kind`: `aws-cloud` / `region` / `availability-zone` / `vpc` / `public-subnet` / `private-subnet` / `security-group` / `auto-scaling-group` / `aws-account` / `ec2-instance-contents` / `server-contents` / `corporate-data-center` / `spot-fleet` / `step-functions-workflow` / `generic`
  - 入れ子はAWS公式の慣例に従う: `aws-cloud > region > vpc > availability-zone > subnet`
- **node** — `{ type: "node", id, icon, name?, parent? }`
  - `icon`: アイコンID（例 `amazon-ec2`、`aws-lambda`）。`s3`・`alb` などのエイリアスも可
  - `name`: リソース固有名（任意）。サービス名ラベルはアイコンから自動付与
- **edge** — `{ type: "edge", from, to, label?, direction? }`
  - `direction`: `forward`（既定）/ `both` / `none`

出力: `content` に日本語サマリ、`structuredContent` に `{ kind: "architecture", spec: 正規化済みDiagramSpec, warnings: string[] }`。アイコンIDはエイリアス解決・プレフィックス補完・部分一致で正規化され、解決できないアイコンや存在しないIDを参照するedgeは `warnings` に記録されます（要素自体は残ります）。

### render_aws_sequence（UI付きツール）

AWSサービス間の通信フロー・処理シーケンスをUML準拠のシーケンス図として描画します。結果は構成図と同じ `ui://aws-diagram/app.html` のUIにインライン表示され、UI側は `structuredContent.kind` で構成図とシーケンス図を描き分けます。構成図（`render_aws_diagram`）で静的な構造を、本ツールで動的なメッセージフローを示す使い分けです。

入力:

| フィールド | 型 | 説明 |
|-----------|----|------|
| `title` | `string?` | 図のタイトル |
| `participants` | `SequenceParticipant[]` | ライフライン。**左からトラフィック入口順**（user/client が最左）に並べる |
| `events` | `SequenceEvent[]` | **上から時系列順**のイベント列 |

`SequenceParticipant` — `{ id, icon, name? }`
- `icon`: AWSアイコンID（例 `amazon-ecs`）。`alb`・`dynamodb` などのエイリアス可、AWS以外は `user`・`client`・`internet` 等の汎用アイコンを使用。`list_aws_icons` で検索可能
- `name`: リソース固有名（任意）。サービス名ラベルはアイコンから自動付与

`SequenceEvent`（`type` による discriminated union）:

- **message** — `{ type: "message", from, to, label, kind?, activate?, deactivate? }`
  - `kind`: `sync`（既定、同期呼び出し・塗り矢じり）/ `async`（非同期・開き矢じり）/ `return`（応答・破線）/ `self`（自己処理）
  - `label` には具体的な処理内容を書く（例 `"PutItem (orders table)"`、`"POST /api/orders"`）
- **fragment / else / end** — 複合フラグメント。`{ type: "fragment", kind: "alt" | "opt" | "loop" | "par" | "break", label? }` で開始し、対応する `{ type: "end" }` で閉じる。`alt` の分岐は `{ type: "else", label? }` で区切る
- **note** — `{ type: "note", over: string[], text }`。ライフラインをまたぐ補足ノート

出力: `content` に日本語サマリ（参加者数・メッセージ数・警告）、`structuredContent` に `{ kind: "sequence", spec: 正規化済みSequenceSpec, warnings: string[] }`。participantのアイコンIDは構成図と同じ規則で正規化され、解決できないアイコン・未宣言participantへの参照・フラグメントの対応不整合（`end` 過多、閉じ忘れ、`alt` 外の `else`）は `warnings` に記録されます（要素自体は残ります）。

### list_aws_icons

`render_aws_diagram` の `icon` に使えるアイコンIDを検索します。

| 引数 | 型 | 説明 |
|------|----|------|
| `query` | `string?` | ID・名前・エイリアスへの部分一致（大文字小文字無視） |
| `category` | `string?` | カテゴリ絞り込み（例 `Compute`、`Database`） |

結果は `{id, name, category}` を最大50件。引数なしで呼ぶとカテゴリ一覧と件数サマリを返します。

## 開発メモ

```bash
npm run typecheck   # 型チェック
```

ローカルでの動作確認（MCPハンドシェイク）:

```bash
curl -s http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}'
```
