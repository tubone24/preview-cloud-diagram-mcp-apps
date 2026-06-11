// MCP App エントリポイント。
// App ライフサイクル（partial input → input → result）と
// ツールバー（SVG/PNGダウンロード・フルスクリーン）、選択→updateModelContext、
// パン/ズーム、デモモード（?demo=1 または file://）を担当する。
import { App } from "@modelcontextprotocol/ext-apps";
import {
  GROUP_STYLES,
  type DiagramElement,
  type DiagramSpec,
  type GroupKind,
} from "../shared/diagram-spec";
import { layoutDiagram, type DiagramLayout } from "./layout";
import { DiagramRenderer, type SelectionInfo } from "./render";

// ---- DOM ----
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const titleEl = $("title") as HTMLDivElement;
const warningsEl = $("warnings") as HTMLDivElement;
const canvasWrap = $("canvas-wrap") as HTMLDivElement;
const emptyEl = $("empty") as HTMLDivElement;
const streamingEl = $("streaming") as HTMLDivElement;
const svg = document.getElementById("diagram") as unknown as SVGSVGElement;

const renderer = new DiagramRenderer(svg);
let currentLayout: DiagramLayout | null = null;
let connected = false;

// ---- バリデーション ----
// strict=true（ストリーミング中）は配列末尾の不完全要素を弾くため
// 必須フィールドの存在と、group.kind が既知であることまで検証する。
// edge は from/to の参照先が（その時点で）存在するものだけ受理する。
function sanitizeElements(raw: unknown, strict: boolean): DiagramElement[] {
  const out: DiagramElement[] = [];
  if (!Array.isArray(raw)) return out;
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (e.type === "group") {
      if (
        typeof e.id !== "string" ||
        e.id === "" ||
        typeof e.kind !== "string" ||
        ids.has(e.id)
      ) {
        continue;
      }
      const known = Object.prototype.hasOwnProperty.call(GROUP_STYLES, e.kind);
      if (strict && !known) continue; // kind が途中までしか届いていない可能性
      out.push({
        type: "group",
        id: e.id,
        kind: (known ? e.kind : "generic") as GroupKind,
        label: typeof e.label === "string" ? e.label : undefined,
        parent: typeof e.parent === "string" ? e.parent : undefined,
      });
      ids.add(e.id);
    } else if (e.type === "node") {
      if (
        typeof e.id !== "string" ||
        e.id === "" ||
        typeof e.icon !== "string" ||
        e.icon === "" ||
        ids.has(e.id)
      ) {
        continue;
      }
      out.push({
        type: "node",
        id: e.id,
        icon: e.icon,
        name: typeof e.name === "string" ? e.name : undefined,
        parent: typeof e.parent === "string" ? e.parent : undefined,
        step: typeof e.step === "number" && Number.isFinite(e.step) ? e.step : undefined,
      });
      ids.add(e.id);
    } else if (e.type === "note") {
      if (
        typeof e.id !== "string" ||
        e.id === "" ||
        typeof e.text !== "string" ||
        e.text === "" ||
        ids.has(e.id)
      ) {
        continue;
      }
      out.push({
        type: "note",
        id: e.id,
        text: e.text,
        parent: typeof e.parent === "string" ? e.parent : undefined,
        attachTo: typeof e.attachTo === "string" ? e.attachTo : undefined,
      });
      ids.add(e.id);
    } else if (e.type === "edge") {
      if (typeof e.from !== "string" || typeof e.to !== "string") continue;
      if (!ids.has(e.from) || !ids.has(e.to)) continue;
      const direction =
        e.direction === "both" || e.direction === "none" ? e.direction : "forward";
      out.push({
        type: "edge",
        id: typeof e.id === "string" ? e.id : undefined,
        from: e.from,
        to: e.to,
        label: typeof e.label === "string" ? e.label : undefined,
        direction,
        step: typeof e.step === "number" && Number.isFinite(e.step) ? e.step : undefined,
      });
    }
  }
  return out;
}

function sanitizeSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => (typeof s === "string" ? s : "")).filter((s) => s !== "");
}

// ---- パン/ズーム ----
class PanZoom {
  private vb: { x: number; y: number; w: number; h: number } | null = null;
  private base = { w: 280, h: 160 };
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  wasDrag = false;

  constructor(private readonly target: SVGSVGElement) {
    target.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const rect = target.getBoundingClientRect();
        const v = this.view();
        const factor = ev.deltaY > 0 ? 1.12 : 1 / 1.12;
        const newW = Math.min(
          this.base.w * 4,
          Math.max(this.base.w / 10, v.w * factor),
        );
        const newH = newW * (this.base.h / this.base.w);
        const fx = (ev.clientX - rect.left) / rect.width;
        const fy = (ev.clientY - rect.top) / rect.height;
        this.vb = {
          x: v.x + (v.w - newW) * fx,
          y: v.y + (v.h - newH) * fy,
          w: newW,
          h: newH,
        };
        this.apply();
      },
      { passive: false },
    );
    target.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      this.dragging = true;
      this.moved = false;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      target.setPointerCapture(ev.pointerId);
    });
    target.addEventListener("pointermove", (ev) => {
      if (!this.dragging) return;
      const dx = ev.clientX - this.lastX;
      const dy = ev.clientY - this.lastY;
      if (!this.moved && Math.hypot(dx, dy) < 5) return;
      this.moved = true;
      this.wasDrag = true;
      const rect = this.target.getBoundingClientRect();
      const v = this.view();
      this.vb = {
        x: v.x - dx * (v.w / rect.width),
        y: v.y - dy * (v.h / rect.height),
        w: v.w,
        h: v.h,
      };
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      this.apply();
    });
    const endDrag = (ev: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.target.hasPointerCapture(ev.pointerId)) {
        this.target.releasePointerCapture(ev.pointerId);
      }
      // click イベントは pointerup 直後に同期発火するため、その後にリセット
      setTimeout(() => {
        this.wasDrag = false;
      }, 0);
    };
    target.addEventListener("pointerup", endDrag);
    target.addEventListener("pointercancel", endDrag);
    target.addEventListener("dblclick", () => {
      this.vb = null;
      this.apply();
    });
  }

  private view() {
    return this.vb ?? { x: 0, y: 0, w: this.base.w, h: this.base.h };
  }

  setBase(w: number, h: number): void {
    this.base = { w, h };
    this.apply();
  }

  private apply(): void {
    const v = this.view();
    this.target.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }
}

const panZoom = new PanZoom(svg);
renderer.isDragClick = () => panZoom.wasDrag;

// ---- 描画 ----
function renderSpec(
  title: string | undefined,
  elements: DiagramElement[],
  steps: string[] = [],
): void {
  titleEl.textContent = title ?? "";
  titleEl.hidden = !title;
  const hasContent = elements.some((e) => e.type !== "edge");
  emptyEl.hidden = hasContent;
  if (!hasContent) return;
  const layout = layoutDiagram(elements, steps);
  currentLayout = layout;
  renderer.render(layout);
  panZoom.setBase(layout.width, layout.height);
  svg.style.aspectRatio = `${layout.width} / ${layout.height}`;
}

function showWarnings(warnings: string[]): void {
  if (warnings.length > 0) {
    warningsEl.textContent = warnings.join("\n");
    warningsEl.hidden = false;
  } else {
    warningsEl.hidden = true;
  }
}

function setStreaming(on: boolean): void {
  streamingEl.hidden = !on;
}

