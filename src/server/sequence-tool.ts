// MCPツール定義: render_sequence（クラウドアイコン付きUMLシーケンス図、UI付き）。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { Provider } from "../shared/diagram-spec";
import type { SequenceEvent, SequenceParticipant, SequenceSpec } from "../shared/sequence-spec";
import { resolveIconId } from "./icons";
import { UI_RESOURCE_URI } from "./tools";

// ---- zod スキーマ（src/shared/sequence-spec.ts の型に対応） ----

const participantSchema = z.object({
  id: z.string().describe("Unique ID within the diagram"),
  icon: z
    .string()
    .describe(
      'Cloud service icon ID or alias shown at the top of the lifeline. AWS: "amazon-ecs", "s3", "alb"; Azure: "azure-virtual-machine", "aks"; GCP: "gcp-gke", "bq". Non-cloud actors can use generic icons like "user", "client", "internet". Search with list_icons',
    ),
  name: z
    .string()
    .optional()
    .describe('Resource-specific name only (e.g. "orders-table"). The service name label is added automatically'),
});

const messageEventSchema = z.object({
  type: z.literal("message"),
  from: z.string().describe("Source participant ID"),
  to: z.string().describe("Target participant ID (same as `from` for kind \"self\")"),
  label: z.string().describe('Concrete operation label (e.g. "PutItem (orders table)", "POST /api/orders")'),
  kind: z
    .enum(["sync", "async", "return", "self"])
    .optional()
    .describe(
      "sync (default): synchronous call, filled arrowhead / async: open arrowhead / return: dashed reply line / self: loop-back arrow on one lifeline",
    ),
  activate: z
    .boolean()
    .optional()
    .describe("Override activation-bar control. Default: sync activates the target"),
  deactivate: z
    .boolean()
    .optional()
    .describe("Override activation-bar control. Default: return deactivates the source"),
});

const fragmentStartSchema = z.object({
  type: z.literal("fragment"),
  kind: z.enum(["alt", "opt", "loop", "par", "break"]).describe("UML combined fragment operator"),
  label: z.string().optional().describe('Guard or loop condition (e.g. "cache miss", "retry up to 3 times")'),
});

const fragmentElseSchema = z.object({
  type: z.literal("else"),
  label: z.string().optional().describe("Guard condition of the else branch"),
});

const fragmentEndSchema = z.object({
  type: z.literal("end"),
});

const noteEventSchema = z.object({
  type: z.literal("note"),
  over: z.array(z.string()).min(1).describe("Participant ID(s) the note spans"),
  text: z.string().describe("Note text"),
});

const sequenceEventSchema = z.discriminatedUnion("type", [
  messageEventSchema,
  fragmentStartSchema,
  fragmentElseSchema,
  fragmentEndSchema,
  noteEventSchema,
]);

const sequenceInputShape = {
  provider: z.enum(["aws", "azure", "gcp"]).describe("Cloud provider. MUST be specified first (for streaming rendering)"),
  title: z.string().optional().describe("Diagram title"),
  participants: z
    .array(participantSchema)
    .describe("Lifelines, displayed left to right in array order. Put the traffic entry point (user/client) leftmost"),
  events: z.array(sequenceEventSchema).describe("Events in chronological order, rendered top to bottom"),
};

const sequenceOutputShape = {
  kind: z.literal("sequence"),
  spec: z.object({
    provider: z.enum(["aws", "azure", "gcp"]).optional(),
    title: z.string().optional(),
    participants: z.array(participantSchema),
    events: z.array(sequenceEventSchema),
  }),
  warnings: z.array(z.string()),
};

const SEQUENCE_DESCRIPTION = `Render a UML-compliant sequence diagram with cloud service icons (AWS / Azure / Google Cloud) on the lifelines. Use this tool whenever you explain HOW a request or data flows between cloud services over time — e.g. "how does a request travel through this system", the order of writes and reads, sync vs. async interactions, retries, and error branches.

**IMPORTANT: Write the \`provider\` argument first.** This enables the UI to start rendering immediately as the arguments stream in.

It complements render_diagram: use the architecture diagram for the static structure and this tool for the dynamic message flow; combining both is very effective.

How to build the spec (CRITICAL):
- \`participants\` are the lifelines, displayed left to right in array order. Put the traffic entry point (user/client) LEFTMOST and follow the request path.
  - \`icon\` is a cloud service icon ID or alias: AWS ("amazon-ecs", "aws-lambda", "s3", "alb", "dynamodb"), Azure ("azure-virtual-machine", "azure-kubernetes-services", "aks"), GCP ("gcp-compute-engine", "gcp-gke", "gke", "gcs", "bq"). Non-cloud actors can use generic icons ("user", "client", "internet"). Search with list_icons if unsure.
  - The service name label is added automatically, so set \`name\` only for a resource-specific name (e.g. "orders-table").
- \`events\` are rendered top to bottom in array order, so list them in chronological order. The UI draws lifelines first, then messages progressively as you stream the arguments.

Event types:
- message: { type: "message", from, to, label, kind?, activate?, deactivate? } — an arrow between lifelines. \`kind\` is one of:
  - "sync" (default): synchronous call — solid line, filled arrowhead
  - "async": asynchronous message (queues, events, fire-and-forget) — solid line, open arrowhead
  - "return": reply/response — dashed line, open arrowhead
  - "self": self message (set \`to\` = \`from\`) — loop-back arrow for internal processing
  By default a sync message activates the target's activation bar and a return deactivates the source; override with \`activate\` / \`deactivate\` when needed.
- fragment / else / end: UML combined fragments. { type: "fragment", kind: "alt" | "opt" | "loop" | "par" | "break", label? } opens a frame around the following events until the matching { type: "end" }. Inside an alt, separate branches with { type: "else", label? }. Fragments may nest; every fragment needs its own end.
- note: { type: "note", over: ["participantId", ...], text } — a supplementary note spanning one or more lifelines.

Labels: write concrete operations, not vague verbs — e.g. "POST /api/orders", "PutItem (orders table)", "SendMessage (order-queue)".

Example (AWS — user → ALB → ECS → DynamoDB write path):
{
  "provider": "aws",
  "title": "Order write path",
  "participants": [
    { "id": "user", "icon": "user" },
    { "id": "alb", "icon": "alb" },
    { "id": "api", "icon": "ecs", "name": "order-api" },
    { "id": "db", "icon": "dynamodb", "name": "orders-table" }
  ],
  "events": [
    { "type": "message", "from": "user", "to": "alb", "label": "POST /api/orders", "kind": "sync" },
    { "type": "message", "from": "alb", "to": "api", "label": "forward request", "kind": "sync" },
    { "type": "message", "from": "api", "to": "db", "label": "PutItem (orders table)", "kind": "sync" },
    { "type": "note", "over": ["db"], "text": "Conditional write prevents duplicate order IDs" },
    { "type": "message", "from": "db", "to": "api", "label": "200 OK", "kind": "return" },
    { "type": "message", "from": "api", "to": "user", "label": "201 Created", "kind": "return" }
  ]
}`;

