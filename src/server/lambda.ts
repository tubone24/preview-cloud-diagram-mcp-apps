// AWS Lambda エントリポイント（Function URL / payload format 2.0）。
//
// 設計方針:
//   - Web 標準 transport を直接使用: Lambda Function URL は Web Request 相当のイベントを渡してくる。
//     Node 版 StreamableHTTPServerTransport は内部で Node req/res ⇄ Web 変換（@hono/node-server）を行うため、
//     express + serverless-http と組み合わせると「Web → Node(mock) → Web」の二重変換でモック req が壊れ 400 になる。
//     そこで WebStandardStreamableHTTPServerTransport を直接使い、イベント → Web Request → Web Response → Lambda 応答
//     と最短経路で変換する。express / serverless-http は不要。
//   - Stateless: リクエストごとに McpServer と transport を生成・破棄する（使い回しは ID 衝突・500 の原因）。
//   - JSON レスポンス: Function URL はバッファ応答（SSE ストリーミング非対応）のため enableJsonResponse: true。
//   - UI 同梱: dist/lambda/index.html を起動時に一度だけ readFileSync でキャッシュし、/mcp 以外で返す。
//   - Cloudflare 非依存: ASSETS binding / Fetcher を使わず、loadUiHtml を create-server.ts に注入する。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "./create-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

// ── UI HTML を fs から遅延ロード（初回のみ読み込み、以降はメモ化） ──────────────
// esbuild --outfile=dist/lambda/index.js でバンドルするため __dirname は dist/lambda/ を指す。
// cp コマンドで index.html を同ディレクトリに配置済み。
// NOTE: 以前は module top-level で readFileSync していたが、それだと import するだけで
//       ファイルが必須になりテストから読み込めない。遅延化して import を副作用フリーにした。
let cachedUiHtml: string | undefined;

/** fs から HTML を返す loadUiHtml 実装（Lambda 専用 / 初回のみ読み込み） */
const fsLoadUiHtml = async (): Promise<string> => {
  if (cachedUiHtml === undefined) {
    cachedUiHtml = readFileSync(join(__dirname, "index.html"), "utf-8");
  }
  return cachedUiHtml;
};

/** Lambda Function URL イベント（payload v2.0）を Web 標準 Request に変換する */
function eventToRequest(event: APIGatewayProxyEventV2): Request {
  const method = event.requestContext.http.method;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }

  const host = headers.get("host") ?? "localhost";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${host}${event.rawPath}${query}`;

  // GET / HEAD にはボディを付けられない（Web Request の仕様）
  let body: string | undefined;
  if (event.body !== undefined && method !== "GET" && method !== "HEAD") {
    body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  }

  return new Request(url, { method, headers, body });
}

/** Web 標準 Response を Lambda Function URL 応答に変換する */
async function responseToResult(response: Response): Promise<APIGatewayProxyResultV2> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = await response.text();
  return { statusCode: response.status, headers, body };
}

/**
 * Lambda ハンドラを生成するファクトリ。
 *
 * UI HTML の読み込み方法を loadUiHtml として注入できるようにすることで、
 * 本番（fs 読み込み）とテスト（スタブ HTML）の両方から同じ経路をエンドツーエンドで検証できる。
 *
 * @param loadUiHtml - UI HTML を返す非同期関数。省略時は fs から読み込む本番実装。
 */
export function createHandler(loadUiHtml: () => Promise<string> = fsLoadUiHtml) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const path = event.rawPath ?? "/";

    // /mcp 以外はすべて UI HTML を返す
    if (path !== "/mcp") {
      return {
        statusCode: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: await loadUiHtml(),
      };
    }

    // リクエストごとに transport / server を生成（stateless）
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless モード
      enableJsonResponse: true, // Function URL はバッファ応答のため単一 JSON を返す
    });
    const server = createServer(loadUiHtml);

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(eventToRequest(event));
      return await responseToResult(response);
    } catch (err) {
      console.error("[lambda] MCP handler error:", err);
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      };
    } finally {
      // 使い捨ての transport / server を確実に破棄する
      await transport.close();
      await server.close();
    }
  };
}

// ── Lambda ハンドラ export（handler 設定は "index.handler" を指定） ───────────────
// 本番エントリ。fs から UI HTML を読み込む既定のハンドラ。
export const handler = createHandler();
