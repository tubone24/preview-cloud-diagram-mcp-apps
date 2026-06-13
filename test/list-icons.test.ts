// list_icons のエンドポイント結合テスト。
// query/category の有無で「カタログ要約」「検索ヒット」「ヒットなし」の3分岐を /mcp 経由で検証する。

import { describe, it, expect } from "vitest";
import { createHandler } from "../src/server/lambda";
import { callTool, stubLoadUiHtml } from "./helpers";

const handler = createHandler(stubLoadUiHtml);

/** list_icons は structuredContent を持たず content[0].text に結果を入れる */
function text(result: any): string {
  return result.content[0].text as string;
}

describe("list_icons", () => {
  it("query/category 無しはカタログ要約を返す", async () => {
    const { statusCode, result } = await callTool(handler, "list_icons", { provider: "aws" });
    expect(statusCode).toBe(200);
    expect(text(result)).toContain("Icon catalog summary for aws");
  });

  it("query にヒットすると件数付きで結果を返す", async () => {
    const { result } = await callTool(handler, "list_icons", { provider: "aws", query: "s3" });
    const t = text(result);
    expect(t).toContain("found for aws");
    // alias "s3" は S3 サービスにヒットするはず
    expect(t.toLowerCase()).toContain("storage");
  });

  it("ヒットしない query には No icons matched を返す", async () => {
    const { result } = await callTool(handler, "list_icons", {
      provider: "aws",
      query: "zzz-nonexistent-service-zzz",
    });
    expect(text(result)).toContain("No icons matched");
  });

  // ---- SaaS / Multi プロバイダー対応テスト ----

  it("provider:saas でカテゴリサマリを返す", async () => {
    const { statusCode, result } = await callTool(handler, "list_icons", { provider: "saas" });
    expect(statusCode).toBe(200);
    expect(text(result)).toContain("Icon catalog summary for saas");
    const t = text(result);
    // SaaS カタログにカテゴリが含まれる
    expect(t).toContain("categories");
    expect(t).toContain("count");
  });

  it("provider:multi でカタログ横断ヒット（vercel は saas カタログにある）", async () => {
    const { result } = await callTool(handler, "list_icons", {
      provider: "multi",
      query: "vercel",
    });
    const t = text(result);
    expect(t).toContain("found for multi");
    expect(t.toLowerCase()).toContain("vercel");
  });

  it("provider:multi で query なしはマージドカタログ要約を返す", async () => {
    const { result } = await callTool(handler, "list_icons", { provider: "multi" });
    expect(text(result)).toContain("Icon catalog summary for multi");
  });

  // ---- Generic（汎用）プロバイダー対応テスト ----

  it("provider:generic でカテゴリサマリを返す", async () => {
    const { statusCode, result } = await callTool(handler, "list_icons", { provider: "generic" });
    expect(statusCode).toBe(200);
    const t = text(result);
    expect(t).toContain("Icon catalog summary for generic");
    // 汎用カタログのカテゴリ（Compute / Network 等）が含まれる
    expect(t).toContain("categories");
    expect(t).toContain("Network");
  });

  it("provider:generic で alias 'router' がヒットする", async () => {
    const { result } = await callTool(handler, "list_icons", {
      provider: "generic",
      query: "router",
    });
    const t = text(result);
    expect(t).toContain("found for generic");
    expect(t.toLowerCase()).toContain("generic-router");
  });

  it("provider:generic で 'server' がヒットする", async () => {
    const { result } = await callTool(handler, "list_icons", {
      provider: "generic",
      query: "server",
    });
    const t = text(result);
    expect(t).toContain("found for generic");
    expect(t.toLowerCase()).toContain("generic-server");
  });
});
