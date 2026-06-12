# デプロイ先 AWS リージョン
variable "region" {
  type        = string
  description = "デプロイ先 AWS リージョン"
  default     = "ap-northeast-1"
}

# Lambda 関数名
variable "function_name" {
  type        = string
  description = "Lambda 関数名（CloudWatch ロググループ名にも使用される）"
  default     = "aws-diagram-mcp"
}

# Lambda に割り当てるメモリサイズ（MB）
variable "memory_size" {
  type        = number
  description = "Lambda 関数のメモリサイズ（MB）"
  default     = 512
}

# Lambda タイムアウト（秒）
variable "timeout" {
  type        = number
  description = "Lambda 関数のタイムアウト時間（秒）"
  default     = 30
}

# CloudWatch ログの保持日数
variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs のログ保持日数"
  default     = 14
}
