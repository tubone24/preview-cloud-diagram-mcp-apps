// シーケンス図レイアウトエンジン（UML 2.x 準拠）。
// participants を左から順に等間隔（ヘッダ幅・メッセージラベル幅に応じて拡張）に並べ、
// events を上から時系列順に縦へ展開する。
// - 活性化バー: sync 受信で開始、return 送信または deactivate で終了（activate/deactivate で上書き可）。
//   ネストは ACT_OFFSET ずつ右へずらす
// - 複合フラグメント: 全ライフライン幅で囲み、ネストするほど内側へ inset。
//   ストリーミング中に end が来ていない開きっぱなしフラグメントは現時点の末尾まで仮の高さで描く
import type {
  MessageKind,
  SequenceEvent,
  SequenceParticipant,
} from "../shared/sequence-spec";
import type { Provider } from "../shared/diagram-spec";
import { resolveIcon, type ResolvedIcon } from "./icons";
import { ellipsize, textWidth, wrapLabel } from "./layout";

export const SEQ_ICON_SIZE = 48;
const MARGIN = 24;
const TOP_PAD = 8;
const MIN_GAP = 140; // ライフライン中心間の最小間隔
const LINE_H = 14;
const FONT_LABEL = "12px Arial, sans-serif";
const FONT_SMALL = "11px Arial, sans-serif";
const FONT_FRAG = "bold 11px Arial, sans-serif";
const HEAD_LABEL_MAX_W = 120;
const EVENT_STEP = 44; // メッセージ1本あたりの縦の進み
const SELF_W = 30; // 自己メッセージの折り返し幅
const SELF_H = 18; // 自己メッセージの折り返し高さ
const ACT_W = 8; // 活性化バー幅
const ACT_OFFSET = 4; // ネスト1段ごとの右ずらし量
const FRAG_HEADER_H = 30; // フラグメント枠上端（タブ）ぶんの余白
const FRAG_SIDE_PAD = 40;
const FRAG_NEST_INSET = 10; // 内側のフラグメントほど左右を狭める
const FRAG_BOTTOM_PAD = 12;
const FRAG_AFTER_GAP = 16;
const ELSE_GAP_BEFORE = 6;
const ELSE_GAP_AFTER = 28;
const NOTE_MAX_TEXT_W = 180;
const NOTE_PAD_X = 10;
export const NOTE_FOLD = 10;

// ---- レイアウト結果型 ----

export interface SeqLifelineLayout {
  id: string;
  centerX: number;
  headW: number;
  icon: ResolvedIcon;
  labelLines: string[];
  nameText: string | null;
  /** ヘッダ（アイコン）上端 */
  topY: number;
  /** ライフライン破線の上端/下端 */
  lineTop: number;
  lineBottom: number;
}

