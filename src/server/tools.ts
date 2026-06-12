// MCPツール定義: render_diagram（UI付き）と list_icons（検索）。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import {
  GROUP_KINDS_BY_PROVIDER,
  GROUP_STYLES,
  type DiagramElement,
  type DiagramSpec,
  type GroupKind,
  type Provider,
} from "../shared/diagram-spec";
import { aliasCount, allIconEntries, categorySummary, resolveIconId, searchIcons } from "./icons";

/** UIリソースのURI（registerAppResource 側と一致させること） */
export const UI_RESOURCE_URI = "ui://cloud-diagram/app.html";

// ---- zod スキーマ（src/shared/diagram-spec.ts の型に対応） ----

const GROUP_KINDS = Object.keys(GROUP_STYLES) as [GroupKind, ...GroupKind[]];

const groupSchema = z.object({
  type: z.literal("group"),
  id: z.string().describe("Unique ID within the diagram"),
  kind: z.enum(GROUP_KINDS).describe("Group frame kind (AWS / Azure / GCP)"),
  label: z.string().optional().describe("Display label. Defaults to the kind's standard label (e.g. \"AWS Cloud\")"),
  parent: z.string().optional().describe("ID of the enclosing group"),
});

const nodeSchema = z.object({
  type: z.literal("node"),
  id: z.string().describe("Unique ID within the diagram"),
  icon: z.string().describe("Icon ID or alias. AWS: \"amazon-ec2\", \"s3\"; Azure: \"azure-virtual-machine\", \"vm\"; GCP: \"gcp-compute-engine\", \"gke\". Search with list_icons"),
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
  provider: z.enum(["aws", "azure", "gcp"]).describe("Cloud provider. MUST be specified first (for streaming rendering)"),
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
    provider: z.enum(["aws", "azure", "gcp"]).optional(),
    title: z.string().optional(),
    elements: z.array(elementSchema),
    steps: z.array(z.string()).optional(),
  }),
  warnings: z.array(z.string()),
};

const RENDER_DESCRIPTION = `Render a cloud architecture diagram (AWS / Azure / Google Cloud) using official cloud service icons. Use this tool whenever you explain a cloud architecture to the user or propose one — it displays an interactive diagram inline in the conversation.

**IMPORTANT: Write the \`provider\` argument first.** This enables the UI to start rendering immediately as the arguments stream in.

How to build \`elements\` (CRITICAL):
- ORDER MATTERS: list elements in traffic-flow order, starting from the entry point (user/client) and following the request path. The UI renders elements progressively from the start of the array, so the diagram grows along the flow as you stream it.
- Declare a group BEFORE any element that references it via \`parent\`.

Element types:
- group: { type: "group", id, kind, label?, parent? } — a container frame. \`kind\` must match the selected provider (see nesting conventions below).
- node: { type: "node", id, icon, name?, parent?, step? } — a cloud service or resource. \`icon\` is an icon ID or alias; if unsure, search with list_icons first. The service name label is added automatically from the icon, so set \`name\` only for a resource-specific name (e.g. "web-server-01"); omit it otherwise.
- edge: { type: "edge", from, to, label?, direction?, step? } — a connection between two node/group IDs. \`direction\` is "forward" (default), "both", or "none".
- note: { type: "note", id, text, parent?, attachTo? } — an annotation box for supplementary explanations that icons cannot express. Use sparingly — prefer icons and edge labels first.

Group nesting conventions by provider:
- **AWS**: aws-cloud > region > vpc > availability-zone > public-subnet / private-subnet. Supported kinds: aws-cloud, region, availability-zone, vpc, public-subnet, private-subnet, security-group, auto-scaling-group, aws-account, ec2-instance-contents, server-contents, corporate-data-center, spot-fleet, step-functions-workflow, generic.
- **Azure**: azure-cloud > azure-subscription > azure-resource-group > azure-vnet > azure-subnet. azure-availability-zone can be placed inside azure-vnet in parallel with subnets. Supported kinds: azure-cloud, azure-subscription, azure-resource-group, azure-vnet, azure-subnet, azure-availability-zone, azure-management-group, azure-app-service-plan, generic, corporate-data-center, server-contents.
- **GCP**: gcp-cloud > gcp-project > gcp-vpc > gcp-region > gcp-zone > gcp-subnet. NOTE: GCP VPC is global and contains Regions (the opposite of AWS where VPC is regional). Supported kinds: gcp-cloud, gcp-project, gcp-vpc, gcp-region, gcp-zone, gcp-subnet, gcp-shared-vpc, generic, corporate-data-center, server-contents.

Icon IDs and aliases by provider:
- **AWS**: service icons (e.g. "amazon-ec2", "aws-lambda") or aliases ("s3", "alb", "rds", "cloudfront", "ecs", "dynamodb"). Resource icons (white bg) for detailed views: "ecs-task", "ec2-instance", "s3-bucket", etc.
- **Azure**: service icons (e.g. "azure-virtual-machine", "azure-kubernetes-services", "azure-cosmos-db") or aliases ("vm", "aks", "cosmos").
- **GCP**: service icons (e.g. "gcp-compute-engine", "gcp-gke", "gcp-cloud-storage") or aliases ("gce", "gke", "gcs", "bq", "pubsub", "run").

Numbered callouts (step + steps):
- The official way to explain a processing flow: assign \`step\` (a 1-based number rendered as a black circle with a white number) to the edges/nodes along the flow, and put the matching explanations in the top-level \`steps\` array.
- Assign numbers in linear reading order: left → right, top → bottom.

Icon catalog — service icons vs. resource icons (AWS):
- Service icons (colored squares, e.g. "amazon-ecs", "amazon-s3") represent a service as a whole.
- Resource icons (white-background line art, ~470 available) represent components INSIDE a service. Short aliases work: "ecs-task", "ecs-service", "ec2-instance", "lambda-function", "s3-bucket".

Example (AWS — user → CloudFront → ALB → EC2):
{
  "provider": "aws",
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
    { "type": "edge", "from": "alb", "to": "web", "step": 3 }
  ],
  "steps": ["User requests the page over HTTPS", "CloudFront forwards cache misses to the ALB", "ALB routes the request to the EC2 web server"]
}`;

