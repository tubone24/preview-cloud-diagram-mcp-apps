// シーケンス図SVGレンダラ。要素キーでDOMを永続化し、
// 出現時はフェード＋スケールイン、位置・寸法の変更は transition でスムーズに追従させる。
import { textWidth } from "./layout";
import {
  NOTE_FOLD,
  SEQ_ICON_SIZE,
  fragmentTabWidth,
  type SeqActivationLayout,
  type SeqFragmentLayout,
  type SeqLifelineLayout,
  type SeqMessageLayout,
  type SeqNoteLayout,
  type SequenceLayout,
} from "./sequence-layout";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const FONT_SMALL = "11px Arial, sans-serif";
const LIFELINE_COLOR = "#7D8998";
const NOTE_BG = "#FFF9C4";
const NOTE_BORDER = "#B5A04A";

export type SequenceSelection =
  | { kind: "lifeline"; serviceName: string; name: string | null }
  | { kind: "message"; label: string };

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
  img.setAttributeNS(XLINK_NS, "xlink:href", uri);
}

function pathD(points: Array<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

export class SequenceRenderer {
  readonly svg: SVGSVGElement;
  private readonly gLifelines: SVGGElement;
  private readonly gActivations: SVGGElement;
  private readonly gFragments: SVGGElement;
  private readonly gMessages: SVGGElement;
  private readonly gNotes: SVGGElement;
  private readonly lifelineEls = new Map<string, SVGGElement>();
  private readonly actEls = new Map<string, SVGGElement>();
  private readonly fragEls = new Map<string, SVGGElement>();
  private readonly msgEls = new Map<string, SVGGElement>();
  private readonly noteEls = new Map<string, SVGGElement>();
  private selectedKey: string | null = null;
  /** 選択変更コールバック（null = 選択解除） */
  onselect: ((sel: SequenceSelection | null) => void) | null = null;
  /** ドラッグ操作直後のクリックを無視するための判定フック */
  isDragClick: (() => boolean) | null = null;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    const defs = svgEl("defs");
    // 矢じり: filled=塗りつぶし三角（sync/self）、open=開いたV字（async/return）
    defs.innerHTML =
      '<marker id="seq-arrow-filled" viewBox="0 0 10 10" refX="9" refY="5"' +
      ' markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse"' +
      ' orient="auto-start-reverse">' +
      '<path d="M0.5 1 L9.5 5 L0.5 9 Z" fill="#000000"/></marker>' +
      '<marker id="seq-arrow-open" viewBox="0 0 10 10" refX="8.5" refY="5"' +
      ' markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse"' +
      ' orient="auto-start-reverse">' +
      '<path d="M1.5 1.5 L8.5 5 L1.5 8.5" fill="none" stroke="#000000"' +
      ' stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></marker>';
    svg.appendChild(defs);
    this.gLifelines = svgEl("g", { class: "layer-lifelines" });
    this.gActivations = svgEl("g", { class: "layer-activations" });
    this.gFragments = svgEl("g", { class: "layer-fragments" });
    this.gMessages = svgEl("g", { class: "layer-messages" });
    this.gNotes = svgEl("g", { class: "layer-seq-notes" });
    svg.appendChild(this.gLifelines);
    svg.appendChild(this.gActivations);
    svg.appendChild(this.gFragments);
    svg.appendChild(this.gMessages);
    svg.appendChild(this.gNotes);
    svg.addEventListener("click", (ev) => {
      if (ev.target === svg && !this.isDragClick?.()) this.select(null, null);
    });
  }

  private findSelectable(key: string): SVGGElement | undefined {
    return this.lifelineEls.get(key) ?? this.msgEls.get(key);
  }

  private select(key: string | null, info: SequenceSelection | null): void {
    if (this.selectedKey === key) return;
    if (this.selectedKey) {
      this.findSelectable(this.selectedKey)?.classList.remove("selected");
    }
    this.selectedKey = key;
    if (key) this.findSelectable(key)?.classList.add("selected");
    this.onselect?.(info);
  }

  private animateEnter(g: SVGGElement): void {
    g.classList.add("enter");
    void g.getBoundingClientRect();
    requestAnimationFrame(() => g.classList.remove("enter"));
  }

  render(layout: SequenceLayout): void {
    this.syncLifelines(layout.lifelines);
    this.syncActivations(layout.activations);
    this.syncFragments(layout.fragments);
    this.syncMessages(layout.messages);
    this.syncNotes(layout.notes);
  }

  private removeStale(map: Map<string, SVGGElement>, seen: Set<string>): void {
    for (const [key, g] of map) {
      if (seen.has(key)) continue;
      map.delete(key);
      if (this.selectedKey === key) this.select(null, null);
      g.classList.add("exit");
      setTimeout(() => g.remove(), 300);
    }
  }

  // ---- ライフライン（ヘッダ＋破線） ----
  private syncLifelines(items: SeqLifelineLayout[]): void {
    const seen = new Set<string>();
    for (const ll of items) {
      const key = `life#${ll.id}`;
      seen.add(key);
      let g = this.lifelineEls.get(key);
      if (!g) {
        g = this.createLifeline(ll, key);
        this.lifelineEls.set(key, g);
        this.gLifelines.appendChild(g);
        g.style.transform = `translate(${ll.centerX}px, 0px)`;
        this.animateEnter(g);
      } else {
        g.style.transform = `translate(${ll.centerX}px, 0px)`;
      }
      this.updateLifeline(g, ll);
    }
    this.removeStale(this.lifelineEls, seen);
  }

  private createLifeline(ll: SeqLifelineLayout, key: string): SVGGElement {
    const g = svgEl("g", { class: "el lifeline", "data-id": ll.id });
    const inner = svgEl("g", { class: "inner" });
    g.appendChild(inner);
    inner.appendChild(
      svgEl("line", {
        class: "lline",
        x1: "0",
        x2: "0",
        stroke: LIFELINE_COLOR,
        "stroke-width": "1",
        "stroke-dasharray": "5 4",
      }),
    );
    const holder = svgEl("g", { class: "icon-holder" });
    inner.appendChild(holder);
    inner.appendChild(
      svgEl("text", {
        class: "svc",
        "text-anchor": "middle",
        "font-family": "Arial, sans-serif",
        "font-size": "12",
        fill: "#16191F",
      }),
    );
    inner.appendChild(
      svgEl("text", {
        class: "rname",
        "text-anchor": "middle",
        "font-family": "Arial, sans-serif",
        "font-size": "11",
        fill: "#687078",
      }),
    );
    const hit = svgEl("rect", { class: "hit", fill: "transparent" });
    inner.appendChild(hit);
    inner.appendChild(svgEl("rect", { class: "sel-outline", rx: "4", fill: "none" }));
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.isDragClick?.()) return;
      this.select(key, {
        kind: "lifeline",
        serviceName: ll.icon.name,
        name: ll.nameText,
      });
    });
    return g;
  }

  private updateLifeline(g: SVGGElement, ll: SeqLifelineLayout): void {
    const inner = g.querySelector<SVGGElement>(".inner")!;
    const line = inner.querySelector<SVGLineElement>(".lline")!;
    line.setAttribute("y1", String(ll.lineTop));
    line.setAttribute("y2", String(ll.lineBottom));

    const holder = inner.querySelector<SVGGElement>(".icon-holder")!;
    const half = SEQ_ICON_SIZE / 2;
    if (ll.icon.dataUri) {
      let img = holder.querySelector<SVGImageElement>("image");
      if (!img) {
        holder.innerHTML = "";
        img = svgEl("image", {
          width: String(SEQ_ICON_SIZE),
          height: String(SEQ_ICON_SIZE),
        });
        holder.appendChild(img);
      }
      img.setAttribute("x", String(-half));
      img.setAttribute("y", String(ll.topY));
      setImageHref(img, ll.icon.dataUri);
    } else if (!holder.querySelector(".fallback")) {
      holder.innerHTML = "";
      const fg = svgEl("g", { class: "fallback" });
      fg.appendChild(
        svgEl("rect", {
          x: String(-half),
          y: String(ll.topY),
          width: String(SEQ_ICON_SIZE),
          height: String(SEQ_ICON_SIZE),
          rx: "6",
          fill: "#E9EBED",
          stroke: "#879196",
          "stroke-width": "1.25",
        }),
      );
      const q = svgEl("text", {
        x: "0",
        y: String(ll.topY + half),
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "font-family": "Arial, sans-serif",
        "font-size": "22",
        fill: "#5F6B7A",
      });
      q.textContent = "?";
      fg.appendChild(q);
      holder.appendChild(fg);
    }

    const svc = inner.querySelector<SVGTextElement>(".svc")!;
    svc.innerHTML = "";
    ll.labelLines.forEach((lineText, i) => {
      const tspan = svgEl("tspan", {
        x: "0",
        y: String(ll.topY + SEQ_ICON_SIZE + 16 + i * 14),
      });
      tspan.textContent = lineText;
      svc.appendChild(tspan);
    });

    const name = inner.querySelector<SVGTextElement>(".rname")!;
    if (ll.nameText) {
      name.textContent = ll.nameText;
      name.setAttribute("x", "0");
      name.setAttribute(
        "y",
        String(ll.topY + SEQ_ICON_SIZE + 16 + ll.labelLines.length * 14),
      );
      name.removeAttribute("display");
    } else {
      name.setAttribute("display", "none");
    }

    const hit = inner.querySelector<SVGRectElement>(".hit")!;
    hit.setAttribute("x", String(-ll.headW / 2));
    hit.setAttribute("y", String(ll.topY));
    hit.setAttribute("width", String(ll.headW));
    hit.setAttribute("height", String(ll.lineTop - ll.topY));
    const sel = inner.querySelector<SVGRectElement>(".sel-outline")!;
    sel.setAttribute("x", String(-ll.headW / 2 - 3));
    sel.setAttribute("y", String(ll.topY - 3));
    sel.setAttribute("width", String(ll.headW + 6));
    sel.setAttribute("height", String(ll.lineTop - ll.topY + 6));
  }

  // ---- 活性化バー（白塗り・黒枠 8px） ----
  private syncActivations(items: SeqActivationLayout[]): void {
    const seen = new Set<string>();
    for (const al of items) {
      seen.add(al.key);
      let g = this.actEls.get(al.key);
      if (!g) {
        g = svgEl("g", { class: "el act" });
        const inner = svgEl("g", { class: "inner" });
        g.appendChild(inner);
        inner.appendChild(
          svgEl("rect", {
            class: "frame",
            x: "0",
            y: "0",
            width: String(al.w),
            fill: "#FFFFFF",
            stroke: "#000000",
            "stroke-width": "1",
          }),
        );
        this.actEls.set(al.key, g);
        this.gActivations.appendChild(g);
        g.style.transform = `translate(${al.x}px, ${al.y}px)`;
        this.animateEnter(g);
      } else {
        g.style.transform = `translate(${al.x}px, ${al.y}px)`;
      }
      const rect = g.querySelector<SVGRectElement>(".frame")!;
      rect.setAttribute("height", String(al.h));
      rect.style.height = `${al.h}px`;
    }
    this.removeStale(this.actEls, seen);
  }

  // ---- 複合フラグメント ----
  private syncFragments(items: SeqFragmentLayout[]): void {
    const seen = new Set<string>();
    for (const fl of items) {
      seen.add(fl.key);
      let g = this.fragEls.get(fl.key);
      if (!g) {
        g = this.createFragment(fl);
        this.fragEls.set(fl.key, g);
        this.gFragments.appendChild(g);
        g.style.transform = `translate(${fl.x}px, ${fl.y}px)`;
        this.animateEnter(g);
      } else {
        g.style.transform = `translate(${fl.x}px, ${fl.y}px)`;
      }
      this.updateFragment(g, fl);
    }
    this.removeStale(this.fragEls, seen);
  }

  private createFragment(fl: SeqFragmentLayout): SVGGElement {
    const g = svgEl("g", { class: "el frag", "data-key": fl.key });
    const inner = svgEl("g", { class: "inner" });
    g.appendChild(inner);
    inner.appendChild(
      svgEl("rect", {
        class: "frame",
        x: "0",
        y: "0",
        fill: "none",
        stroke: "#000000",
        "stroke-width": "1",
      }),
    );
    inner.appendChild(
      svgEl("path", { class: "tab", fill: "#FFFFFF", stroke: "#000000", "stroke-width": "1" }),
    );
    inner.appendChild(
      svgEl("text", {
        class: "fkind",
        "font-family": "Arial, sans-serif",
        "font-size": "11",
        "font-weight": "bold",
        fill: "#16191F",
        "dominant-baseline": "central",
      }),
    );
    const guardG = svgEl("g", { class: "fguard" });
    guardG.appendChild(svgEl("rect", { fill: "#FFFFFF" }));
    guardG.appendChild(
      svgEl("text", {
        "font-family": "Arial, sans-serif",
        "font-size": "11",
        fill: "#16191F",
        "dominant-baseline": "central",
      }),
    );
    inner.appendChild(guardG);
    inner.appendChild(svgEl("g", { class: "seps" }));
    return g;
  }

  private updateFragment(g: SVGGElement, fl: SeqFragmentLayout): void {
    const inner = g.querySelector<SVGGElement>(".inner")!;
    const frame = inner.querySelector<SVGRectElement>(".frame")!;
    frame.setAttribute("width", String(fl.w));
    frame.setAttribute("height", String(fl.h));
    frame.style.width = `${fl.w}px`;
    frame.style.height = `${fl.h}px`;
    // ストリーミング中の仮の高さ（end 未到達）は破線で示す
    if (fl.open) frame.setAttribute("stroke-dasharray", "4 3");
    else frame.removeAttribute("stroke-dasharray");

    const tabW = fragmentTabWidth(fl.kind);
    const tabH = 16;
    const tab = inner.querySelector<SVGPathElement>(".tab")!;
    tab.setAttribute(
      "d",
      `M0 0 H${tabW} V${tabH - 6} L${tabW - 6} ${tabH} H0 Z`,
    );
    const fkind = inner.querySelector<SVGTextElement>(".fkind")!;
    fkind.textContent = fl.kind;
    fkind.setAttribute("x", "7");
    fkind.setAttribute("y", String(tabH / 2 + 0.5));

    const guardG = inner.querySelector<SVGGElement>(".fguard")!;
    const guardText = guardG.querySelector("text")!;
    const guardRect = guardG.querySelector("rect")!;
    if (fl.label) {
      const text = `[${fl.label}]`;
      guardText.textContent = text;
      guardText.setAttribute("x", String(tabW + 8));
      guardText.setAttribute("y", String(tabH / 2 + 0.5));
      const w = textWidth(text, FONT_SMALL) + 6;
      guardRect.setAttribute("x", String(tabW + 5));
      guardRect.setAttribute("y", "1");
      guardRect.setAttribute("width", String(w));
      guardRect.setAttribute("height", String(tabH - 2));
      guardG.removeAttribute("display");
    } else {
      guardG.setAttribute("display", "none");
    }

    // else 区切り（破線＋[ラベル]）は数が少ないため毎回作り直す
    const seps = inner.querySelector<SVGGElement>(".seps")!;
    seps.innerHTML = "";
    for (const sep of fl.separators) {
      const relY = sep.y - fl.y;
      seps.appendChild(
        svgEl("line", {
          x1: "0",
          x2: String(fl.w),
          y1: String(relY),
          y2: String(relY),
          stroke: "#000000",
          "stroke-width": "1",
          "stroke-dasharray": "5 3",
        }),
      );
      if (sep.label) {
        const t = svgEl("text", {
          x: "8",
          y: String(relY + 14),
          "font-family": "Arial, sans-serif",
          "font-size": "11",
          fill: "#16191F",
        });
        t.textContent = `[${sep.label}]`;
        seps.appendChild(t);
      }
    }
  }

  // ---- メッセージ矢印 ----
  private syncMessages(items: SeqMessageLayout[]): void {
    const seen = new Set<string>();
    for (const ml of items) {
      seen.add(ml.key);
      let g = this.msgEls.get(ml.key);
      if (!g) {
        g = this.createMessage(ml);
        this.msgEls.set(ml.key, g);
        this.gMessages.appendChild(g);
        this.animateEnter(g);
      }
      this.updateMessage(g, ml);
    }
    this.removeStale(this.msgEls, seen);
  }

  private createMessage(ml: SeqMessageLayout): SVGGElement {
    const g = svgEl("g", { class: "el msg", "data-key": ml.key });
    const inner = svgEl("g", { class: "inner" });
    g.appendChild(inner);
    inner.appendChild(
      svgEl("path", {
        class: "msg-line",
        fill: "none",
        stroke: "#000000",
        "stroke-width": "1.25",
      }),
    );
    const labelG = svgEl("g", { class: "mlabel" });
    labelG.appendChild(svgEl("rect", { fill: "#FFFFFF" }));
    labelG.appendChild(
      svgEl("text", {
        "font-family": "Arial, sans-serif",
        "font-size": "11",
        fill: "#16191F",
        "dominant-baseline": "central",
      }),
    );
    inner.appendChild(labelG);
    const hit = svgEl("path", {
      class: "hit",
      fill: "none",
      stroke: "transparent",
      "stroke-width": "14",
    });
    inner.appendChild(hit);
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.isDragClick?.()) return;
      const label = g!.querySelector<SVGTextElement>(".mlabel text")?.textContent ?? ml.label;
      this.select(ml.key, { kind: "message", label });
    });
    return g;
  }

  private updateMessage(g: SVGGElement, ml: SeqMessageLayout): void {
    const inner = g.querySelector<SVGGElement>(".inner")!;
    const path = inner.querySelector<SVGPathElement>(".msg-line")!;
    const d = pathD(ml.points);
    path.setAttribute("d", d);
    if (ml.kind === "return") path.setAttribute("stroke-dasharray", "5 3");
    else path.removeAttribute("stroke-dasharray");
    const marker =
      ml.kind === "async" || ml.kind === "return"
        ? "url(#seq-arrow-open)"
        : "url(#seq-arrow-filled)";
    path.setAttribute("marker-end", marker);
    inner.querySelector<SVGPathElement>(".hit")!.setAttribute("d", d);

    const labelG = inner.querySelector<SVGGElement>(".mlabel")!;
    const text = labelG.querySelector("text")!;
    const rect = labelG.querySelector("rect")!;
    text.textContent = ml.label;
    text.setAttribute("x", String(ml.labelX));
    text.setAttribute("y", String(ml.labelY));
    text.setAttribute("text-anchor", ml.labelAnchor);
    const w = textWidth(ml.label, FONT_SMALL) + 8;
    rect.setAttribute(
      "x",
      String(ml.labelAnchor === "middle" ? ml.labelX - w / 2 : ml.labelX - 4),
    );
    rect.setAttribute("y", String(ml.labelY - 8));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", "16");
  }

  // ---- ノート（黄色・折り角付き） ----
  private syncNotes(items: SeqNoteLayout[]): void {
    const seen = new Set<string>();
    for (const nl of items) {
      seen.add(nl.key);
      let g = this.noteEls.get(nl.key);
      if (!g) {
        g = svgEl("g", { class: "el seq-note", "data-key": nl.key });
        const inner = svgEl("g", { class: "inner" });
        g.appendChild(inner);
        inner.appendChild(
          svgEl("path", {
            class: "note-bg",
            fill: NOTE_BG,
            stroke: NOTE_BORDER,
            "stroke-width": "0.75",
          }),
        );
        inner.appendChild(
          svgEl("path", {
            class: "note-fold",
            fill: "none",
            stroke: NOTE_BORDER,
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
        this.noteEls.set(nl.key, g);
        this.gNotes.appendChild(g);
        g.style.transform = `translate(${nl.x}px, ${nl.y}px)`;
        this.animateEnter(g);
      } else {
        g.style.transform = `translate(${nl.x}px, ${nl.y}px)`;
      }
      const inner = g.querySelector<SVGGElement>(".inner")!;
      inner
        .querySelector<SVGPathElement>(".note-bg")!
        .setAttribute(
          "d",
          `M0 0 H${nl.w - NOTE_FOLD} L${nl.w} ${NOTE_FOLD} V${nl.h} H0 Z`,
        );
      inner
        .querySelector<SVGPathElement>(".note-fold")!
        .setAttribute(
          "d",
          `M${nl.w - NOTE_FOLD} 0 V${NOTE_FOLD} H${nl.w}`,
        );
      const text = inner.querySelector<SVGTextElement>(".note-text")!;
      text.innerHTML = "";
      nl.lines.forEach((line, i) => {
        const tspan = svgEl("tspan", { x: "10", y: String(16 + i * 14) });
        tspan.textContent = line;
        text.appendChild(tspan);
      });
    }
    this.removeStale(this.noteEls, seen);
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
    clone.removeAttribute("hidden");
    for (const el of clone.querySelectorAll(".hit, .sel-outline, .exit")) el.remove();
    for (const el of clone.querySelectorAll(".enter, .selected")) {
      el.classList.remove("enter", "selected");
    }
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