export interface SeqActivationLayout {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SeqMessageLayout {
  key: string;
  kind: MessageKind;
  /** 折れ線の頂点列（self は4点の凹型経路、それ以外は2点） */
  points: Array<{ x: number; y: number }>;
  label: string;
  labelX: number;
  labelY: number;
  labelAnchor: "middle" | "start";
}

export interface SeqFragmentLayout {
  key: string;
  kind: string;
  label: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** end 未到達（ストリーミング中の仮の高さ） */
  open: boolean;
  separators: Array<{ y: number; label: string | null }>;
}

export interface SeqNoteLayout {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

export interface SequenceLayout {
  width: number;
  height: number;
  lifelines: SeqLifelineLayout[];
  activations: SeqActivationLayout[];
  messages: SeqMessageLayout[];
  fragments: SeqFragmentLayout[];
  notes: SeqNoteLayout[];
}

/** 文字単位の折返し（日本語ノート対応）。明示改行を尊重し最大 maxLines 行 */
function wrapText(text: string, maxW: number, font: string, maxLines: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let cur = "";
    for (const ch of para) {
      if (cur !== "" && textWidth(cur + ch, font) > maxW) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    lines.push(cur);
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = ellipsize(cut[maxLines - 1] + "…", maxW, font);
    return cut;
  }
  return lines;
}

function noteSize(lines: string[]): { w: number; h: number } {
  const maxLine = Math.max(0, ...lines.map((l) => textWidth(l, FONT_SMALL)));
  return {
    w: Math.ceil(Math.max(72, maxLine + NOTE_PAD_X * 2 + NOTE_FOLD)),
    h: lines.length * LINE_H + 12,
  };
}

/** フラグメントタブ（五角形）の幅。レンダラと共有する */
export function fragmentTabWidth(kind: string): number {
  return Math.ceil(textWidth(kind, FONT_FRAG)) + 16;
}

export function layoutSequence(
  participants: SequenceParticipant[],
  events: SequenceEvent[],
  provider: Provider = "aws",
): SequenceLayout {
  // ---- 1. ライフラインヘッダの寸法 ----
  const heads = participants.map((p) => {
    const icon = resolveIcon(p.icon, provider);
    const labelLines = wrapLabel(icon.name, HEAD_LABEL_MAX_W, FONT_LABEL);
    const nameText = p.name ? ellipsize(p.name, HEAD_LABEL_MAX_W, FONT_SMALL) : null;
    const widths = [
      80,
      SEQ_ICON_SIZE,
      ...labelLines.map((l) => textWidth(l, FONT_LABEL) + 8),
    ];
    if (nameText) widths.push(textWidth(nameText, FONT_SMALL) + 8);
    return { p, icon, labelLines, nameText, headW: Math.ceil(Math.max(...widths)) };
  });
  const n = heads.length;
  const maxLines = Math.max(1, ...heads.map((h) => h.labelLines.length));
  const anyName = heads.some((h) => h.nameText !== null);
  const headerH =
    TOP_PAD + SEQ_ICON_SIZE + 6 + maxLines * LINE_H + (anyName ? LINE_H : 0);
  const lineTop = headerH + 6;

  const colOf = new Map<string, number>();
  heads.forEach((h, i) => colOf.set(h.p.id, i));

  // ---- 2. 横間隔（ヘッダ幅とメッセージ/ノートラベル幅に応じて拡張、最小 MIN_GAP） ----
  const gaps: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    gaps.push(Math.max(MIN_GAP, (heads[i].headW + heads[i + 1].headW) / 2 + 24));
  }
  let extraRight = 0; // 最終列の右に必要な追加スペース（自己メッセージ等）
  for (const ev of events) {
    if (ev.type === "message") {
      const a = colOf.get(ev.from);
      const b = colOf.get(ev.to);
      if (a === undefined || b === undefined) continue;
      const labelW = textWidth(ev.label, FONT_SMALL);
      if (a === b || ev.kind === "self") {
        const need = ACT_W + SELF_W + labelW + 28;
        if (a <= n - 2) {
          gaps[a] = Math.max(gaps[a], need + heads[a + 1].headW / 2 + 8);
        } else {
          extraRight = Math.max(extraRight, need);
        }
      } else {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const per = (labelW + 32) / (hi - lo);
        for (let g = lo; g < hi; g++) gaps[g] = Math.max(gaps[g], per);
      }
    } else if (ev.type === "note") {
      const cols = ev.over
        .map((id) => colOf.get(id))
        .filter((c): c is number => c !== undefined);
      if (cols.length === 0) continue;
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const { w } = noteSize(wrapText(ev.text, NOTE_MAX_TEXT_W, FONT_SMALL, 8));
      if (hi > lo) {
        const per = Math.max(0, w - 40) / (hi - lo);
        for (let g = lo; g < hi; g++) gaps[g] = Math.max(gaps[g], per);
      } else if (lo === n - 1) {
        extraRight = Math.max(extraRight, w / 2);
      }
    }
  }
  const centers: number[] = [];
  let cx = n > 0 ? MARGIN + heads[0].headW / 2 : 0;
  for (let i = 0; i < n; i++) {
    centers.push(cx);
    if (i < n - 1) cx += gaps[i];
  }

  // ---- 3. 縦方向にイベントを展開 ----
  const messages: SeqMessageLayout[] = [];
  const fragments: SeqFragmentLayout[] = [];
  const notes: SeqNoteLayout[] = [];
  const activations: SeqActivationLayout[] = [];

  const barStacks = new Map<string, SeqActivationLayout[]>();
  const barCounts = new Map<string, number>();
  for (const h of heads) {
    barStacks.set(h.p.id, []);
    barCounts.set(h.p.id, 0);
  }

  // 活性化バー: レベル k（1始まり）のバー中心は center + (k-1)*ACT_OFFSET
  const rightAnchor = (id: string): number => {
    const c = centers[colOf.get(id)!];
    const d = barStacks.get(id)!.length;
    return d === 0 ? c : c + (d - 1) * ACT_OFFSET + ACT_W / 2;
  };
  const leftAnchor = (id: string): number => {
    const c = centers[colOf.get(id)!];
    const d = barStacks.get(id)!.length;
    return d === 0 ? c : c + (d - 1) * ACT_OFFSET - ACT_W / 2;
  };
  const pushBar = (id: string, y: number): void => {
    const stack = barStacks.get(id)!;
    const level = stack.length + 1;
    const cnt = (barCounts.get(id) ?? 0) + 1;
    barCounts.set(id, cnt);
    const bar: SeqActivationLayout = {
      key: `act#${id}#${cnt}`,
      x: centers[colOf.get(id)!] + (level - 1) * ACT_OFFSET - ACT_W / 2,
      y,
      w: ACT_W,
      h: 0,
    };
    stack.push(bar);
    activations.push(bar);
  };
  const popBar = (id: string, y: number): void => {
    const bar = barStacks.get(id)!.pop();
    if (bar) bar.h = Math.max(8, y - bar.y);
  };

  const fragStack: SeqFragmentLayout[] = [];
  let y = lineTop + 24;
  let maxRight = 0;

