// McpServer ファクトリ。
// Cloudflare（env.ASSETS 経由）と Lambda（fs 経由）の両方から使えるよう、
// UI HTML の取得方法を loadUiHtml コールバックとして注入する形にしている。
// これにより Cloudflare 固有の Fetcher API に依存せず、どの実行環境でも動く。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { registerSequenceTool } from "./sequence-tool";
import { registerTools, UI_RESOURCE_URI } from "./tools";

export const SERVER_INFO = { name: "cloud-diagram", version: "0.2.0" } as const;

/**
 * McpServer を生成するファクトリ。
 *
 * @param loadUiHtml - ビルド済み UI の HTML 文字列を返す非同期関数。
 *   Cloudflare では env.ASSETS.fetch、Lambda では fs.readFileSync をラップして渡す。
 */
export function createServer(loadUiHtml: () => Promise<string>): McpServer {
  const server = new McpServer(SERVER_INFO);

  registerTools(server);
  registerSequenceTool(server);

  registerAppResource(
    server,
    "Cloud Diagram App",
    UI_RESOURCE_URI,
    { description: "Interactive cloud architecture diagram viewer (AWS / Azure / Google Cloud)" },
    async () => {
      // 呼び出し元から注入された UI 読み込み関数を利用する
      const html = await loadUiHtml();
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
