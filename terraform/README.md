# AWS Lambda Function URL へのデプロイ

AWS Lambda + Function URL を使って MCP サーバーをデプロイします。Cloudflare Workers 版と同じ MCP エンドポイント互換があり、Claude.ai / Claude Code などのクライアントからそのまま利用できます。

## 前提条件

| ツール | バージョン |
|--------|-----------|
| Node.js | 20 以上 |
| npm | （Node に同梱） |
| Terraform | 1.5 以上 |
| AWS CLI | 設定済み（`aws configure` 済み） |

> **重要:** `terraform apply` はビルドコマンド（`npm ci` / `npm run build:ui` / `npm run build:lambda`）をローカルで実行します。Node.js と npm が使えるビルド環境から apply を実行してください。

## デプロイ手順

```bash
# 1. terraform ディレクトリへ移動
cd terraform

# 2. プロバイダーとモジュールを初期化
terraform init

# 3. 変更内容を確認
terraform plan

# 4. デプロイ（ビルド → Lambda 更新を自動実行）
terraform apply
```

`terraform apply` を実行すると、null_resource が以下を自動的に行います。

1. `npm ci` — 依存関係インストール
2. `npm run build:ui` — Vite で `public/index.html` を生成
3. `npm run build:lambda` — esbuild で `dist/lambda/index.js` を生成し、`public/index.html` を `dist/lambda/index.html` へコピー

手動でビルドする必要はありません。

## 変数一覧

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `region` | `ap-northeast-1` | デプロイ先 AWS リージョン |
| `function_name` | `aws-diagram-mcp` | Lambda 関数名 |
| `memory_size` | `512` | メモリサイズ（MB） |
| `timeout` | `30` | タイムアウト（秒） |
| `log_retention_days` | `7` | CloudWatch Logs の保持日数 |

変数を上書きする場合は `terraform apply -var="function_name=my-mcp"` のように指定するか、`terraform.tfvars` ファイルを作成してください。

## 出力値

`terraform apply` 完了後、以下の値が出力されます。

| 出力名 | 説明 |
|--------|------|
| `function_url` | Lambda Function URL のベース URL（末尾 `/`） |
| `mcp_endpoint` | MCP エンドポイント（`<function_url>mcp`） |

ルート `GET <function_url>` にアクセスすると構成図 UI の HTML が返ります。

## 接続確認

デプロイ後、以下のコマンドで MCP ハンドシェイクを確認できます。

```bash
curl -X POST <mcp_endpoint> \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

`<mcp_endpoint>` は `terraform apply` の出力値（例: `https://xxxx.lambda-url.ap-northeast-1.on.aws/mcp`）に置き換えてください。

## MCP クライアントへの登録

### Claude.ai（カスタムコネクタ）

1. **Settings > Connectors** を開く
2. **Add custom connector** をクリック
3. URL に `mcp_endpoint` の値を入力（認証は不要）

### Claude Code（MCP 設定）

```json
{
  "mcpServers": {
    "cloud-diagram": {
      "url": "<mcp_endpoint>"
    }
  }
}
```

登録後、チャットで AWS / Azure / GCP 構成について質問すると `render_diagram` が呼び出されて構成図がインライン表示されます。

## 注意事項

- **認証なし公開:** Function URL は認証なし（`NONE`）で公開されます。URL が漏れると第三者が無制限に利用できます。不要になったら `terraform destroy` で削除するか、Lambda コンソールで関数を無効化してください。
- **レスポンスサイズ上限:** Lambda のペイロード上限は 6 MB です。UI HTML が約 3 MB あるため、残り約 3 MB が実質的な応答サイズの上限となります。
- **ステートレス限定:** Lambda はリクエストをまたいで状態を保持しません。セッション状態が必要なユースケースには対応していません。

## 後始末

```bash
cd terraform
terraform destroy
```

すべての AWS リソース（Lambda 関数、IAM ロール、CloudWatch Logs グループ、Function URL）が削除されます。
