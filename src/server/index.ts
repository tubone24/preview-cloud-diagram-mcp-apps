// Cloudflare Worker エントリポイント。
// /mcp への リクエストは MCP サーバー（Streamable HTTP）へ、それ以外は静的アセット（public/）へ。
// McpServer の生成ロジックは ./create-server に切り出している。

import { createMcpHandler } from "agents/mcp";
import { createServer } from "./create-server";

export interface Env {
  /** wrangler.jsonc の assets binding（./public を配信） */
  ASSETS: Fetcher;
}

// createServer を re-export して既存の import を壊さない
export { createServer } from "./create-server";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      // Cloudflare 用の loadUiHtml: ASSETS binding 経由で index.html を取得する
      const loadUiHtml = async () => {
        const response = await env.ASSETS.fetch(new Request("https://assets.local/index.html"));
        if (!response.ok) {
          throw new Error(
            `UI asset "index.html" not found in the ASSETS binding (status ${response.status}). ` +
              "Run `npm run build:ui` to build the UI into ./public before starting the server.",
          );
        }
        return response.text();
      };

      const server = createServer(loadUiHtml);
      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    }
    // それ以外のパスは静的アセット（public/）にフォールバック
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
