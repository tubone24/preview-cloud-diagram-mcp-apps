// render_sequence のエンドポイント結合テスト。
// participant 正規化・参照チェック・fragment 対応チェックの振る舞いを /mcp 経由で検証する。

import { describe, it, expect } from "vitest";
import { createHandler } from "../src/server/lambda";
import { callTool, warningsOf, stubLoadUiHtml } from "./helpers";

const handler = createHandler(stubLoadUiHtml);

describe("render_sequence", () => {
  it("正しいシーケンスは警告ゼロで sequence spec を返す", async () => {
    const { statusCode, result } = await callTool(handler, "render_sequence", {
      provider: "aws",
      participants: [
        { id: "user", icon: "user" },
        { id: "api", icon: "ecs", name: "order-api" },
        { id: "db", icon: "dynamodb" },
      ],
      events: [
        { type: "message", from: "user", to: "api", label: "POST /orders", kind: "sync" },
        { type: "message", from: "api", to: "db", label: "PutItem", kind: "sync" },
        { type: "message", from: "db", to: "api", label: "200 OK", kind: "return" },
      ],
    });

    expect(statusCode).toBe(200);
    expect(result.structuredContent.kind).toBe("sequence");
    expect(warningsOf(result)).toEqual([]);
  });

  it("message が未宣言 participant を参照すると警告する", async () => {
    const { result } = await callTool(handler, "render_sequence", {
      provider: "aws",
      participants: [{ id: "user", icon: "user" }],
      events: [{ type: "message", from: "user", to: "ghost", label: "call" }],
    });

    const warnings = warningsOf(result);
    expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("participant ID の重複を警告する", async () => {
    const { result } = await callTool(handler, "render_sequence", {
      provider: "aws",
      participants: [
        { id: "dup", icon: "user" },
        { id: "dup", icon: "ecs" },
      ],
      events: [],
    });

    const warnings = warningsOf(result);
    expect(warnings.some((w) => w.includes("dup") && w.includes("重複"))).toBe(true);
  });

  it("閉じられていない fragment を警告する", async () => {
    const { result } = await callTool(handler, "render_sequence", {
      provider: "aws",
      participants: [
        { id: "a", icon: "user" },
        { id: "b", icon: "ecs" },
      ],
      events: [
        { type: "fragment", kind: "alt", label: "cache hit?" },
        { type: "message", from: "a", to: "b", label: "get" },
        // end を意図的に欠落させる
      ],
    });

    const warnings = warningsOf(result);
    expect(warnings.some((w) => w.includes("閉じられていない fragment"))).toBe(true);
  });

  it("対応 fragment の無い end を警告する", async () => {
    const { result } = await callTool(handler, "render_sequence", {
      provider: "aws",
      participants: [{ id: "a", icon: "user" }],
      events: [{ type: "end" }],
    });

    const warnings = warningsOf(result);
    expect(warnings.some((w) => w.includes("end"))).toBe(true);
  });

  // ---- SaaS / Multi プロバイダー対応テスト ----

  it("provider:multi で participants のアイコン混在が全て解決され警告ゼロ", async () => {
    const { statusCode, result } = await callTool(handler, "render_sequence", {
      provider: "multi",
      participants: [
        { id: "user", icon: "user" },
        { id: "lambda", icon: "aws-lambda" },
        { id: "fn", icon: "azure-functions" },
        { id: "vercel", icon: "saas-vercel" },
      ],
      events: [
        { type: "message", from: "user", to: "lambda", label: "invoke", kind: "sync" },
        { type: "message", from: "lambda", to: "fn", label: "call", kind: "async" },
        { type: "message", from: "fn", to: "vercel", label: "deploy", kind: "async" },
      ],
    });

    expect(statusCode).toBe(200);
    expect(result.structuredContent.kind).toBe("sequence");
    expect(warningsOf(result)).toEqual([]);
  });

  it("provider:saas で alias supabase が解決され警告ゼロ", async () => {
    const { result } = await callTool(handler, "render_sequence", {
      provider: "saas",
      participants: [
        { id: "client", icon: "user" },
        { id: "db", icon: "supabase" },
      ],
      events: [
        { type: "message", from: "client", to: "db", label: "query", kind: "sync" },
      ],
    });

    expect(warningsOf(result)).toEqual([]);
    const participants = result.structuredContent.spec.participants;
    const dbParticipant = participants.find((p: { id: string }) => p.id === "db");
    expect(dbParticipant.icon).toBe("saas-supabase");
  });
});
