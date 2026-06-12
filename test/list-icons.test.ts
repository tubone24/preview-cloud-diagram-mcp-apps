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
});
