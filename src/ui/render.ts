// SVGレンダラ。要素IDでDOMを永続化し、出現時はフェード＋スケールイン、
// 位置変更は transform の CSS transition でスムーズに移動させる。
import type {
  DiagramLayout,
  EdgeLayout,
  GroupLayout,
  LegendLayout,
  NodeLayout,
  NoteLayout,
} from "./layout";
import { ICON_SIZE, textWidth } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export interface SelectionInfo {
  id: string;
  kind: "node" | "group";
  /** サービス名 or グループラベル */
  serviceName: string;
  /** リソース固有名 */
  name?: string;
}

interface KeyedEl {
  g: SVGGElement;
  inner: SVGGElement;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function setImageHref(img: SVGImageElement, uri: string): void {
  img.setAttribute("href", uri);
  // Safari の canvas ラスタライズ互換のため xlink:href も併記
  img.setAttributeNS(XLINK_NS, "xlink:href", uri);
}

export class DiagramRenderer {
  readonly svg: SVGSVGElement;
  private readonly gGroups: SVGGElement;
  private readonly gEdges: SVGGElement;
  private readonly gNodes: SVGGElement;
  private readonly gNotes: SVGGElement;
  private readonly gLegend: SVGGElement;
  private readonly groupEls = new Map<string, KeyedEl>();
  private readonly nodeEls = new Map<string, KeyedEl>();
  private readonly noteEls = new Map<string, KeyedEl>();
  private readonly edgeEls = new Map<string, SVGGElement>();
  private selectedId: string | null = null;
  /** 選択変更コールバック（null = 選択解除） */
  onselect: ((sel: SelectionInfo | null) => void) | null = null;
  /** ドラッグ操作直後のクリックを無視するための判定フック */
  isDragClick: (() => boolean) | null = null;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    const defs = svgEl("defs");
    defs.innerHTML =
      '<marker id="arrow-open" viewBox="0 0 10 10" refX="8.5" refY="5"' +
      ' markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse"' +
      ' orient="auto-start-reverse">' +
      '<path d="M1.5 1.5 L8.5 5 L1.5 8.5" fill="none" stroke="#000000"' +
      ' stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</marker>";
    svg.appendChild(defs);
    this.gGroups = svgEl("g", { class: "layer-groups" });
    this.gEdges = svgEl("g", { class: "layer-edges" });
    this.gNodes = svgEl("g", { class: "layer-nodes" });
    this.gNotes = svgEl("g", { class: "layer-notes" });
    this.gLegend = svgEl("g", { class: "layer-legend" });
    // workers-types の HTMLRewriter Element と DOM の append が衝突するため appendChild を使う
    svg.appendChild(this.gGroups);
    svg.appendChild(this.gEdges);
    svg.appendChild(this.gNodes);
    svg.appendChild(this.gNotes);
    svg.appendChild(this.gLegend);
    svg.addEventListener("click", (ev) => {
      if (ev.target === svg && !this.isDragClick?.()) this.select(null, null);
    });
  }

  private select(id: string | null, info: SelectionInfo | null): void {
    if (this.selectedId === id) return;
    if (this.selectedId) {
      const prev =
        this.nodeEls.get(this.selectedId)?.g ?? this.groupEls.get(this.selectedId)?.g;
      prev?.classList.remove("selected");
    }
    this.selectedId = id;
    if (id) {
      const cur = this.nodeEls.get(id)?.g ?? this.groupEls.get(id)?.g;
      cur?.classList.add("selected");
    }
    this.onselect?.(info);
  }

  /** 新規要素の入場アニメーション（フェード＋軽いスケールイン） */
  private animateEnter(g: SVGGElement): void {
    g.classList.add("enter");
    // 強制リフロー後にクラスを外して transition を発火
    void g.getBoundingClientRect();
    requestAnimationFrame(() => g.classList.remove("enter"));
  }

