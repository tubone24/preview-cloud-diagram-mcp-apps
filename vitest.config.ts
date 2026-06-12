import { defineConfig } from "vitest/config";

// エンドポイントレベルの結合テスト用設定。
// 本番デプロイ先が AWS Lambda (Node) なので、Workers ランタイムではなく
// 既定の Node 環境でテストする（src/server/lambda.ts の handler を直接叩く）。
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
