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

  it("node の tech/description がパススルーされ spec に残り警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [
        {
          type: "node",
          id: "api",
          icon: "amazon-ec2",
          tech: "Spring Boot",
          description: "Handles REST API requests",
        },
      ],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.tech).toBe("Spring Boot");
    expect(node.description).toBe("Handles REST API requests");
    expect(warningsOf(result)).toEqual([]);
  });

  it("c4-system-boundary / c4-container-boundary / pipeline-stage が aws で警告なし", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [
        { type: "group", id: "sys", kind: "c4-system-boundary" },
        { type: "group", id: "cont", kind: "c4-container-boundary", parent: "sys" },
        { type: "group", id: "stage", kind: "pipeline-stage" },
      ],
    });

    expect(warningsOf(result)).toEqual([]);
  });

  it("c4-system-boundary / c4-container-boundary / pipeline-stage が azure / gcp で警告なし", async () => {
    for (const provider of ["azure", "gcp"] as const) {
      const { result } = await callTool(handler, "render_diagram", {
        provider,
        elements: [
          { type: "group", id: "sys", kind: "c4-system-boundary" },
          { type: "group", id: "cont", kind: "c4-container-boundary", parent: "sys" },
          { type: "group", id: "stage", kind: "pipeline-stage" },
        ],
      });
      expect(warningsOf(result)).toEqual([]);
    }
  });

  it("edge style:dashed がパススルーされ警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [
        { type: "node", id: "n1", icon: "amazon-ec2" },
        { type: "node", id: "n2", icon: "aws-lambda" },
        { type: "edge", from: "n1", to: "n2", style: "dashed", label: "trigger" },
      ],
    });

    const edge = result.structuredContent.spec.elements[2];
    expect(edge.style).toBe("dashed");
    expect(warningsOf(result)).toEqual([]);
  });

  it("不正な style 値（dotted）は Zod バリデーションエラーになる", async () => {
    const { result, error } = await callTool(handler, "render_diagram", {
      provider: "aws",
      elements: [
        { type: "node", id: "n1", icon: "amazon-ec2" },
        { type: "node", id: "n2", icon: "aws-lambda" },
        { type: "edge", from: "n1", to: "n2", style: "dotted" },
      ],
    });
    const rejected = error !== undefined || result?.isError === true;
    expect(rejected).toBe(true);
  });

  it("pipeline-stage 3つ + エッジで正常な spec が返る", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "aws",
      title: "CI/CD Pipeline",
      elements: [
        { type: "group", id: "source", kind: "pipeline-stage", label: "Source" },
        { type: "group", id: "build", kind: "pipeline-stage", label: "Build" },
        { type: "group", id: "deploy", kind: "pipeline-stage", label: "Deploy" },
        { type: "node", id: "repo", icon: "amazon-ec2", parent: "source" },
        { type: "node", id: "ci", icon: "aws-lambda", parent: "build" },
        { type: "node", id: "app", icon: "amazon-ec2", parent: "deploy" },
        { type: "edge", from: "source", to: "build", style: "dashed" },
        { type: "edge", from: "build", to: "deploy" },
      ],
    });

    expect(result.structuredContent.kind).toBe("architecture");
    expect(warningsOf(result)).toEqual([]);
    const edges = result.structuredContent.spec.elements.filter((e: { type: string }) => e.type === "edge");
    expect(edges[0].style).toBe("dashed");
  });

  // ---- SaaS / Multi プロバイダー対応テスト ----

  it("provider:saas で alias vercel → saas-vercel に正規化され警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "saas",
      elements: [{ type: "node", id: "n1", icon: "vercel" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("saas-vercel");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:multi で4プロバイダー混在が全て警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [
        { type: "node", id: "n1", icon: "aws-lambda" },
        { type: "node", id: "n2", icon: "azure-functions" },
        { type: "node", id: "n3", icon: "gcp-cloud-run" },
        { type: "node", id: "n4", icon: "saas-vercel" },
      ],
    });

    expect(warningsOf(result)).toEqual([]);
    const icons = result.structuredContent.spec.elements.map((e: { icon: string }) => e.icon);
    expect(icons).toContain("aws-lambda");
    expect(icons).toContain("saas-vercel");
  });

  it("provider:multi で異種 group kind 混在が警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [
        { type: "group", id: "aws-grp", kind: "aws-cloud" },
        { type: "group", id: "azure-grp", kind: "azure-cloud" },
        { type: "node", id: "n1", icon: "aws-lambda", parent: "aws-grp" },
        { type: "node", id: "n2", icon: "azure-functions", parent: "azure-grp" },
      ],
    });

    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:multi でプレフィックスなし s3 → aws 先勝ちで amazon-simple-storage-service", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [{ type: "node", id: "n1", icon: "s3" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("amazon-simple-storage-service");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:multi でプレフィックス明示 azure-functions が AWS 部分一致に食われない", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [{ type: "node", id: "n1", icon: "azure-functions" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toContain("azure");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:saas で AWS General フォールバック（user が解決される）", async () => {
    // "user" は AWS General カテゴリに id として存在するため saas でもフォールバック解決される
    const { result } = await callTool(handler, "render_diagram", {
      provider: "saas",
      elements: [{ type: "node", id: "n1", icon: "user" }],
    });

    expect(warningsOf(result)).toEqual([]);
    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("user"); // AWS General の id "user" がそのまま正規IDとして解決される
  });

  it("provider:multi で空白入りクエリ 'cloud run' が正規化されて GCP アイコンに解決される", async () => {
    // W-1 修正の検証: 空白・アンダースコアをハイフンに変換して "cloud-run" として部分一致解決
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [{ type: "node", id: "n1", icon: "cloud run" }],
    });

    expect(warningsOf(result)).toEqual([]);
    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toContain("cloud-run"); // gcp-cloud-run 等にマッチする
  });

  it("provider:multi でアンダースコア入りクエリ 'cloud_run' が正規化されて解決される", async () => {
    // W-1 修正の検証: アンダースコアもハイフンに変換して解決
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [{ type: "node", id: "n1", icon: "cloud_run" }],
    });

    expect(warningsOf(result)).toEqual([]);
    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toContain("cloud-run");
  });

  // ---- Generic（汎用）プロバイダー対応テスト ----

  it("provider:generic で alias router → generic-router に正規化され警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "generic",
      elements: [{ type: "node", id: "n1", icon: "router" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("generic-router");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:generic で alias server → generic-server に正規化され警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "generic",
      elements: [{ type: "node", id: "n1", icon: "server" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("generic-server");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:generic で corporate-data-center group kind が警告なし", async () => {
    const { result } = await callTool(handler, "render_diagram", {
      provider: "generic",
      elements: [
        { type: "group", id: "dc", kind: "corporate-data-center" },
        { type: "node", id: "n1", icon: "database", parent: "dc" },
      ],
    });

    const node = result.structuredContent.spec.elements[1];
    expect(node.icon).toBe("generic-database");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:multi で server は AWS 先勝ちで解決される（generic-server に乗っ取られない）", async () => {
    // generic を MULTI_PROVIDER_ORDER / ALL_SVGS の末尾に置いたことで
    // 既存 AWS 図の解決が不変であることを保証する回帰ガード。
    const { result } = await callTool(handler, "render_diagram", {
      provider: "multi",
      elements: [{ type: "node", id: "n1", icon: "server" }],
    });

    const node = result.structuredContent.spec.elements[0];
    expect(node.icon).toBe("server"); // AWS General の id "server"（generic-server ではない）
    expect(warningsOf(result)).toEqual([]);
  });
});