  private place(el: KeyedEl, x: number, y: number): void {
    el.g.style.transform = `translate(${x}px, ${y}px)`;
  }

  render(layout: DiagramLayout): void {
    this.syncGroups(layout.groups);
    this.syncNodes(layout.nodes);
    this.syncNotes(layout.notes);
    this.syncEdges(layout.edges);
    this.syncLegend(layout.legend);
  }

  /** 番号コールアウト（黒丸＋白太字番号）を作る共通ヘルパー */
  private static stepBadge(cx: number, cy: number, n: number): SVGGElement {
    const g = svgEl("g", { class: "step-badge" });
    g.appendChild(
      svgEl("circle", {
        cx: String(cx),
        cy: String(cy),
        r: "9",
        fill: "#000000",
        stroke: "#FFFFFF",
        "stroke-width": "1",
      }),
    );
    const t = svgEl("text", {
      x: String(cx),
      y: String(cy),
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": "Arial, sans-serif",
      "font-size": "11",
      "font-weight": "bold",
      fill: "#FFFFFF",
    });
    t.textContent = String(n);
    g.appendChild(t);
    return g;
  }

  // ---- グループ ----
  private syncGroups(groups: GroupLayout[]): void {
    const seen = new Set<string>();
    for (const gl of groups) {
      seen.add(gl.id);
      let entry = this.groupEls.get(gl.id);
      if (!entry) {
        entry = this.createGroup(gl);
        this.groupEls.set(gl.id, entry);
        this.gGroups.appendChild(entry.g);
        this.place(entry, gl.x, gl.y);
        this.animateEnter(entry.g);
      } else {
        this.place(entry, gl.x, gl.y);
        // 深さ順を保つため毎回並べ直す（同一参照の appendChild は移動のみ）
        this.gGroups.appendChild(entry.g);
      }
      this.updateGroup(entry, gl);
    }
    this.removeStale(this.groupEls, seen);
  }

