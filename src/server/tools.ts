// MCPツール定義: render_aws_diagram（UI付き）と list_aws_icons（検索）。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { GROUP_STYLES, type DiagramElement, type DiagramSpec, type GroupKind } from "../shared/diagram-spec";
import { aliasCount, allIconEntries, categorySummary, resolveIconId, searchIcons } from "./icons";

/** UIリソースのURI（registerAppResource 側と一致させること） */
export const UI_RESOURCE_URI = "ui://aws-diagram/app.html";

// ---- zod スキーマ（src/shared/diagram-spec.ts の型に対応） ----

const GROUP_KINDS = Object.keys(GROUP_STYLES) as [GroupKind, ...GroupKind[]];

const groupSchema = z.object({
  type: z.literal("group"),
  id: z.string().describe("Unique ID within the diagram"),
  kind: z.enum(GROUP_KINDS).describe("Official AWS group frame kind"),
  label: z.string().optional().describe("Display label. Defaults to the kind's standard label (e.g. \"AWS Cloud\")"),
  parent: z.string().optional().describe("ID of the enclosing group"),
});

const nodeSchema = z.object({
  type: z.literal("node"),
  id: z.string().describe("Unique ID within the diagram"),
  icon: z.string().describe("Icon ID (e.g. \"amazon-ec2\", \"aws-lambda\") or alias (e.g. \"s3\", \"alb\"). Search with list_aws_icons"),
  name: z.string().optional().describe("Resource-specific name only (e.g. \"web-server-01\"). The service name label is added automatically"),
  parent: z.string().optional().describe("ID of the enclosing group"),
  step: z.number().int().min(1).optional().describe("Numbered callout (black circle, white number). 1-based index into the top-level `steps` legend"),
});

const edgeSchema = z.object({
  type: z.literal("edge"),
  id: z.string().optional(),
  from: z.string().describe("Source node/group ID"),
  to: z.string().describe("Target node/group ID"),
  label: z.string().optional().describe("Label shown on the line (e.g. \"HTTPS\")"),
  direction: z.enum(["forward", "both", "none"]).optional().describe("Arrow direction. Defaults to forward"),
  step: z.number().int().min(1).optional().describe("Numbered callout (black circle, white number) shown at the line midpoint. 1-based index into the top-level `steps` legend"),
});

const noteSchema = z.object({
  type: z.literal("note"),
  id: z.string().describe("Unique ID within the diagram"),
  text: z.string().describe("Annotation text (multi-line allowed)"),
  parent: z.string().optional().describe("ID of the enclosing group (omit to place directly on the canvas)"),
  attachTo: z.string().optional().describe("Node/group ID this note should be placed next to"),
});

const elementSchema = z.discriminatedUnion("type", [groupSchema, nodeSchema, edgeSchema, noteSchema]);

const renderInputShape = {
  title: z.string().optional().describe("Diagram title"),
  elements: z
    .array(elementSchema)
    .describe("Diagram elements in traffic-flow order, starting from the entry point (user/client)"),
  steps: z
    .array(z.string())
    .optional()
    .describe("Legend for numbered callouts (1-based). Rendered below the diagram as a \"1. ...\" list; node/edge `step` values reference these entries"),
};

const renderOutputShape = {
  kind: z.literal("architecture"),
  spec: z.object({
    title: z.string().optional(),
    elements: z.array(elementSchema),
    steps: z.array(z.string()).optional(),
  }),
  warnings: z.array(z.string()),
};

