// Cloudflare Worker エントリポイント。
// /mcp への リクエストは MCP サーバー（Streamable HTTP）へ、それ以外は静的アセット（public/）へ。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createMcpHandler } from "agents/mcp";
import { registerSequenceTool } from "./sequence-tool";
import { registerTools, UI_RESOURCE_URI } from "./tools";

export interface Env {
  /** wrangler.jsonc の assets binding（./public を配信） */
  ASSETS: Fetcher;
}

const SERVER_INFO = { name: "aws-diagram", version: "0.1.0" } as const;

/**
 * リクエストごとに McpServer を生成するファクトリ。
 * UIリソースの読み出しに env.ASSETS が必要なので env を引数で受け取る。
 */
export function createServer(env: Env): McpServer {
  const server = new McpServer(SERVER_INFO);

  registerTools(server);
  registerSequenceTool(server);

  registerAppResource(
    server,
    "AWS Diagram App",
    UI_RESOURCE_URI,
    { description: "Interactive AWS architecture diagram viewer" },
    async () => {
      // ビルド済みUI（public/index.html）を assets binding 経由で読む
      const response = await env.ASSETS.fetch(new Request("https://assets.local/index.html"));
      if (!response.ok) {
        throw new Error(
          `UI asset "index.html" not found in the ASSETS binding (status ${response.status}). ` +
            "Run `npm run build:ui` to build the UI into ./public before starting the server.",
        );
      }
      const html = await response.text();
      return {
        contents: [
          {
            uri: UI_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  return server;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      const server = createServer(env);
      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    }
    // それ以外のパスは静的アセット（public/）にフォールバック
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
