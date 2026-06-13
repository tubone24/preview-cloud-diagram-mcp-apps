// 自動レイアウトエンジン（左→右フロー）。
// 1. parent による包含ツリーを構築（前方参照・未到達parent・循環はルート扱いでクラッシュしない）
// 2. コンテナ単位で「兄弟DAG」（エッジ端点をそのコンテナ直下の子へ射影）を Kahn法＋最長経路で列割当。
//    宣言順（elements の並び＝流れの順）をタイブレークに使い、エッジの向きと矛盾したらエッジ優先
// 3. 各コンテナは直下の子を列順に横配置、同列は縦積み。グループ枠は子を内包して自動拡大
// 4. 接続線は直交ルーティング。配置済みボックスとのAABB交差を避けて列間/行間ガターを通し、
//    同一チャネルを通る線はオフセットして並走。ラベルは白背景＋ラベル同士の重なり回避
import {
  GROUP_STYLES,
  type DiagramElement,
  type EdgeElement,
  type GroupElement,
  type GroupStyle,
  type NodeElement,
  type NoteElement,
  type Provider,
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
const C4_LABEL_MAX_W = 140;
const FONT_LABEL_BOLD = "bold 12px Arial, sans-serif";
const FONT_DESC = "11px Arial, sans-serif";

// 同種グループ同士のエッジ（例: AZ間レプリケーション、サブネット間通信）は
// 並列構造とみなし、列の前後関係の制約にしない（縦に揃えて積む）
const PARALLEL_GROUP_KINDS = new Set<string>([
  // AWS
  "availability-zone",
  "public-subnet",
  "private-subnet",
  "security-group",
  "auto-scaling-group",
  // Azure
  "azure-subnet",
  "azure-availability-zone",
  // GCP
  "gcp-zone",
  "gcp-region",
  "gcp-subnet",
]);

let measureCtx: CanvasRenderingContext2D | null = null;
export function textWidth(text: string, font: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return text.length * 7;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export function ellipsize(text: string, maxW: number, font: string): string {
  if (textWidth(text, font) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textWidth(t + "…", font) > maxW) t = t.slice(0, -1);
  return t + "…";
}

/** 単語折返しで最大 maxLines 行に。あふれは末尾省略 */
export function wrapLabel(text: string, maxW: number, font: string, maxLines = 2): string[] {
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
  /** C4 tech label (e.g. "[Spring Boot]"). null if not C4 */
  techText: string | null;
  /** C4 description lines. Empty array if not C4 */
  descLines: string[];
  /** Whether this node uses C4 3-layer rendering */
  c4: boolean;
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
  style: "solid" | "dashed";
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
  techText: string | null;
  descLines: string[];
  c4: boolean;
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

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}

export function layoutDiagram(
  elements: DiagramElement[],
  steps?: string[],
  provider: Provider = "aws",
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
      const icon = resolveIcon(el.icon, provider);
      const c4 = !!(el.tech || el.description);
      const labelLines = c4
        ? wrapLabel(el.name ?? icon.name, C4_LABEL_MAX_W, FONT_LABEL_BOLD)
        : wrapLabel(icon.name, NODE_LABEL_MAX_W, FONT_LABEL);
      const techText = c4 && el.tech ? ellipsize("[" + el.tech + "]", C4_LABEL_MAX_W, FONT_DESC) : null;
      const descLines = c4 && el.description
        ? wrapLabel(el.description, C4_LABEL_MAX_W, FONT_DESC, 4)
        : [];
      const nameText = c4 ? null : (el.name ? ellipsize(el.name, NODE_LABEL_MAX_W, FONT_NAME) : null);
      itemById.set(el.id, {
        ...base,
        type: "node",
        el,
        icon,
        labelLines,
        nameText,
        techText,
        descLines,
        c4,
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
  // children を出現順（宣言順）に整列
  for (const item of itemById.values()) {
    if (item.type === "group") item.children.sort((a, b) => a.order - b.order);
  }
  roots.sort((a, b) => a.order - b.order);

  /** item を container 直下の子（祖先）へ射影する。container の子孫でなければ null */
  function repIn(container: GroupItem | null, item: Item): Item | null {
    let cur: Item | null = item;
    while (cur && cur.parentItem !== container) cur = cur.parentItem;
    return cur;
  }

  // ---- 列割当（コンテナ単位の兄弟DAG＋宣言順タイブレーク） ----
  function assignColumns(container: GroupItem | null, children: Item[]): Map<Item, number> {
    const col = new Map<Item, number>();
    if (children.length === 0) return col;
    const childSet = new Set(children);

    // エッジ端点をこのコンテナ直下の子へ射影して兄弟DAGを作る
    const adj = new Map<Item, Item[]>();
    const indeg = new Map<Item, number>();
    const verts = new Set<Item>();
    const seenPair = new Set<string>();
    for (const e of edges) {
      const fi = itemById.get(e.from);
      const ti = itemById.get(e.to);
      if (!fi || !ti || fi === ti) continue;
      const a = repIn(container, fi);
      const b = repIn(container, ti);
      if (!a || !b || a === b || !childSet.has(a) || !childSet.has(b)) continue;
      // 同種の並列グループ（AZ/サブネット等）間のエッジは列制約にしない
      if (
        a.type === "group" &&
        b.type === "group" &&
        a.el.kind === b.el.kind &&
        PARALLEL_GROUP_KINDS.has(a.el.kind)
      ) {
        continue;
      }
      const pair = `${a.id} ${b.id}`;
      if (seenPair.has(pair)) continue;
      seenPair.add(pair);
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push(b);
      indeg.set(b, (indeg.get(b) ?? 0) + 1);
      verts.add(a);
      verts.add(b);
    }

    // Kahn法 + 最長経路。サイクル内の頂点はキューに入らず打ち切り（後段の宣言順フォールバック）
    const queue: Item[] = [];
    for (const v of verts) {
      if ((indeg.get(v) ?? 0) === 0) {
        col.set(v, 0);
        queue.push(v);
      }
    }
    const remaining = new Map(indeg);
    while (queue.length > 0) {
      const v = queue.shift()!;
      const cv = col.get(v) ?? 0;
      for (const w of adj.get(v) ?? []) {
        col.set(w, Math.max(col.get(w) ?? 0, cv + 1));
        const d = (remaining.get(w) ?? 1) - 1;
        remaining.set(w, d);
        if (d === 0) queue.push(w);
      }
    }

    // 宣言順タイブレーク(a): 入次数0の頂点が複数あるとき、先頭宣言だけを列0に置き、
    // それ以外の起点は自分の到達先の直前列まで右へ寄せる
    const sources = [...verts]
      .filter((v) => (indeg.get(v) ?? 0) === 0)
      .sort((a, b) => a.order - b.order);
    for (let i = 1; i < sources.length; i++) {
      const s = sources[i];
      const succ = adj.get(s) ?? [];
      if (succ.length === 0) continue;
      const target = Math.min(...succ.map((w) => col.get(w) ?? 0)) - 1;
      if (target > (col.get(s) ?? 0)) col.set(s, target);
    }

    // 宣言順タイブレーク(b): エッジ無関与（とサイクル打ち切り）の子は
    // 同一コンテナ内で直前に宣言された子の隣の列へ。note の attachTo は対象に寄せる
    let prevCol: number | null = null;
    for (const c of children) {
      if (col.has(c)) {
        prevCol = col.get(c)!;
        continue;
      }
      let v: number | null = null;
      if (c.type === "note" && c.el.attachTo) {
        const t = itemById.get(c.el.attachTo);
        if (t && t !== c) {
          const r = repIn(container, t);
          if (r && r !== c && childSet.has(r) && col.has(r)) {
            // 対象自身が兄弟なら同じ列（縦に隣接）、グループ内部なら右隣の列
            v = r === t ? col.get(r)! : col.get(r)! + 1;
          }
        }
      }
      if (v === null) v = prevCol === null ? 0 : prevCol + 1;
      col.set(c, v);
      prevCol = v;
    }
    return col;
  }

  // 子要素群を列順に配置し、コンテンツサイズを返す（rel は原点0,0基準）
  function layoutChildren(
    container: GroupItem | null,
    children: Item[],
  ): { w: number; h: number } {
    if (children.length === 0) return { w: 0, h: 0 };
    const colOf = assignColumns(container, children);
    const buckets = new Map<number, Item[]>();
    for (const c of children) {
      const k = colOf.get(c) ?? 0;
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
    // 列間ギャップ: 隣接列間を通るラベル付きエッジは、ラベルが線やアイコンを
    // 覆い隠さないようガターをラベル幅分だけ広げる
    const gapAfter: number[] = new Array(Math.max(0, colKeys.length - 1)).fill(H_GAP);
    const keyIndex = new Map<number, number>(colKeys.map((k, i) => [k, i]));
    for (const e of edges) {
      const labelW = e.label ? textWidth(e.label, FONT_NAME) + 8 : 0;
      const badgeW = typeof e.step === "number" && e.step >= 1 ? (e.label ? 28 : 18) : 0;
      const need = labelW + badgeW;
      if (need === 0) continue;
      const fi = itemById.get(e.from);
      const ti = itemById.get(e.to);
      if (!fi || !ti || fi === ti) continue;
      const a = repIn(container, fi);
      const b = repIn(container, ti);
      if (!a || !b || a === b || !colOf.has(a) || !colOf.has(b)) continue;
      const ia = keyIndex.get(colOf.get(a)!);
      const ib = keyIndex.get(colOf.get(b)!);
      if (ia === undefined || ib === undefined || Math.abs(ia - ib) !== 1) continue;
      const g = Math.min(ia, ib);
      gapAfter[g] = Math.max(gapAfter[g], need + 24);
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
      x += colW[i] + (i < colKeys.length - 1 ? gapAfter[i] : 0);
    });
    return { w: x, h: contentH };
  }

  function sizeItem(item: Item): void {
    if (item.type === "node") {
      const labelFont = item.c4 ? FONT_LABEL_BOLD : FONT_LABEL;
      const widths = [
        NODE_MIN_W,
        ICON_SIZE,
        ...item.labelLines.map((l) => textWidth(l, labelFont) + 8),
      ];
      if (item.techText) widths.push(textWidth(item.techText, FONT_DESC) + 8);
      for (const dl of item.descLines) widths.push(textWidth(dl, FONT_DESC) + 8);
      if (item.nameText) widths.push(textWidth(item.nameText, FONT_NAME) + 8);
      item.w = Math.ceil(Math.max(...widths));
      item.h =
        ICON_SIZE + 6 +
        item.labelLines.length * LINE_H +
        (item.techText ? LINE_H : 0) +
        (item.descLines.length > 0 ? item.descLines.length * LINE_H + 4 : 0) +
        (item.nameText ? LINE_H : 0);
      return;
    }
    if (item.type === "note") {
      const maxLine = Math.max(0, ...item.lines.map((l) => textWidth(l, FONT_NAME)));
      item.w = Math.ceil(Math.max(64, maxLine + 16));
      item.h = item.lines.length * LINE_H + 12;
      return;
    }
    for (const c of item.children) sizeItem(c);
    const content = layoutChildren(item, item.children);
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
  const rootContent = layoutChildren(null, roots);
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
  let width = Math.max(280, contentW, legendW);

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
  function fullBox(item: Item): Box {
    return { x: item.absX, y: item.absY, w: item.w, h: item.h };
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
    return fullBox(item);
  }
  function ancestorsOf(item: Item): Set<Item> {
    const s = new Set<Item>();
    let cur = item.parentItem;
    while (cur) {
      s.add(cur);
      cur = cur.parentItem;
    }
    return s;
  }

  const OBSTACLE_PAD = 3;
  function segHitsBox(a: Pt, b: Pt, box: Box): boolean {
    const lx = Math.min(a.x, b.x);
    const hx = Math.max(a.x, b.x);
    const ly = Math.min(a.y, b.y);
    const hy = Math.max(a.y, b.y);
    return (
      hx > box.x - OBSTACLE_PAD &&
      lx < box.x + box.w + OBSTACLE_PAD &&
      hy > box.y - OBSTACLE_PAD &&
      ly < box.y + box.h + OBSTACLE_PAD
    );
  }
  function pathClear(pts: Pt[], obstacles: Box[]): boolean {
    for (let i = 0; i < pts.length - 1; i++) {
      for (const ob of obstacles) {
        if (segHitsBox(pts[i], pts[i + 1], ob)) return false;
      }
    }
    return true;
  }

  // 使用済みチャネル。同一直線上の完全重なり（4px未満の並走）を弾いてオフセットさせる
  const usedV: Array<{ x: number; y0: number; y1: number }> = [];
  const usedH: Array<{ y: number; x0: number; x1: number }> = [];
  function channelConflict(pts: Pt[]): boolean {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      if (p.x === q.x && p.y !== q.y) {
        const y0 = Math.min(p.y, q.y);
        const y1 = Math.max(p.y, q.y);
        for (const u of usedV) {
          if (Math.abs(u.x - p.x) < 4 && Math.min(y1, u.y1) - Math.max(y0, u.y0) > 2) {
            return true;
          }
        }
      } else if (p.y === q.y && p.x !== q.x) {
        const x0 = Math.min(p.x, q.x);
        const x1 = Math.max(p.x, q.x);
        for (const u of usedH) {
          if (Math.abs(u.y - p.y) < 4 && Math.min(x1, u.x1) - Math.max(x0, u.x0) > 2) {
            return true;
          }
        }
      }
    }
    return false;
  }
  function registerPath(pts: Pt[]): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      if (p.x === q.x && p.y !== q.y) {
        usedV.push({ x: p.x, y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
      } else if (p.y === q.y && p.x !== q.x) {
        usedH.push({ y: p.y, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x) });
      }
    }
  }

  /** 区間 (lo, hi) の中央から外側へ向けて 8px 刻みで候補値を返す */
  function* spread(lo: number, hi: number): Generator<number> {
    if (hi <= lo) return;
    const mid = (lo + hi) / 2;
    yield mid;
    for (let d = 8; d <= (hi - lo) / 2; d += 8) {
      yield mid - d;
      yield mid + d;
    }
  }

  /**
   * 迂回チャネルの候補座標。基本候補（両端ボックスの外側）に加えて、
   * 各障害物の縁の少し外側（=行間/列間ガター）を候補にし、中央に近い順に試す
   */
  function detourCandidates(
    base: number[],
    obstacles: Box[],
    axis: "y" | "x",
    mid: number,
  ): number[] {
    const set = new Set<number>(base);
    for (const ob of obstacles) {
      if (axis === "y") {
        set.add(ob.y - 12);
        set.add(ob.y + ob.h + 12);
      } else {
        set.add(ob.x - 12);
        set.add(ob.x + ob.w + 12);
      }
    }
    return [...set]
      .filter((v) => v >= 8)
      .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
      .slice(0, 48);
  }

  type Side = "left" | "right" | "top" | "bottom";
  interface Pending {
    e: EdgeElement;
    idx: number;
    aB: Box;
    bB: Box;
    mode: "R" | "L" | "D" | "U" | "loop";
    aSide: Side;
    bSide: Side;
    start: Pt;
    end: Pt;
    obstacles: Box[];
  }

  const pendings: Pending[] = [];
  edges.forEach((e, i) => {
    const from = itemById.get(e.from);
    const to = itemById.get(e.to);
    if (!from || !to || from === to) return;
    const aB = anchorBox(from);
    const bB = anchorBox(to);
    let mode: Pending["mode"];
    let aSide: Side;
    let bSide: Side;
    if (bB.x >= aB.x + aB.w + 24) {
      mode = "R";
      aSide = "right";
      bSide = "left";
    } else if (aB.x >= bB.x + bB.w + 24) {
      mode = "L";
      aSide = "left";
      bSide = "right";
    } else if (bB.y >= aB.y + aB.h + 16) {
      mode = "D";
      aSide = "bottom";
      bSide = "top";
    } else if (aB.y >= bB.y + bB.h + 16) {
      mode = "U";
      aSide = "top";
      bSide = "bottom";
    } else {
      mode = "loop";
      aSide = "right";
      bSide = "left";
    }
    // 障害物 = 端点と（境界をまたぐ必要のある）祖先グループを除く全配置済みボックス
    const exclude = new Set<Item>([from, to]);
    for (const a of ancestorsOf(from)) exclude.add(a);
    for (const a of ancestorsOf(to)) exclude.add(a);
    const obstacles: Box[] = [];
    for (const it of itemById.values()) {
      if (!exclude.has(it)) obstacles.push(fullBox(it));
    }
    pendings.push({
      e,
      idx: i,
      aB,
      bB,
      mode,
      aSide,
      bSide,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      obstacles,
    });
  });

  // 同じ辺に複数エッジが付く場合は辺上で等間隔に分散（矢じりがアイコン中央へ集中しない）
  function sidePoint(b: Box, side: Side, t: number): Pt {
    switch (side) {
      case "right":
        return { x: b.x + b.w, y: b.y + b.h * t };
      case "left":
        return { x: b.x, y: b.y + b.h * t };
      case "bottom":
        return { x: b.x + b.w * t, y: b.y + b.h };
      default:
        return { x: b.x + b.w * t, y: b.y };
    }
  }
  const sideUsers = new Map<string, Array<{ p: Pending; which: "a" | "b"; key: number }>>();
  for (const p of pendings) {
    const entries: Array<[string, "a" | "b", Side, Box]> = [
      [`${p.e.from}/${p.aSide}`, "a", p.aSide, p.bB],
      [`${p.e.to}/${p.bSide}`, "b", p.bSide, p.aB],
    ];
    for (const [k, which, side, other] of entries) {
      const key =
        side === "left" || side === "right" ? other.y + other.h / 2 : other.x + other.w / 2;
      let arr = sideUsers.get(k);
      if (!arr) {
        arr = [];
        sideUsers.set(k, arr);
      }
      arr.push({ p, which, key });
    }
  }
  for (const [k, arr] of sideUsers) {
    arr.sort((u, v) => u.key - v.key || u.p.idx - v.p.idx);
    const side = k.slice(k.lastIndexOf("/") + 1) as Side;
    arr.forEach((entry, i) => {
      const t = (i + 1) / (arr.length + 1);
      const box = entry.which === "a" ? entry.p.aB : entry.p.bB;
      const pt = sidePoint(box, side, t);
      if (entry.which === "a") entry.p.start = pt;
      else entry.p.end = pt;
    });
  }

  // 各モードのルート探索: 直線 → Z字（ガター垂直/水平チャネル） → 5セグメント迂回 → 妥協Z
  function routeRight(p: Pending): Pt[] {
    const { start, end, obstacles } = p;
    if (Math.abs(start.y - end.y) < 6) {
      const yy = (start.y + end.y) / 2;
      const pts = [
        { x: start.x, y: yy },
        { x: end.x, y: yy },
      ];
      if (pathClear(pts, obstacles) && !channelConflict(pts)) return pts;
    }
    let fallback: Pt[] | null = null;
    for (const mx of spread(start.x + 8, end.x - 8)) {
      const pts = [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
      if (!pathClear(pts, obstacles)) continue;
      if (!channelConflict(pts)) return pts;
      fallback ??= pts;
    }
    const top = Math.min(p.aB.y, p.bB.y);
    const bot = Math.max(p.aB.y + p.aB.h, p.bB.y + p.bB.h);
    const cys = detourCandidates(
      [bot + 20, top - 20],
      obstacles,
      "y",
      (start.y + end.y) / 2,
    );
    for (const cy of cys) {
      for (const d of [12, 24, 36]) {
        const pts = [
          start,
          { x: start.x + d, y: start.y },
          { x: start.x + d, y: cy },
          { x: end.x - d, y: cy },
          { x: end.x - d, y: end.y },
          end,
        ];
        if (!pathClear(pts, obstacles)) continue;
        if (!channelConflict(pts)) return pts;
        fallback ??= pts;
      }
    }
    const mx = (start.x + end.x) / 2;
    return fallback ?? [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
  }

  function routeLeft(p: Pending): Pt[] {
    const { start, end, obstacles } = p;
    if (Math.abs(start.y - end.y) < 6) {
      const yy = (start.y + end.y) / 2;
      const pts = [
        { x: start.x, y: yy },
        { x: end.x, y: yy },
      ];
      if (pathClear(pts, obstacles) && !channelConflict(pts)) return pts;
    }
    let fallback: Pt[] | null = null;
    for (const mx of spread(end.x + 8, start.x - 8)) {
      const pts = [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
      if (!pathClear(pts, obstacles)) continue;
      if (!channelConflict(pts)) return pts;
      fallback ??= pts;
    }
    const top = Math.min(p.aB.y, p.bB.y);
    const bot = Math.max(p.aB.y + p.aB.h, p.bB.y + p.bB.h);
    const cys = detourCandidates(
      [bot + 20, top - 20],
      obstacles,
      "y",
      (start.y + end.y) / 2,
    );
    for (const cy of cys) {
      for (const d of [12, 24, 36]) {
        const pts = [
          start,
          { x: start.x - d, y: start.y },
          { x: start.x - d, y: cy },
          { x: end.x + d, y: cy },
          { x: end.x + d, y: end.y },
          end,
        ];
        if (!pathClear(pts, obstacles)) continue;
        if (!channelConflict(pts)) return pts;
        fallback ??= pts;
      }
    }
    const mx = (start.x + end.x) / 2;
    return fallback ?? [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
  }

  function routeVertical(p: Pending, down: boolean): Pt[] {
    const { start, end, obstacles } = p;
    if (Math.abs(start.x - end.x) < 6) {
      const xx = (start.x + end.x) / 2;
      const pts = [
        { x: xx, y: start.y },
        { x: xx, y: end.y },
      ];
      if (pathClear(pts, obstacles) && !channelConflict(pts)) return pts;
    }
    let fallback: Pt[] | null = null;
    const lo = down ? start.y + 8 : end.y + 8;
    const hi = down ? end.y - 8 : start.y - 8;
    for (const my of spread(lo, hi)) {
      const pts = [start, { x: start.x, y: my }, { x: end.x, y: my }, end];
      if (!pathClear(pts, obstacles)) continue;
      if (!channelConflict(pts)) return pts;
      fallback ??= pts;
    }
    const left = Math.min(p.aB.x, p.bB.x);
    const right = Math.max(p.aB.x + p.aB.w, p.bB.x + p.bB.w);
    const sgn = down ? 1 : -1;
    const cxs = detourCandidates(
      [right + 20, left - 20],
      obstacles,
      "x",
      (start.x + end.x) / 2,
    );
    for (const cx of cxs) {
      for (const d of [12, 24, 36]) {
        const pts = [
          start,
          { x: start.x, y: start.y + sgn * d },
          { x: cx, y: start.y + sgn * d },
          { x: cx, y: end.y - sgn * d },
          { x: end.x, y: end.y - sgn * d },
          end,
        ];
        if (!pathClear(pts, obstacles)) continue;
        if (!channelConflict(pts)) return pts;
        fallback ??= pts;
      }
    }
    const my = (start.y + end.y) / 2;
    return fallback ?? [start, { x: start.x, y: my }, { x: end.x, y: my }, end];
  }

  function routeLoop(p: Pending): Pt[] {
    const { start, end, obstacles } = p;
    let fallback: Pt[] | null = null;
    const bot = Math.max(p.aB.y + p.aB.h, p.bB.y + p.bB.h);
    for (const k of [24, 36, 48, 60, 72]) {
      for (const d of [16, 28, 40]) {
        const pts = [
          start,
          { x: start.x + d, y: start.y },
          { x: start.x + d, y: bot + k },
          { x: end.x - d, y: bot + k },
          { x: end.x - d, y: end.y },
          end,
        ];
        fallback ??= pts;
        if (!pathClear(pts, obstacles)) continue;
        if (!channelConflict(pts)) return pts;
      }
    }
    return fallback!;
  }

  // ---- ラベル配置（白背景の重なり回避: 線に沿って位置をずらす） ----
  const labelBoxes: Box[] = [];
  // ラベルが覆ってはいけないボックス（ノード・ノート）。グループ枠線への重なりは許容
  const labelObstacles: Box[] = [];
  for (const it of itemById.values()) {
    if (it.type !== "group") labelObstacles.push(fullBox(it));
  }
  function placeLabel(
    points: Pt[],
    label: string | null,
    step: number | null,
  ): { labelX: number; labelY: number } {
    // 最長の水平セグメント（なければ最長の垂直セグメント）の中点が基準
    let segI = 0;
    let segLen = -1;
    let horizontal = true;
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].y === points[i + 1].y) {
        const len = Math.abs(points[i + 1].x - points[i].x);
        if (len > segLen) {
          segLen = len;
          segI = i;
          horizontal = true;
        }
      }
    }
    if (segLen < 0) {
      for (let i = 0; i < points.length - 1; i++) {
        const len = Math.abs(points[i + 1].y - points[i].y);
        if (len > segLen) {
          segLen = len;
          segI = i;
          horizontal = false;
        }
      }
    }
    const p0 = points[segI];
    const p1 = points[Math.min(segI + 1, points.length - 1)];
    const baseX = (p0.x + p1.x) / 2;
    const baseY = (p0.y + p1.y) / 2;
    if (!label && step === null) return { labelX: baseX, labelY: baseY };

    const lw = label ? textWidth(label, FONT_NAME) + 8 : 0;
    const mkBox = (cx: number, cy: number): Box =>
      label
        ? { x: cx - lw / 2 - (step !== null ? 28 : 0), y: cy - 9, w: lw + (step !== null ? 28 : 0), h: 18 }
        : { x: cx - 9, y: cy - 9, w: 18, h: 18 };
    const hit = (b: Box, list: Box[], pad: number): boolean =>
      list.some(
        (o) =>
          b.x < o.x + o.w + pad &&
          b.x + b.w > o.x - pad &&
          b.y < o.y + o.h + pad &&
          b.y + b.h > o.y - pad,
      );
    const lo = horizontal ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
    const hi = horizontal ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
    const offsets = [0, 14, -14, 28, -28, 42, -42, 56, -56, 70, -70];
    // 1パス目: 他ラベルにもノード/ノートにも重ならない位置、2パス目: 他ラベルだけ回避
    for (const strict of [true, false]) {
      for (const off of offsets) {
        const c = (horizontal ? baseX : baseY) + off;
        if (off !== 0 && (c < lo + 8 || c > hi - 8)) continue;
        const cx = horizontal ? c : baseX;
        const cy = horizontal ? baseY : c;
        const b = mkBox(cx, cy);
        if (hit(b, labelBoxes, 2)) continue;
        if (strict && hit(b, labelObstacles, 0)) continue;
        labelBoxes.push(b);
        return { labelX: cx, labelY: cy };
      }
    }
    labelBoxes.push(mkBox(baseX, baseY));
    return { labelX: baseX, labelY: baseY };
  }

  const edgeLayouts: EdgeLayout[] = [];
  for (const p of pendings) {
    let points: Pt[];
    switch (p.mode) {
      case "R":
        points = routeRight(p);
        break;
      case "L":
        points = routeLeft(p);
        break;
      case "D":
        points = routeVertical(p, true);
        break;
      case "U":
        points = routeVertical(p, false);
        break;
      default:
        points = routeLoop(p);
    }
    registerPath(points);
    const e = p.e;
    const step = typeof e.step === "number" && e.step >= 1 ? Math.floor(e.step) : null;
    const { labelX, labelY } = placeLabel(points, e.label ?? null, step);
    edgeLayouts.push({
      key: e.id ?? `${e.from}->${e.to}#${p.idx}`,
      points,
      label: e.label ?? null,
      direction: e.direction ?? "forward",
      step,
      labelX,
      labelY,
      style: e.style ?? "solid",
    });
  }

  // 迂回ルートがコンテンツ枠の外を通る場合はキャンバスを広げる
  for (const el of edgeLayouts) {
    for (const pt of el.points) {
      width = Math.max(width, Math.ceil(pt.x) + 8);
      height = Math.max(height, Math.ceil(pt.y) + 8);
    }
  }

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
        techText: item.techText,
        descLines: item.descLines,
        c4: item.c4,
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