  events.forEach((ev, i) => {
    if (ev.type === "fragment") {
      const depth = fragStack.length;
      const x1 = Math.max(6, centers[0] - FRAG_SIDE_PAD + depth * FRAG_NEST_INSET);
      const x2 = centers[n - 1] + FRAG_SIDE_PAD - depth * FRAG_NEST_INSET;
      const frag: SeqFragmentLayout = {
        key: `frag#${i}`,
        kind: ev.kind,
        label: ev.label ?? null,
        x: x1,
        y,
        w: Math.max(120, x2 - x1),
        h: 0,
        open: true,
        separators: [],
      };
      fragments.push(frag);
      fragStack.push(frag);
      maxRight = Math.max(maxRight, x1 + frag.w);
      y += FRAG_HEADER_H;
      return;
    }
    if (ev.type === "else") {
      const f = fragStack[fragStack.length - 1];
      if (f) {
        y += ELSE_GAP_BEFORE;
        f.separators.push({ y, label: ev.label ?? null });
        y += ELSE_GAP_AFTER;
      }
      return;
    }
    if (ev.type === "end") {
      const f = fragStack.pop();
      if (f) {
        y += FRAG_BOTTOM_PAD;
        f.h = y - f.y;
        f.open = false;
        y += FRAG_AFTER_GAP;
      }
      return;
    }
    if (ev.type === "note") {
      const cols = ev.over
        .map((id) => colOf.get(id))
        .filter((c): c is number => c !== undefined);
      if (cols.length === 0) return;
      const lines = wrapText(ev.text, NOTE_MAX_TEXT_W, FONT_SMALL, 8);
      const size = noteSize(lines);
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const w = Math.max(size.w, hi > lo ? centers[hi] - centers[lo] + 40 : 0);
      const x = Math.max(4, (centers[lo] + centers[hi]) / 2 - w / 2);
      y += 4;
      notes.push({ key: `note#${i}`, x, y, w, h: size.h, lines });
      maxRight = Math.max(maxRight, x + w);
      y += size.h + 16;
      return;
    }
    // ---- message ----
    const kind: MessageKind = ev.kind ?? "sync";
    const isSelf = ev.from === ev.to || kind === "self";
    const labelW = textWidth(ev.label, FONT_SMALL);
    const lineY = y + 18;
    const activate = ev.activate ?? (kind === "sync" && !isSelf);
    const deactivate = ev.deactivate ?? (kind === "return");
    if (isSelf) {
      const id = ev.from;
      const sx = rightAnchor(id);
      if (activate) pushBar(id, lineY);
      const ex = rightAnchor(id); // 活性化後の右端へ戻る
      const loopX = Math.max(sx, ex) + SELF_W;
      messages.push({
        key: `msg#${i}`,
        kind,
        points: [
          { x: sx, y: lineY },
          { x: loopX, y: lineY },
          { x: loopX, y: lineY + SELF_H },
          { x: ex, y: lineY + SELF_H },
        ],
        label: ev.label,
        labelX: sx + 8,
        labelY: lineY - 9,
        labelAnchor: "start",
      });
      maxRight = Math.max(maxRight, loopX + 6, sx + 8 + labelW + 8);
      if (deactivate) popBar(id, lineY + SELF_H);
      y = lineY + SELF_H + EVENT_STEP - 18;
    } else {
      const dir = colOf.get(ev.to)! > colOf.get(ev.from)! ? 1 : -1;
      const sx = dir > 0 ? rightAnchor(ev.from) : leftAnchor(ev.from);
      if (activate) pushBar(ev.to, lineY);
      const tx = dir > 0 ? leftAnchor(ev.to) : rightAnchor(ev.to);
      messages.push({
        key: `msg#${i}`,
        kind,
        points: [
          { x: sx, y: lineY },
          { x: tx, y: lineY },
        ],
        label: ev.label,
        labelX: (sx + tx) / 2,
        labelY: lineY - 9,
        labelAnchor: "middle",
      });
      if (deactivate) popBar(ev.from, lineY);
      y = lineY + EVENT_STEP - 18;
    }
  });

  // ---- 4. 末尾処理 ----
  let bottom = Math.max(y + 8, lineTop + 48);
  // 開きっぱなしフラグメント: 現時点の末尾までを仮の高さで描く（閉じたら確定）
  while (fragStack.length > 0) {
    const f = fragStack.pop()!;
    bottom += 6;
    f.h = bottom - f.y;
  }
  const lineBottom = bottom + 12;
  // 未クローズの活性化バーはライフライン下端近くまで延長
  for (const stack of barStacks.values()) {
    for (const bar of stack) bar.h = Math.max(8, lineBottom - 8 - bar.y);
  }

  const lifelines: SeqLifelineLayout[] = heads.map((h, i) => ({
    id: h.p.id,
    centerX: centers[i],
    headW: h.headW,
    icon: h.icon,
    labelLines: h.labelLines,
    nameText: h.nameText,
    topY: TOP_PAD,
    lineTop,
    lineBottom,
  }));

  const width = Math.ceil(
    Math.max(
      280,
      n > 0 ? centers[n - 1] + heads[n - 1].headW / 2 + MARGIN : 0,
      n > 0 ? centers[n - 1] + extraRight + MARGIN : 0,
      maxRight + MARGIN / 2,
    ),
  );
  const height = Math.ceil(Math.max(160, lineBottom + MARGIN));
  return { width, height, lifelines, activations, messages, fragments, notes };
}
