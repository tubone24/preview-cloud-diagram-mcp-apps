// 結合テスト用ヘルパー。
// Lambda Function URL (payload format 2.0) のイベントを組み立て、handler の応答を扱いやすくする。

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

/** テストで注入するスタブ UI HTML（fs 読み込みを避ける） */
export const STUB_UI_HTML = "<!doctype html><title>stub</title>";
export const stubLoadUiHtml = async (): Promise<string> => STUB_UI_HTML;

/** 最小限の APIGatewayProxyEventV2 を組み立てる */
export function makeEvent(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { host: "test.local", ...opts.headers },
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" },
    } as APIGatewayProxyEventV2["requestContext"],
    body,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

/** MCP の /mcp に JSONRPC を POST するイベント（streamable-HTTP が要求する Accept ヘッダ付き） */
export function makeMcpEvent(jsonrpc: unknown): APIGatewayProxyEventV2 {
  return makeEvent("POST", "/mcp", {
    body: jsonrpc,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
  });
}

/** Lambda 応答の body を JSON としてパースする */
export function parseBody(result: APIGatewayProxyResultV2): any {
  const r = result as { body?: string };
  if (typeof r.body !== "string") throw new Error("result.body is not a string");
  return JSON.parse(r.body);
}

type LambdaHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

/**
 * /mcp に tools/call を投げ、JSONRPC の result を返すヘルパー。
 * エンドポイントを通した実応答（structuredContent / content）を検証しやすくする。
 */
export async function callTool(
  handler: LambdaHandler,
  name: string,
  args: Record<string, unknown>,
  id = 1,
): Promise<{ statusCode: number; result: any; error: any; raw: any }> {
  const res = await handler(
    makeMcpEvent({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  );
  const body = parseBody(res);
  return { statusCode: (res as { statusCode: number }).statusCode, result: body.result, error: body.error, raw: body };
}

/** result.structuredContent.warnings を取り出す（無ければ空配列） */
export function warningsOf(result: any): string[] {
  return result?.structuredContent?.warnings ?? [];
}