/** render_sequence を server に登録する */
export function registerSequenceTool(server: McpServer): void {
  registerAppTool(
    server,
    "render_sequence",
    {
      title: "Render cloud sequence diagram (AWS / Azure / GCP)",
      description: SEQUENCE_DESCRIPTION,
      inputSchema: sequenceInputShape,
      outputSchema: sequenceOutputShape,
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ provider, title, participants, events }) => {
      const warnings: string[] = [];

      // 1. participant のアイコン正規化（解決不能は warnings、要素は残す）
      const knownIds = new Set<string>();
      const normalizedParticipants: SequenceParticipant[] = participants.map((p) => {
        if (knownIds.has(p.id)) {
          warnings.push(`participant ID "${p.id}" が重複しています。`);
        }
        knownIds.add(p.id);
        const resolved = resolveIconId(p.icon, provider as Provider);
        if (resolved === null) {
          warnings.push(
            `participant "${p.id}" のアイコン "${p.icon}" が見つかりません。list_icons で検索してください。`,
          );
          return p;
        }
        return resolved === p.icon ? p : { ...p, icon: resolved };
      });

      // 2. message の from/to 参照チェック ＋ 3. fragment/else/end の対応チェック（warnings どまり）
      const fragmentStack: ("alt" | "opt" | "loop" | "par" | "break")[] = [];
      events.forEach((ev, index) => {
        if (ev.type === "message") {
          for (const ref of [ev.from, ev.to] as const) {
            if (!knownIds.has(ref)) {
              warnings.push(
                `events[${index}] のメッセージ "${ev.label}" が未宣言の participant ID "${ref}" を参照しています。`,
              );
            }
          }
          return;
        }
        if (ev.type === "fragment") {
          fragmentStack.push(ev.kind);
          return;
        }
        if (ev.type === "else") {
          const current = fragmentStack[fragmentStack.length - 1];
          if (current === undefined) {
            warnings.push(`events[${index}] の else が fragment の外にあります。`);
          } else if (current !== "alt") {
            warnings.push(`events[${index}] の else が alt 以外のフラグメント（${current}）内にあります。`);
          }
          return;
        }
        if (ev.type === "end") {
          if (fragmentStack.length === 0) {
            warnings.push(`events[${index}] の end に対応する fragment がありません（end が多すぎます）。`);
          } else {
            fragmentStack.pop();
          }
          return;
        }
        // note: over の参照チェック
        for (const ref of ev.over) {
          if (!knownIds.has(ref)) {
            warnings.push(`events[${index}] のノートが未宣言の participant ID "${ref}" を参照しています。`);
          }
        }
      });
      if (fragmentStack.length > 0) {
        warnings.push(
          `閉じられていない fragment が ${fragmentStack.length} 件あります（${fragmentStack.join(", ")}）。end を追加してください。`,
        );
      }

      const spec: SequenceSpec = {
        participants: normalizedParticipants,
        events: events as SequenceEvent[],
        provider: provider as Provider,
      };
      if (title !== undefined) spec.title = title;

      const messageCount = events.filter((ev) => ev.type === "message").length;
      const fragmentCount = events.filter((ev) => ev.type === "fragment").length;
      const noteCount = events.filter((ev) => ev.type === "note").length;
      const providerLabel = provider === "aws" ? "AWS" : provider === "azure" ? "Azure" : "Google Cloud";
      const summaryLines = [
        `${providerLabel}シーケンス図を描画しました${title ? `（${title}）` : ""}: 参加者 ${normalizedParticipants.length} 件、メッセージ ${messageCount} 件${fragmentCount > 0 ? `、フラグメント ${fragmentCount} 件` : ""}${noteCount > 0 ? `、ノート ${noteCount} 件` : ""}。`,
      ];
      if (warnings.length > 0) {
        summaryLines.push(`警告 ${warnings.length} 件:`, ...warnings.map((w) => `- ${w}`));
      }

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        structuredContent: { kind: "sequence", spec, warnings },
      };
    },
  );
}
