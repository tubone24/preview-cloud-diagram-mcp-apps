// HTTP ルーティング & MCP プロトコルの基本挙動（エンドポイント結合テスト）。
// 本番デプロイ先である AWS Lambda の handler を直接叩く。

import { describe, it, expect } from "vitest";
import { createHandler } from "../src/server/lambda";
import { makeMcpEvent, makeEvent, parseBody, stubLoadUiHtml, STUB_UI_HTML } from "./helpers";

const handler = createHandler(stubLoadUiHtml);

describe("HTTP ルーティング", () => {
  it("GET / は UI HTML（text/html）を返す", async () => {
    const res = await handler(makeEvent("GET", "/"));
    expect(res).toMatchObject({
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: STUB_UI_HTML,
    });
  });

  it("/mcp 以外の任意パスも UI HTML にフォールバックする", async () => {
    const res = await handler(makeEvent("GET", "/anything/else"));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect((res as { body: string }).body).toBe(STUB_UI_HTML);
  });
});

describe("MCP プロトコル (/mcp)", () => {
  it("tools/list は initialize 無し（stateless）で 3 ツールを返す", async () => {
    const res = await handler(makeMcpEvent({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    expect((res as { statusCode: number }).statusCode).toBe(200);

    const body = parseBody(res);
    expect(body.jsonrpc).toBe("2.0");
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["list_icons", "render_diagram", "render_sequence"]);
  });

  it("未知の method には JSONRPC エラーを返す", async () => {
    const res = await handler(
      makeMcpEvent({ jsonrpc: "2.0", id: 99, method: "no/such/method", params: {} }),
    );
    const body = parseBody(res);
    // プロトコル層でエラーが返ること（result ではなく error が入る）
    expect(body.error).toBeDefined();
    expect(body.result).toBeUndefined();
  });
});
