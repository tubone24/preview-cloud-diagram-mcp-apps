# =============================================================
# ビルド: npm ci && npm run build:ui && npm run build:lambda
# プロジェクトルートで実行し dist/lambda/ に成果物を生成する
# =============================================================
resource "null_resource" "build" {
  # apply のたびに必ずビルドを再実行する（timestamp で強制トリガー）
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    # プロジェクトルートで npm ビルドを実行
    working_dir = "${path.module}/.."
    command     = "npm ci && npm run build:ui && npm run build:lambda"
  }
}

# =============================================================
# アーカイブ: dist/lambda/ を lambda.zip に固める
# null_resource.build の完了後に実行されることを depends_on で保証
# =============================================================
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/lambda"
  output_path = "${path.module}/../lambda.zip"

  # ビルドが完了してから zip 化する
  depends_on = [null_resource.build]
}

# =============================================================
# IAM: Lambda 実行ロール
# =============================================================
resource "aws_iam_role" "lambda" {
  name        = "${var.function_name}-role"
  description = "Lambda execution role for ${var.function_name}"

  # Lambda サービスに AssumeRole を許可する信頼ポリシー
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

# CloudWatch Logs への書き込みに必要な AWS 管理ポリシーをアタッチ
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# =============================================================
# CloudWatch Logs: Lambda ロググループ
# Lambda 関数より先に作成してロググループの保持期間を管理する
# =============================================================
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

# =============================================================
# Lambda 関数
# =============================================================
resource "aws_lambda_function" "mcp" {
  function_name = var.function_name
  description   = "AWS Diagram MCP サーバー（Function URL で公開）"

  # ランタイム・ハンドラー設定
  runtime = "nodejs20.x"
  handler = "index.handler"

  # IAM ロール
  role = aws_iam_role.lambda.arn

  # デプロイパッケージ（archive_file で生成した zip）
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  # リソース設定
  memory_size = var.memory_size
  timeout     = var.timeout

  # IAM ポリシーアタッチとロググループの作成完了後に Lambda を作成
  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_cloudwatch_log_group.lambda,
  ]
}

# =============================================================
# Lambda Function URL: 認証なし・パブリック公開
# =============================================================
resource "aws_lambda_function_url" "mcp" {
  function_name      = aws_lambda_function.mcp.function_name
  authorization_type = "NONE" # 認証なし（パブリックアクセス）

  # CORS 設定
  cors {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "DELETE"]
    allow_headers = [
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "authorization",
    ]
    max_age = 86400 # プリフライトキャッシュ 24 時間
  }
}

# =============================================================
# Lambda リソースポリシー: Function URL への全員アクセス許可
# authorization_type = "NONE" だけでは不十分で、
# lambda:InvokeFunctionUrl を Principal="*" で明示的に許可する必要がある
# =============================================================
resource "aws_lambda_permission" "allow_public_url" {
  statement_id           = "AllowPublicFunctionURL"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.mcp.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# 2025年10月以降、Function URL経由の呼び出しには lambda:InvokeFunction も別途必要
resource "aws_lambda_permission" "allow_invoke_via_url" {
  statement_id  = "FunctionURLAllowInvokeAction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mcp.function_name
  principal     = "*"
}
