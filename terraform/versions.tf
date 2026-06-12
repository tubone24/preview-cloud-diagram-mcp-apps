# Terraform バージョンおよびプロバイダー設定
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    # AWS リソース管理プロバイダー
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # Lambda zip アーカイブ生成プロバイダー
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    # ビルドコマンド実行用 null プロバイダー
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

# AWS プロバイダー設定（リージョンは変数で切り替え可能）
provider "aws" {
  region = var.region
}