const LIST_ICONS_DESCRIPTION = `Search the catalog of cloud service icon IDs usable in the \`icon\` field of render_diagram nodes. Supports AWS, Azure, and Google Cloud icons. Performs a case-insensitive partial match against icon IDs, display names, and aliases (so short aliases like "s3", "vm", "gke" also match). Optionally filter by category (e.g. "Compute", "Database", "Networking"). Returns up to 50 results as {id, name, category}. Pass \`provider\` to search the correct cloud catalog. Call with no query/category to get the category list with icon counts for the selected provider.`;

/** render_diagram と list_icons を server に登録する */
export function registerTools(server: McpServer): void {
  registerAppTool(
    server,
    "render_diagram",
    {
      title: "Render cloud architecture diagram (AWS / Azure / GCP)",
      description: RENDER_DESCRIPTION,
      inputSchema: renderInputShape,
      outputSchema: renderOutputShape,
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ provider, title, elements, steps }) => {
      const warnings: string[] = [];
      const knownIds = new Set<string>();
      const validGroupKinds = new Set<string>(GROUP_KINDS_BY_PROVIDER[provider as Provider]);

      // 1パス目: node の icon 正規化 / group の kind バリデーション / ID 収集
      const normalized: DiagramElement[] = elements.map((el) => {
        if (el.type === "node") {
          knownIds.add(el.id);
          const resolved = resolveIconId(el.icon, provider as Provider);
          if (resolved === null) {
            warnings.push(
              `node "${el.id}" のアイコン "${el.icon}" が見つかりません。list_icons で検索してください。`,
            );
            return el;
          }
          return resolved === el.icon ? el : { ...el, icon: resolved };
        }
        if (el.type === "group") {
          knownIds.add(el.id);
          if (!validGroupKinds.has(el.kind)) {
            warnings.push(
              `group "${el.id}" の kind "${el.kind}" は provider "${provider}" では使用できません。描画は続行しますが、正しい kind に修正してください（使用可能: ${[...validGroupKinds].join(", ")}）。`,
            );
          }
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

      const spec: DiagramSpec = { elements: normalized, provider: provider as Provider };
      if (title !== undefined) spec.title = title;
      if (steps !== undefined) spec.steps = steps;

      const nodeCount = normalized.filter((el) => el.type === "node").length;
      const groupCount = normalized.filter((el) => el.type === "group").length;
      const edgeCount = normalized.filter((el) => el.type === "edge").length;
      const noteCount = normalized.filter((el) => el.type === "note").length;
      const providerLabel = provider === "aws" ? "AWS" : provider === "azure" ? "Azure" : "Google Cloud";
      const summaryLines = [
        `${providerLabel}構成図を描画しました${title ? `（${title}）` : ""}: ノード ${nodeCount} 件、グループ ${groupCount} 件、エッジ ${edgeCount} 件${noteCount > 0 ? `、ノート ${noteCount} 件` : ""}。`,
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
    "list_icons",
    {
      title: "List cloud service icons (AWS / Azure / GCP)",
      description: LIST_ICONS_DESCRIPTION,
      inputSchema: {
        provider: z.enum(["aws", "azure", "gcp"]).describe("Cloud provider to search icons for"),
        query: z.string().optional().describe("Partial match against icon ID, name, or alias (case-insensitive)"),
        category: z.string().optional().describe("Filter by category (e.g. \"Compute\", \"Database\", \"Networking\")"),
      },
    },
    async ({ provider, query, category }) => {
      if (!query && !category) {
        const catalog = provider as Provider;
        const entries = catalog === "aws" ? allIconEntries : [];
        const summary = {
          provider,
          totalIcons: catalog === "aws" ? allIconEntries.length : categorySummary(catalog).reduce((s, c) => s + c.count, 0),
          aliases: catalog === "aws" ? aliasCount : 0,
          categories: categorySummary(catalog),
        };
        void entries;
        return {
          content: [
            {
              type: "text",
              text: `Icon catalog summary for ${provider} (pass query and/or category to search):\n${JSON.stringify(summary)}`,
            },
          ],
        };
      }

      const results = searchIcons(query, category, 50, provider as Provider);
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No icons matched provider=${provider} query=${JSON.stringify(query ?? "")} category=${JSON.stringify(category ?? "")}. Try a shorter keyword.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${results.length} icon(s) found for ${provider} (max 50):\n${JSON.stringify(results)}`,
          },
        ],
      };
    },
  );
}