  private createGroup(gl: GroupLayout): KeyedEl {
    const g = svgEl("g", { class: "el group", "data-id": gl.id });
    const inner = svgEl("g", { class: "inner" });
    g.appendChild(inner);
    const frame = svgEl("rect", {
      class: "frame",
      x: "0",
      y: "0",
      fill: "none",
      "stroke-width": "1.25",
    });
    inner.appendChild(frame);
    if (gl.iconUri) {
      const img = svgEl("image", {
        class: "gicon",
        x: "0",
        y: "0",
        width: "24",
        height: "24",
      });
      setImageHref(img, gl.iconUri);
      inner.appendChild(img);
    }
    const text = svgEl("text", {
      class: "glabel",
      y: "12",
      "font-family": "Arial, sans-serif",
      "font-size": "12",
      "dominant-baseline": "central",
    });
    inner.appendChild(text);
    const hit = svgEl("rect", {
      class: "hit",
      x: "0",
      y: "0",
      height: "28",
      fill: "transparent",
    });
    inner.appendChild(hit);
    const sel = svgEl("rect", {
      class: "sel-outline",
      x: "-3",
      y: "-3",
      rx: "4",
      fill: "none",
    });
    inner.appendChild(sel);
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.isDragClick?.()) return;
      const label = text.textContent ?? gl.label;
      this.select(gl.id, { id: gl.id, kind: "group", serviceName: label });
    });
    return { g, inner };
  }

  private updateGroup(entry: KeyedEl, gl: GroupLayout): void {
    const { inner } = entry;
    const frame = inner.querySelector<SVGRectElement>(".frame")!;
    frame.style.width = `${gl.w}px`;
    frame.style.height = `${gl.h}px`;
    frame.setAttribute("width", String(gl.w));
    frame.setAttribute("height", String(gl.h));
    frame.setAttribute("stroke", gl.style.color);
    const dash =
      gl.style.border === "dashed" ? "6 4" : gl.style.border === "dotted" ? "2 3" : "";
    if (dash) frame.setAttribute("stroke-dasharray", dash);
    else frame.removeAttribute("stroke-dasharray");

    const text = inner.querySelector<SVGTextElement>(".glabel")!;
    text.textContent = gl.label;
    text.setAttribute("x", String(gl.iconUri ? 30 : 8));
    text.setAttribute("fill", gl.style.color === "#000000" ? "#000000" : gl.style.color);

    const hit = inner.querySelector<SVGRectElement>(".hit")!;
    hit.setAttribute("width", String(gl.w));
    const sel = inner.querySelector<SVGRectElement>(".sel-outline")!;
    sel.setAttribute("width", String(gl.w + 6));
    sel.setAttribute("height", String(gl.h + 6));
  }

  // ---- ノード ----
  private syncNodes(nodes: NodeLayout[]): void {
    const seen = new Set<string>();
    for (const nl of nodes) {
      seen.add(nl.id);
      let entry = this.nodeEls.get(nl.id);
      if (!entry) {
        entry = this.createNode(nl);
        this.nodeEls.set(nl.id, entry);
        this.gNodes.appendChild(entry.g);
        this.place(entry, nl.x, nl.y);
        this.animateEnter(entry.g);
      } else {
        this.place(entry, nl.x, nl.y);
      }
      this.updateNode(entry, nl);
    }
    this.removeStale(this.nodeEls, seen);
  }

  private createNode(nl: NodeLayout): KeyedEl {
    const g = svgEl("g", { class: "el node", "data-id": nl.id });
    const inner = svgEl("g", { class: "inner" });
    g.appendChild(inner);
    const iconHolder = svgEl("g", { class: "icon-holder" });
    inner.appendChild(iconHolder);
    const svc = svgEl("text", {
      class: "svc",
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "12",
      fill: "#16191F",
    });
    inner.appendChild(svc);
    const name = svgEl("text", {
      class: "rname",
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "11",
      fill: "#687078",
    });
    inner.appendChild(name);
    const hit = svgEl("rect", { class: "hit", x: "0", y: "0", fill: "transparent" });
    inner.appendChild(hit);
    const sel = svgEl("rect", {
      class: "sel-outline",
      x: "-3",
      y: "-3",
      rx: "4",
      fill: "none",
    });
    inner.appendChild(sel);
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.isDragClick?.()) return;
      this.select(nl.id, {
        id: nl.id,
        kind: "node",
        serviceName: nl.icon.name,
        name: nl.nameText ?? undefined,
      });
    });
    return { g, inner };
  }

  private updateNode(entry: KeyedEl, nl: NodeLayout): void {
    const { inner } = entry;
    const iconX = (nl.w - ICON_SIZE) / 2;
    const holder = inner.querySelector<SVGGElement>(".icon-holder")!;
    if (nl.icon.dataUri) {
      let img = holder.querySelector<SVGImageElement>("image");
      if (!img) {
        holder.innerHTML = "";
        img = svgEl("image", { width: String(ICON_SIZE), height: String(ICON_SIZE) });
        holder.appendChild(img);
      }
      img.setAttribute("x", String(iconX));
      img.setAttribute("y", "0");
      setImageHref(img, nl.icon.dataUri);
    } else if (!holder.querySelector(".fallback")) {
      // フォールバック: グレー角丸四角 + 「?」
      holder.innerHTML = "";
      const fg = svgEl("g", { class: "fallback" });
      fg.appendChild(
        svgEl("rect", {
          x: String(iconX),
          y: "0",
          width: String(ICON_SIZE),
          height: String(ICON_SIZE),
          rx: "8",
          fill: "#E9EBED",
          stroke: "#879196",
          "stroke-width": "1.25",
        }),
      );
      const q = svgEl("text", {
        x: String(iconX + ICON_SIZE / 2),
        y: String(ICON_SIZE / 2),
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "font-family": "Arial, sans-serif",
        "font-size": "28",
        fill: "#5F6B7A",
      });
      q.textContent = "?";
      fg.appendChild(q);
      holder.appendChild(fg);
    }

    const svc = inner.querySelector<SVGTextElement>(".svc")!;
    svc.setAttribute("x", String(nl.w / 2));
    svc.innerHTML = "";
    nl.labelLines.forEach((line, i) => {
      const tspan = svgEl("tspan", {
        x: String(nl.w / 2),
        y: String(ICON_SIZE + 16 + i * 14),
      });
      tspan.textContent = line;
      svc.appendChild(tspan);
    });

    const name = inner.querySelector<SVGTextElement>(".rname")!;
    if (nl.nameText) {
      name.textContent = nl.nameText;
      name.setAttribute("x", String(nl.w / 2));
      name.setAttribute("y", String(ICON_SIZE + 16 + nl.labelLines.length * 14));
      name.removeAttribute("display");
    } else {
      name.setAttribute("display", "none");
    }

    // 番号コールアウト（アイコン左上角）
    inner.querySelector(".step-badge")?.remove();
    if (nl.step !== null) {
      inner.appendChild(DiagramRenderer.stepBadge(iconX - 2, 4, nl.step));
    }

    const hit = inner.querySelector<SVGRectElement>(".hit")!;
    hit.setAttribute("width", String(nl.w));
    hit.setAttribute("height", String(nl.h));
    const sel = inner.querySelector<SVGRectElement>(".sel-outline")!;
    sel.setAttribute("width", String(nl.w + 6));
    sel.setAttribute("height", String(nl.h + 6));
  }

  // ---- 注釈ボックス ----
  private syncNotes(notes: NoteLayout[]): void {
    const seen = new Set<string>();
    for (const nl of notes) {
      seen.add(nl.id);
      let entry = this.noteEls.get(nl.id);
      if (!entry) {
        const g = svgEl("g", { class: "el note-box", "data-id": nl.id });
        const inner = svgEl("g", { class: "inner" });
        g.appendChild(inner);
        inner.appendChild(
          svgEl("rect", {
            class: "note-bg",
            x: "0",
            y: "0",
            rx: "3",
            fill: "#FFF9DB",
            stroke: "#B5A04A",
            "stroke-width": "0.75",
          }),
        );
        inner.appendChild(
          svgEl("text", {
            class: "note-text",
            "font-family": "Arial, sans-serif",
            "font-size": "11",
            fill: "#16191F",
          }),
        );
        entry = { g, inner };
        this.noteEls.set(nl.id, entry);
        this.gNotes.appendChild(g);
        this.place(entry, nl.x, nl.y);
        this.animateEnter(g);
      } else {
        this.place(entry, nl.x, nl.y);
      }
      const bg = entry.inner.querySelector<SVGRectElement>(".note-bg")!;
      bg.setAttribute("width", String(nl.w));
      bg.setAttribute("height", String(nl.h));
      const text = entry.inner.querySelector<SVGTextElement>(".note-text")!;
      text.innerHTML = "";
      nl.lines.forEach((line, i) => {
        const tspan = svgEl("tspan", { x: "8", y: String(16 + i * 14) });
        tspan.textContent = line;
        text.appendChild(tspan);
      });
    }
    this.removeStale(this.noteEls, seen);
  }

  // ---- 番号コールアウト凡例（① …） ----
  private syncLegend(legend: LegendLayout | null): void {
    this.gLegend.innerHTML = "";
    if (!legend) return;
    legend.entries.forEach((e, i) => {
      const cy = legend.y + i * 20 + 10;
      this.gLegend.appendChild(DiagramRenderer.stepBadge(legend.x + 9, cy, e.n));
      const t = svgEl("text", {
        x: String(legend.x + 26),
        y: String(cy),
        "dominant-baseline": "central",
        "font-family": "Arial, sans-serif",
        "font-size": "12",
        fill: "#16191F",
      });
      t.textContent = e.text;
      this.gLegend.appendChild(t);
    });
  }

  // ---- 接続線 ----
  private syncEdges(edges: EdgeLayout[]): void {
    const seen = new Set<string>();
    for (const el of edges) {
      seen.add(el.key);
      let g = this.edgeEls.get(el.key);
      if (!g) {
        g = svgEl("g", { class: "el edge" });
        const path = svgEl("path", {
          fill: "none",
          stroke: "#000000",
          "stroke-width": "1.25",
        });
        g.appendChild(path);
        this.gEdges.appendChild(g);
        this.edgeEls.set(el.key, g);
        this.animateEnter(g);
      }
      const path = g.querySelector("path")!;
      const d = el.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
        .join(" ");
      path.setAttribute("d", d);
      if (el.direction === "forward" || el.direction === "both") {
        path.setAttribute("marker-end", "url(#arrow-open)");
      } else {
        path.removeAttribute("marker-end");
      }
      if (el.direction === "both") path.setAttribute("marker-start", "url(#arrow-open)");
      else path.removeAttribute("marker-start");

      // 番号コールアウト（線の中点）。ラベル併用時はバッジをラベル左に置く
      g.querySelector(".step-badge")?.remove();
      if (el.step !== null) {
        const lw = el.label ? textWidth(el.label, "11px Arial, sans-serif") + 8 : 0;
        const badgeX = el.label ? el.labelX - lw / 2 - 14 : el.labelX;
        g.appendChild(DiagramRenderer.stepBadge(badgeX, el.labelY, el.step));
      }

      let labelG = g.querySelector<SVGGElement>(".elabel");
      if (el.label) {
        if (!labelG) {
          labelG = svgEl("g", { class: "elabel" });
          labelG.appendChild(svgEl("rect", { fill: "#FFFFFF" }));
          const t = svgEl("text", {
            "text-anchor": "middle",
            "font-family": "Arial, sans-serif",
            "font-size": "11",
            fill: "#16191F",
            "dominant-baseline": "central",
          });
          labelG.appendChild(t);
          g.appendChild(labelG);
        }
        const t = labelG.querySelector("text")!;
        t.textContent = el.label;
        t.setAttribute("x", String(el.labelX));
        t.setAttribute("y", String(el.labelY));
        const w = textWidth(el.label, "11px Arial, sans-serif") + 8;
        const rect = labelG.querySelector("rect")!;
        rect.setAttribute("x", String(el.labelX - w / 2));
        rect.setAttribute("y", String(el.labelY - 8));
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", "16");
      } else if (labelG) {
        labelG.remove();
      }
    }
    // 消えた線を除去
    for (const [key, g] of this.edgeEls) {
      if (!seen.has(key)) {
        g.remove();
        this.edgeEls.delete(key);
      }
    }
  }

  private removeStale(map: Map<string, KeyedEl>, seen: Set<string>): void {
    for (const [id, entry] of map) {
      if (seen.has(id)) continue;
      map.delete(id);
      if (this.selectedId === id) this.select(null, null);
      entry.g.classList.add("exit");
      const g = entry.g;
      setTimeout(() => g.remove(), 300);
    }
  }

  /** エクスポート用に整形した単体SVG文字列を返す */
  exportSvgString(width: number, height: number): string {
    const clone = this.svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", SVG_NS);
    clone.setAttribute("xmlns:xlink", XLINK_NS);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.removeAttribute("id");
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    for (const el of clone.querySelectorAll(".hit, .sel-outline, .exit")) el.remove();
    for (const el of clone.querySelectorAll(".enter, .selected")) {
      el.classList.remove("enter", "selected");
    }
    // 白背景
    const bg = svgEl("rect", {
      x: "0",
      y: "0",
      width: String(width),
      height: String(height),
      fill: "#FFFFFF",
    });
    clone.insertBefore(bg, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
}