const RENDER_DESCRIPTION = `Render an AWS architecture diagram using official AWS architecture icons. Use this tool whenever you explain an AWS architecture to the user or propose one — it displays an interactive diagram inline in the conversation.

How to build \`elements\` (CRITICAL):
- ORDER MATTERS: list elements in traffic-flow order, starting from the entry point (user/client) and following the request path. The UI renders elements progressively from the start of the array, so the diagram grows along the flow as you stream it.
- Declare a group BEFORE any element that references it via \`parent\`.

Element types:
- group: { type: "group", id, kind, label?, parent? } — a container frame. \`kind\` is one of: aws-cloud, region, availability-zone, vpc, public-subnet, private-subnet, security-group, auto-scaling-group, aws-account, ec2-instance-contents, server-contents, corporate-data-center, spot-fleet, step-functions-workflow, generic. Follow the official AWS nesting convention: aws-cloud > region > vpc > availability-zone > subnet.
- node: { type: "node", id, icon, name?, parent?, step? } — an AWS service or resource. \`icon\` is an icon ID such as "amazon-ec2" or "aws-lambda"; common aliases like "s3", "alb", "rds" also work. If unsure of an icon ID, search with the list_aws_icons tool first. The service name label is added automatically from the icon, so set \`name\` only for a resource-specific name (e.g. "web-server-01"); omit it otherwise.
- edge: { type: "edge", from, to, label?, direction?, step? } — a connection between two node/group IDs. \`direction\` is "forward" (default), "both", or "none".
- note: { type: "note", id, text, parent?, attachTo? } — an annotation box for supplementary explanations that icons cannot express (constraints, caveats, design intent). Set \`attachTo\` to a node/group ID to place the note next to that element; set \`parent\` to put it inside a group. Use sparingly — prefer icons and edge labels first.

Numbered callouts (step + steps):
- The official AWS way to explain a processing flow: assign \`step\` (a 1-based number rendered as a black circle with a white number) to the edges/nodes along the flow, and put the matching explanations in the top-level \`steps\` array. The legend is rendered below the diagram as a numbered list.
- Per the official guideline, assign numbers in linear reading order: left → right, top → bottom.

Icon catalog — service icons vs. resource icons:
- Service icons (colored squares, e.g. "amazon-ecs", "amazon-s3") represent a service as a whole.
- Resource icons (white-background line art, ~470 available) represent components INSIDE a service, e.g. "amazon-elastic-container-service-task" (ECS Task), "amazon-elastic-container-service-service" (ECS Service). Short aliases work too: "ecs-task", "ecs-service", "ec2-instance", "lambda-function", "s3-bucket", etc.
- Use resource icons for detailed diagrams: tasks/services inside an ECS cluster, individual S3 buckets, single EC2 instances, and similar per-resource views. Search them with list_aws_icons.

Example (user → CloudFront → ALB → EC2 in a public subnet, with numbered flow and a note):
{
  "title": "Simple web app",
  "elements": [
    { "type": "node", "id": "user", "icon": "users" },
    { "type": "group", "id": "cloud", "kind": "aws-cloud" },
    { "type": "node", "id": "cdn", "icon": "cloudfront", "parent": "cloud" },
    { "type": "group", "id": "vpc", "kind": "vpc", "parent": "cloud" },
    { "type": "group", "id": "public-subnet", "kind": "public-subnet", "parent": "vpc" },
    { "type": "node", "id": "alb", "icon": "alb", "parent": "public-subnet" },
    { "type": "node", "id": "web", "icon": "amazon-ec2", "name": "web-server", "parent": "public-subnet" },
    { "type": "edge", "from": "user", "to": "cdn", "label": "HTTPS", "step": 1 },
    { "type": "edge", "from": "cdn", "to": "alb", "step": 2 },
    { "type": "edge", "from": "alb", "to": "web", "step": 3 },
    { "type": "note", "id": "note-cache", "text": "Static assets are cached at the edge for 24h", "attachTo": "cdn" }
  ],
  "steps": [
    "User requests the page over HTTPS",
    "CloudFront forwards cache misses to the ALB",
    "ALB routes the request to the EC2 web server"
  ]
}`;

const LIST_ICONS_DESCRIPTION = `Search the catalog of AWS architecture icon IDs usable in the \`icon\` field of render_aws_diagram nodes. Performs a case-insensitive partial match against icon IDs, display names, and aliases (so short aliases like "s3", "ec2", "alb" also match). Optionally filter by category (e.g. "Compute", "Database", "General"). Returns up to 50 results as {id, name, category}. Call with no arguments to get the category list with icon counts.`;

