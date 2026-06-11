// 自動レイアウトエンジン（左→右フロー）。
// 1. parent による包含ツリーを構築（前方参照・未到達parent・循環はルート扱いでクラッシュしない）
// 2. edge の from→to を DAG とみなし最長経路で列番号を計算（サイクルは打ち切り）
// 3. 各コンテナは直下の子を列順に横配置、同列は縦積み。グループ枠は子を内包して自動拡大
import {
  GROUP_STYLES,
  type DiagramElement,
  type EdgeElement,
  type GroupElement,
  type GroupStyle,
  type NodeElement,
  type NoteElement,
} from "../shared/diagram-spec";
import { iconDataUri, resolveIcon, type ResolvedIcon } from "./icons";

export const ICON_SIZE = 64;
const NODE_LABEL_MAX_W = 112;
const NOTE_MAX_W = 160;
const NODE_MIN_W = 84;
const LINE_H = 14;
const H_GAP = 56; // 列間（接続線が通る余白）
const V_GAP = 28; // 同列の縦間隔（兄弟最低16px以上）
const GROUP_PAD = 16; // グループ内バッファ（公式ルール8px以上）
const GROUP_HEADER = 40; // グループアイコン24px + 余白
const GROUP_PAD_BOTTOM = 16;
const MIN_GROUP_W = 140;
const MIN_GROUP_H = 90;
const ROOT_MARGIN = 24;
const LEGEND_LINE_H = 20;

const FONT_LABEL = "12px Arial, sans-serif";
const FONT_NAME = "11px Arial, sans-serif";

let measureCtx: CanvasRenderingContext2D | null = null;
export function textWidth(text: string, font: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return text.length * 7;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function ellipsize(text: string, maxW: number, font: string): string {
  if (textWidth(text, font) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textWidth(t + "…", font) > maxW) t = t.slice(0, -1);
  return t + "…";
}

/** 単語折返しで最大 maxLines 行に。あふれは末尾省略 */
function wrapLabel(text: string, maxW: number, font: string, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(cand, font) > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  lines.push(cur);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(" ");
    lines.length = maxLines - 1;
    lines.push(ellipsize(rest, maxW, font));
  }
  return lines.map((l) => ellipsize(l, maxW, font));
}

/** 注釈テキストを行折返し（明示改行も尊重、行数上限8） */
function wrapNote(text: string, maxW: number, font: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const lines = wrapLabel(para.trim(), maxW, font, 8);
    out.push(...(lines.length > 0 ? lines : [""]));
  }
  return out.slice(0, 8);
}

// ---- レイアウト結果型 ----

export interface NodeLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  icon: ResolvedIcon;
  /** サービス名ラベル（折返し済み、最大2行） */
  labelLines: string[];
  /** リソース固有名（グレー小文字）。なければ null */
  nameText: string | null;
  /** 番号コールアウト */
  step: number | null;
}

export interface GroupLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  style: GroupStyle;
  iconUri: string | null;
  depth: number;
}

export interface NoteLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

export interface EdgeLayout {
  key: string;
  points: Array<{ x: number; y: number }>;
  label: string | null;
  direction: "forward" | "both" | "none";
  step: number | null;
  labelX: number;
  labelY: number;
}

export interface LegendLayout {
  x: number;
  y: number;
  entries: Array<{ n: number; text: string }>;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: NodeLayout[];
  groups: GroupLayout[];
  notes: NoteLayout[];
  edges: EdgeLayout[];
  legend: LegendLayout | null;
}

// ---- 内部ツリー ----

interface BaseItem {
  id: string;
  parentId: string | undefined;
  parentItem: GroupItem | null;
  w: number;
  h: number;
  relX: number;
  relY: number;
  absX: number;
  absY: number;
  order: number;
}
interface NodeItem extends BaseItem {
  type: "node";
  el: NodeElement;
  icon: ResolvedIcon;
  labelLines: string[];
  nameText: string | null;
}
interface GroupItem extends BaseItem {
  type: "group";
  el: GroupElement;
  children: Item[];
  depth: number;
}
interface NoteItem extends BaseItem {
  type: "note";
  el: NoteElement;
  lines: string[];
}
type Item = NodeItem | GroupItem | NoteItem;

