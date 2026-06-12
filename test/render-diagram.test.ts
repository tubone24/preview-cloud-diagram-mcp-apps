// render_diagram のエンドポイント結合テスト。
// /mcp 経由で tools/call し、正規化（アイコン alias 解決）とバリデーション警告の振る舞いを検証する。

import { describe, it, expect } from "vitest";
import { createHandler } from "../src/server/lambda";
import { callTool, warningsOf, stubLoadUiHtml } from "./helpers";

const handler = createHandler(stubLoadUiHtml);

describe("render_diagram", () => {
  it("正しい構成は警告ゼロで architecture spec を返す", async () => {
    const { statusCode, result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      title: "web app",
      elements: [
        { type: "node", id: "user", icon: "users" },
        { type: "group", id: "cloud", kind: "aws-cloud" },
        { type: "node", id: "web", icon: "amazon-ec2", parent: "cloud" },
        { type: "edge", from: "user", to: "web", label: "HTTPS" },
      ],
    });

    expect(statusCode).toBe(200);
    expect(result.structuredContent.kind).toBe("architecture");
    expect(result.structuredContent.spec.provider).toBe("aws");
    expect(result.structuredContent.spec.title).toBe("web app");
    expect(warningsOf(result)).toEqual([]);
  });

  it("アイコン alias を正規 ID に解決する（s3 → amazon-simple-storage-service）", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [{ type: "node", id: "n1", icon: "s3" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("amazon-simple-storage-service");
    expect(warningsOf(result)).toEqual([]);
  });

  it("未知のアイコンは警告を出しつつ要素は残す", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [{ type: "node", id: "n1", icon: "totally-unknown-icon" }],
    });

    const warnings = warningsOf(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("totally-unknown-icon");
    // 要素自体は描画継続のため残る
    expect(result.structuredContent.spec.elements[0].icon).toBe("totally-unknown-icon");
  });

  it("provider に合わない group kind を警告する（aws に azure-vnet）", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [{ type: "group", id: "g1", kind: "azure-vnet" }],
    });

    const warnings = warningsOf(result);
    expect(warnings.some((w) => w.includes("azure-vnet") && w.includes("aws"))).toBe(true);
  });

  it("存在しない ID を参照する edge を警告する", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [
        { type: "node", id: "n1", icon: "amazon-ec2" },
        { type: "edge", from: "n1", to: "ghost" },
      ],
    });

    const warnings = warningsOf(result);
    expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("複数の問題を同時に検出する（不明アイコン + 不正kind + dangling edge）", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [
        { type: "node", id: "n1", icon: "s3" },
        { type: "node", id: "n2", icon: "totally-unknown-icon" },
        { type: "group", id: "g1", kind: "gcp-vpc" },
        { type: "edge", from: "n1", to: "ghost" },
      ],
    });
    expect(warningsOf(result)).toHaveLength(3);
  });

  it("provider が enum 外だと入力バリデーションで弾かれる", async () => {
    const { result, error } = await callTool(handler, "render_diagram", {
      provider: "oracle",
      elements: [],
    });
    // ツールハンドラに到達する前に zod / MCP 層で弾かれる（isError か error のどちらか）
    const rejected = error !== undefined || result?.isError === true;
    expect(rejected).toBe(true);
  });
});