/** render_aws_diagram と list_aws_icons を server に登録する */
export function registerTools(server: McpServer): void {
  registerAppTool(
    server,
    "render_aws_diagram",
    {
      title: "Render AWS architecture diagram",
      description: RENDER_DESCRIPTION,
      inputSchema: renderInputShape,
      outputSchema: renderOutputShape,
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ title, elements, steps }) => {
      const warnings: string[] = [];
      const knownIds = new Set<string>();

      // 1パス目: node の icon 正規化と ID 収集
      const normalized: DiagramElement[] = elements.map((el) => {
        if (el.type === "node") {
          knownIds.add(el.id);
          const resolved = resolveIconId(el.icon);
          if (resolved === null) {
            warnings.push(
              `node "${el.id}" のアイコン "${el.icon}" が見つかりません。list_aws_icons で検索してください。`,
            );
            return el;
          }
          return resolved === el.icon ? el : { ...el, icon: resolved };
        }
        if (el.type === "group") {
          knownIds.add(el.id);
        }
        return el;
      });

      // 2パス目: edge / note の参照チェック（要素自体は残す）
      for (const el of normalized) {
        if (el.type === "edge") {
          for (const ref of [el.from, el.to] as const) {
            if (!knownIds.has(ref)) {
              warnings.push(`edge "${el.from} → ${el.to}" が存在しないID "${ref}" を参照しています。`);
            }
          }
          continue;
        }
        if (el.type === "note") {
          if (el.attachTo !== undefined && !knownIds.has(el.attachTo)) {
            warnings.push(`note "${el.id}" の attachTo が存在しないID "${el.attachTo}" を参照しています。`);
          }
          if (el.parent !== undefined && !knownIds.has(el.parent)) {
            warnings.push(`note "${el.id}" の parent が存在しないID "${el.parent}" を参照しています。`);
          }
        }
      }

      const spec: DiagramSpec = { elements: normalized };
      if (title !== undefined) spec.title = title;
      if (steps !== undefined) spec.steps = steps;

      const nodeCount = normalized.filter((el) => el.type === "node").length;
      const groupCount = normalized.filter((el) => el.type === "group").length;
      const edgeCount = normalized.filter((el) => el.type === "edge").length;
      const noteCount = normalized.filter((el) => el.type === "note").length;
      const summaryLines = [
        `AWS構成図を描画しました${title ? `（${title}）` : ""}: ノード ${nodeCount} 件、グループ ${groupCount} 件、エッジ ${edgeCount} 件${noteCount > 0 ? `、ノート ${noteCount} 件` : ""}。`,
      ];
      if (warnings.length > 0) {
        summaryLines.push(`警告 ${warnings.length} 件:`, ...warnings.map((w) => `- ${w}`));
      }

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        structuredContent: { kind: "architecture", spec, warnings },
      };
    },
  );

  server.registerTool(
    "list_aws_icons",
    {
      title: "List AWS icons",
      description: LIST_ICONS_DESCRIPTION,
      inputSchema: {
        query: z.string().optional().describe("Partial match against icon ID, name, or alias (case-insensitive)"),
        category: z.string().optional().describe("Filter by category (e.g. \"Compute\", \"Database\")"),
      },
    },
    async ({ query, category }) => {
      if (!query && !category) {
        const summary = {
          totalIcons: allIconEntries.length,
          aliases: aliasCount,
          categories: categorySummary(),
        };
        return {
          content: [
            {
              type: "text",
              text: `Icon catalog summary (pass query and/or category to search):\n${JSON.stringify(summary)}`,
            },
          ],
        };
      }

      const results = searchIcons(query, category);
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No icons matched query=${JSON.stringify(query ?? "")} category=${JSON.stringify(category ?? "")}. Try a shorter keyword.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${results.length} icon(s) found (max 50):\n${JSON.stringify(results)}`,
          },
        ],
      };
    },
  );
}