function applyTheme(theme: string | undefined): void {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

// ---- App ライフサイクル ----
const app = new App({ name: "aws-diagram", version: "0.1.0" }, {});

interface RawArgs {
  title?: unknown;
  elements?: unknown;
  steps?: unknown;
}

app.addEventListener("toolinputpartial", (params) => {
  const args = params.arguments as RawArgs | undefined;
  if (!args) return;
  setStreaming(true);
  renderSpec(
    typeof args.title === "string" ? args.title : undefined,
    sanitizeElements(args.elements, true),
    sanitizeSteps(args.steps),
  );
});

app.addEventListener("toolinput", (params) => {
  const args = params.arguments as RawArgs | undefined;
  if (!args) return;
  renderSpec(
    typeof args.title === "string" ? args.title : undefined,
    sanitizeElements(args.elements, false),
    sanitizeSteps(args.steps),
  );
});

app.addEventListener("toolresult", (params) => {
  setStreaming(false);
  const sc = params.structuredContent as
    | { spec?: DiagramSpec; warnings?: string[] }
    | undefined;
  if (sc?.spec) {
    // サーバー正規化済み（icon はエイリアス解決済み）を最終描画とする
    renderSpec(
      sc.spec.title,
      sanitizeElements(sc.spec.elements, false),
      sanitizeSteps(sc.spec.steps),
    );
  }
  showWarnings(Array.isArray(sc?.warnings) ? sc.warnings : []);
});

app.addEventListener("toolcancelled", () => {
  setStreaming(false);
});

app.addEventListener("hostcontextchanged", (ctx) => {
  if (ctx.theme) applyTheme(ctx.theme);
});

// ---- 選択 → モデルコンテキスト ----
renderer.onselect = (sel: SelectionInfo | null) => {
  if (!connected) return;
  const text = sel
    ? sel.name
      ? `ユーザーは構成図の ${sel.serviceName}（${sel.name}）を選択した`
      : `ユーザーは構成図の ${sel.serviceName} を選択した`
    : "ユーザーは構成図の選択を解除した";
  void app
    .updateModelContext({ content: [{ type: "text", text }] })
    .catch(() => undefined);
};

// ---- エクスポート ----
function buildSvgString(): string | null {
  if (!currentLayout) return null;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    renderer.exportSvgString(currentLayout.width, currentLayout.height)
  );
}

function fallbackDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadSvg(): Promise<void> {
  const text = buildSvgString();
  if (!text) return;
  if (connected) {
    try {
      await app.downloadFile({
        contents: [
          {
            type: "resource",
            resource: {
              uri: "file:///aws-diagram.svg",
              mimeType: "image/svg+xml",
              text,
            },
          },
        ],
      });
      return;
    } catch {
      // ホスト未対応 → フォールバック
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  fallbackDownload(url, "aws-diagram.svg");
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function renderPngDataUrl(): Promise<string | null> {
  const text = buildSvgString();
  if (!text || !currentLayout) return null;
  const { width, height } = currentLayout;
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG画像の読み込みに失敗"));
  });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
  await loaded;
  const scale = 2; // 2x解像度
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

async function downloadPng(): Promise<void> {
  let dataUrl: string | null = null;
  try {
    dataUrl = await renderPngDataUrl();
  } catch {
    return;
  }
  if (!dataUrl) return;
  if (connected) {
    try {
      await app.downloadFile({
        contents: [
          {
            type: "resource",
            resource: {
              uri: "file:///aws-diagram.png",
              mimeType: "image/png",
              blob: dataUrl.slice(dataUrl.indexOf(",") + 1),
            },
          },
        ],
      });
      return;
    } catch {
      // ホスト未対応 → フォールバック
    }
  }
  fallbackDownload(dataUrl, "aws-diagram.png");
}

async function toggleFullscreen(): Promise<void> {
  if (connected) {
    const ctx = app.getHostContext();
    const mode = ctx?.displayMode === "fullscreen" ? "inline" : "fullscreen";
    if (!ctx?.availableDisplayModes || ctx.availableDisplayModes.includes(mode)) {
      try {
        await app.requestDisplayMode({ mode });
        return;
      } catch {
        // ホスト未対応 → ブラウザAPIへ
      }
    }
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await canvasWrap.requestFullscreen();
  } catch {
    // フルスクリーン不可環境では何もしない
  }
}

$("btn-svg").addEventListener("click", () => void downloadSvg());
$("btn-png").addEventListener("click", () => void downloadPng());
$("btn-fs").addEventListener("click", () => void toggleFullscreen());

// ---- デモモード ----
const DEMO_SPEC: DiagramSpec = {
  title: "3層Webアプリケーション構成",
  elements: [
    { type: "node", id: "user", icon: "user" },
    { type: "group", id: "cloud", kind: "aws-cloud" },
    { type: "node", id: "r53", icon: "amazon-route-53", parent: "cloud" },
    { type: "edge", from: "user", to: "r53", label: "DNS", step: 1 },
    { type: "node", id: "cf", icon: "cloudfront", parent: "cloud" },
    { type: "edge", from: "r53", to: "cf" },
    { type: "group", id: "vpc", kind: "vpc", label: "VPC 10.0.0.0/16", parent: "cloud" },
    { type: "node", id: "alb", icon: "alb", name: "web-alb", parent: "vpc" },
    { type: "edge", from: "cf", to: "alb", label: "HTTPS", step: 2 },
    { type: "group", id: "az1", kind: "availability-zone", label: "Availability Zone 1", parent: "vpc" },
    { type: "group", id: "az2", kind: "availability-zone", label: "Availability Zone 2", parent: "vpc" },
    { type: "group", id: "pub1", kind: "public-subnet", parent: "az1" },
    { type: "group", id: "pub2", kind: "public-subnet", parent: "az2" },
    { type: "group", id: "asg1", kind: "auto-scaling-group", parent: "pub1" },
    { type: "group", id: "asg2", kind: "auto-scaling-group", parent: "pub2" },
    { type: "node", id: "ec2a", icon: "ec2", name: "web-server-01", parent: "asg1" },
    { type: "edge", from: "alb", to: "ec2a" },
    { type: "node", id: "ec2b", icon: "ec2", name: "web-server-02", parent: "asg2" },
    { type: "edge", from: "alb", to: "ec2b" },
    { type: "group", id: "priv1", kind: "private-subnet", parent: "az1" },
    { type: "node", id: "rds", icon: "rds", name: "app-db", parent: "priv1" },
    { type: "edge", from: "ec2a", to: "rds", label: "SQL", step: 3 },
    { type: "edge", from: "ec2b", to: "rds" },
    {
      type: "note",
      id: "note1",
      text: "RDSはマルチAZ構成を推奨\n（デモ用の注釈ボックス）",
      attachTo: "rds",
    },
  ],
  steps: [
    "ユーザーがRoute 53でドメイン名を解決する",
    "CloudFront経由でALBにHTTPSリクエストが届く",
    "EC2のアプリケーションがRDSに読み書きする",
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDemo(): Promise<void> {
  setStreaming(true);
  const all = DEMO_SPEC.elements;
  for (let i = 1; i <= all.length; i++) {
    // ストリーミングを模倣: 先頭 i 件をstrictバリデーションして描画
    renderSpec(DEMO_SPEC.title, sanitizeElements(all.slice(0, i), true));
    await sleep(300);
  }
  setStreaming(false);
  renderSpec(
    DEMO_SPEC.title,
    sanitizeElements(all, false),
    sanitizeSteps(DEMO_SPEC.steps),
  );
  showWarnings([]);
}

// ---- 起動 ----
const isDemo =
  new URLSearchParams(location.search).get("demo") === "1" ||
  location.protocol === "file:";

async function start(): Promise<void> {
  if (isDemo) {
    void runDemo();
    return;
  }
  try {
    // ハンドラはすべて登録済み（connect 前に登録しないと通知を取りこぼす）
    await app.connect();
    connected = true;
    applyTheme(app.getHostContext()?.theme);
  } catch (err) {
    console.warn("MCPホストに接続できませんでした:", err);
  }
}

void start();