function computeColumns(allIds: Set<string>, edges: EdgeElement[]): Map<string, number> {
  // DAGの頂点はエッジの端点のみ。エッジに関与しない要素に列0を与えると
  // グループの実効列（子の最小列）を常に0へ引きずってしまうため
  const ids = new Set<string>();
  for (const e of edges) {
    if (allIds.has(e.from) && allIds.has(e.to) && e.from !== e.to) {
      ids.add(e.from);
      ids.add(e.to);
    }
  }
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    adj.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const col = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) {
    if (indeg.get(id) === 0) {
      col.set(id, 0);
      queue.push(id);
    }
  }
  // Kahn法 + 最長経路。サイクル内の頂点はキューに入らず打ち切り（col未設定=0扱い）
  while (queue.length > 0) {
    const v = queue.shift()!;
    const cv = col.get(v) ?? 0;
    for (const w of adj.get(v) ?? []) {
      col.set(w, Math.max(col.get(w) ?? 0, cv + 1));
      indeg.set(w, (indeg.get(w) ?? 1) - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }
  return col;
}

export function layoutDiagram(
  elements: DiagramElement[],
  steps?: string[],
): DiagramLayout {
  const itemById = new Map<string, Item>();
  const edges: EdgeElement[] = [];
  let order = 0;

  for (const el of elements) {
    if (el.type === "edge") {
      edges.push(el);
      continue;
    }
    if (itemById.has(el.id)) continue;
    const base: BaseItem = {
      id: el.id,
      parentId: el.parent,
      parentItem: null,
      w: 0,
      h: 0,
      relX: 0,
      relY: 0,
      absX: 0,
      absY: 0,
      order: order++,
    };
    if (el.type === "node") {
      const icon = resolveIcon(el.icon);
      itemById.set(el.id, {
        ...base,
        type: "node",
        el,
        icon,
        labelLines: wrapLabel(icon.name, NODE_LABEL_MAX_W, FONT_LABEL),
        nameText: el.name ? ellipsize(el.name, NODE_LABEL_MAX_W, FONT_NAME) : null,
      });
    } else if (el.type === "group") {
      itemById.set(el.id, { ...base, type: "group", el, children: [], depth: 0 });
    } else {
      itemById.set(el.id, {
        ...base,
        type: "note",
        el,
        lines: wrapNote(el.text, NOTE_MAX_W, FONT_NAME),
      });
    }
  }

  // 包含ツリー構築。parent が存在しない/グループでない/循環する場合はルート扱い
  const roots: Item[] = [];
  for (const item of itemById.values()) {
    const parent = item.parentId ? itemById.get(item.parentId) : undefined;
    let attached = false;
    if (parent && parent.type === "group" && parent !== item) {
      let cycle = false;
      let walk: GroupItem | null = parent;
      while (walk) {
        if (walk === item) {
          cycle = true;
          break;
        }
        walk = walk.parentItem;
      }
      if (!cycle) {
        item.parentItem = parent;
        parent.children.push(item);
        attached = true;
      }
    }
    if (!attached) roots.push(item);
  }
  // children を出現順に整列
  for (const item of itemById.values()) {
    if (item.type === "group") item.children.sort((a, b) => a.order - b.order);
  }
  roots.sort((a, b) => a.order - b.order);

  // 列番号（グローバル）
  const col = computeColumns(new Set(itemById.keys()), edges);
  const effColCache = new Map<string, number>();
  function effCol(item: Item): number {
    const hit = effColCache.get(item.id);
    if (hit !== undefined) return hit;
    effColCache.set(item.id, 0); // 再帰保険
    // note は attachTo の対象と同じ列に寄せる
    if (item.type === "note" && item.el.attachTo) {
      const target = itemById.get(item.el.attachTo);
      if (target && target !== item) {
        const v = effCol(target);
        effColCache.set(item.id, v);
        return v;
      }
    }
    const candidates: number[] = [];
    const own = col.get(item.id);
    if (own !== undefined) candidates.push(own);
    if (item.type === "group") {
      for (const c of item.children) candidates.push(effCol(c));
    }
    const v = candidates.length > 0 ? Math.min(...candidates) : 0;
    effColCache.set(item.id, v);
    return v;
  }

  // 子要素群を列順に配置し、コンテンツサイズを返す（rel は原点0,0基準）
  function layoutChildren(children: Item[]): { w: number; h: number } {
    if (children.length === 0) return { w: 0, h: 0 };
    const buckets = new Map<number, Item[]>();
    for (const c of children) {
      const k = effCol(c);
      const arr = buckets.get(k);
      if (arr) arr.push(c);
      else buckets.set(k, [c]);
    }
    const colKeys = [...buckets.keys()].sort((a, b) => a - b);
    const colW: number[] = [];
    const colH: number[] = [];
    for (const k of colKeys) {
      const arr = buckets.get(k)!;
      colW.push(Math.max(...arr.map((c) => c.w)));
      colH.push(arr.reduce((s, c) => s + c.h, 0) + (arr.length - 1) * V_GAP);
    }
    const contentH = Math.max(...colH);
    let x = 0;
    colKeys.forEach((k, i) => {
      const arr = buckets.get(k)!;
      let y = (contentH - colH[i]) / 2;
      for (const c of arr) {
        c.relX = x + (colW[i] - c.w) / 2;
        c.relY = y;
        y += c.h + V_GAP;
      }
      x += colW[i] + H_GAP;
    });
    return { w: x - H_GAP, h: contentH };
  }

  function sizeItem(item: Item): void {
    if (item.type === "node") {
      const widths = [
        NODE_MIN_W,
        ICON_SIZE,
        ...item.labelLines.map((l) => textWidth(l, FONT_LABEL) + 8),
      ];
      if (item.nameText) widths.push(textWidth(item.nameText, FONT_NAME) + 8);
      item.w = Math.ceil(Math.max(...widths));
      item.h =
        ICON_SIZE + 6 + item.labelLines.length * LINE_H + (item.nameText ? LINE_H : 0);
      return;
    }
    if (item.type === "note") {
      const maxLine = Math.max(0, ...item.lines.map((l) => textWidth(l, FONT_NAME)));
      item.w = Math.ceil(Math.max(64, maxLine + 16));
      item.h = item.lines.length * LINE_H + 12;
      return;
    }
    for (const c of item.children) sizeItem(c);
    const content = layoutChildren(item.children);
    const style = GROUP_STYLES[item.el.kind] ?? GROUP_STYLES.generic;
    const label = item.el.label ?? style.label;
    const headerW = (style.iconId ? 32 : 10) + textWidth(label, FONT_LABEL) + 12;
    const innerW = content.w;
    const innerH = content.h;
    item.w = Math.ceil(Math.max(MIN_GROUP_W, innerW + GROUP_PAD * 2, headerW));
    item.h = Math.ceil(Math.max(MIN_GROUP_H, innerH + GROUP_HEADER + GROUP_PAD_BOTTOM));
    // パディング分と余剰の中央寄せオフセットを子の rel に反映
    const offX = innerW > 0 ? (item.w - innerW) / 2 : 0;
    const offY =
      innerH > 0
        ? GROUP_HEADER + (item.h - GROUP_HEADER - GROUP_PAD_BOTTOM - innerH) / 2
        : 0;
    for (const c of item.children) {
      c.relX += offX;
      c.relY += offY;
    }
  }

  for (const r of roots) sizeItem(r);
  const rootContent = layoutChildren(roots);
  const contentW = Math.ceil(rootContent.w + ROOT_MARGIN * 2);
  let height = Math.max(160, Math.ceil(rootContent.h + ROOT_MARGIN * 2));

  // 番号コールアウト凡例（図の下に「① …」リスト）
  let legend: LegendLayout | null = null;
  const legendEntries = (steps ?? [])
    .map((text, i) => ({ n: i + 1, text }))
    .filter((e) => typeof e.text === "string" && e.text.length > 0);
  let legendW = 0;
  if (legendEntries.length > 0) {
    legend = { x: ROOT_MARGIN, y: height, entries: legendEntries };
    legendW = Math.ceil(
      Math.max(...legendEntries.map((e) => textWidth(e.text, FONT_LABEL))) + 28 + ROOT_MARGIN * 2,
    );
    height += legendEntries.length * LEGEND_LINE_H + ROOT_MARGIN;
  }
  const width = Math.max(280, contentW, legendW);

  // 絶対座標 + グループ深さ
  function absPass(item: Item, px: number, py: number, depth: number): void {
    item.absX = px + item.relX;
    item.absY = py + item.relY;
    if (item.type === "group") {
      item.depth = depth;
      for (const c of item.children) absPass(c, item.absX, item.absY, depth + 1);
    }
  }
  for (const r of roots) absPass(r, ROOT_MARGIN, ROOT_MARGIN, 0);

  // ---- 接続線ルーティング（直交、AWS公式ルール: 黒1.25px・直線と直角のみ） ----
  interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  function anchorBox(item: Item): Box {
    if (item.type === "node") {
      // ノードはアイコン枠（64px）に接続する
      return {
        x: item.absX + (item.w - ICON_SIZE) / 2,
        y: item.absY,
        w: ICON_SIZE,
        h: ICON_SIZE,
      };
    }
    return { x: item.absX, y: item.absY, w: item.w, h: item.h };
  }

  function route(a: Box, b: Box): Array<{ x: number; y: number }> {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    const sx = a.x + a.w;
    if (b.x >= sx + 12) {
      // 通常の左→右
      if (Math.abs(ay - by) < 6) {
        // 同一行は素直に水平線
        return [
          { x: sx, y: ay },
          { x: b.x, y: ay },
        ];
      }
      const mx = (sx + b.x) / 2;
      return [
        { x: sx, y: ay },
        { x: mx, y: ay },
        { x: mx, y: by },
        { x: b.x, y: by },
      ];
    }
    // 逆方向/重なり: 下を迂回する直交ループ
    const detourY = Math.max(a.y + a.h, b.y + b.h) + 24;
    return [
      { x: sx, y: ay },
      { x: sx + 16, y: ay },
      { x: sx + 16, y: detourY },
      { x: b.x - 16, y: detourY },
      { x: b.x - 16, y: by },
      { x: b.x, y: by },
    ];
  }

  const edgeLayouts: EdgeLayout[] = [];
  edges.forEach((e, i) => {
    const from = itemById.get(e.from);
    const to = itemById.get(e.to);
    if (!from || !to || from === to) return;
    const points = route(anchorBox(from), anchorBox(to));
    // ラベル位置: 最長の水平セグメントの中点
    let best = 0;
    let bestLen = -1;
    for (let s = 0; s < points.length - 1; s++) {
      if (points[s].y === points[s + 1].y) {
        const len = Math.abs(points[s + 1].x - points[s].x);
        if (len > bestLen) {
          bestLen = len;
          best = s;
        }
      }
    }
    const labelX = (points[best].x + points[best + 1].x) / 2;
    const labelY = (points[best].y + points[best + 1].y) / 2;
    edgeLayouts.push({
      key: e.id ?? `${e.from}->${e.to}#${i}`,
      points,
      label: e.label ?? null,
      direction: e.direction ?? "forward",
      step: typeof e.step === "number" && e.step >= 1 ? Math.floor(e.step) : null,
      labelX,
      labelY,
    });
  });

  const nodes: NodeLayout[] = [];
  const groups: GroupLayout[] = [];
  const notes: NoteLayout[] = [];
  for (const item of itemById.values()) {
    if (item.type === "node") {
      nodes.push({
        id: item.id,
        x: item.absX,
        y: item.absY,
        w: item.w,
        h: item.h,
        icon: item.icon,
        labelLines: item.labelLines,
        nameText: item.nameText,
        step:
          typeof item.el.step === "number" && item.el.step >= 1
            ? Math.floor(item.el.step)
            : null,
      });
    } else if (item.type === "group") {
      const style = GROUP_STYLES[item.el.kind] ?? GROUP_STYLES.generic;
      groups.push({
        id: item.id,
        x: item.absX,
        y: item.absY,
        w: item.w,
        h: item.h,
        label: item.el.label ?? style.label,
        style,
        iconUri: style.iconId ? iconDataUri(style.iconId) : null,
        depth: item.depth,
      });
    } else {
      notes.push({
        id: item.id,
        x: item.absX,
        y: item.absY,
        w: item.w,
        h: item.h,
        lines: item.lines,
      });
    }
  }
  groups.sort((a, b) => a.depth - b.depth);

  return { width, height, nodes, groups, notes, edges: edgeLayouts, legend };
}
