# Lambda Function URL（末尾スラッシュ付きで返される）
output "function_url" {
  description = "Lambda Function URL のベース URL（末尾スラッシュ付き）"
  value       = aws_lambda_function_url.mcp.function_url
}

# MCP エンドポイント（Function URL + "mcp"）
# aws_lambda_function_url は末尾スラッシュ付きで返すため、"mcp" を直接連結する
output "mcp_endpoint" {
  description = "MCP サーバーのエンドポイント URL"
  value       = "${aws_lambda_function_url.mcp.function_url}mcp"
}
