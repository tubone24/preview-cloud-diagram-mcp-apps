// AWSアイコン付きシーケンス図の宣言的スペック。
// render_aws_sequence ツールの入力契約であり、UI側プログレッシブレンダリングの契約でもある。
// participants（ライフライン）を先に宣言し、events は上から時系列順に並べる。
// ホストがツール引数をストリーミングする間、UIはライフラインを立ててから
// メッセージを1本ずつ上から順に描画していく。

export interface SequenceParticipant {
  /** 図内で一意なID */
  id: string;
  /**
   * ライフライン上部に表示するAWSアイコンID（構成図と同じ解決規則、エイリアス可）。
   * AWS以外の登場者は汎用アイコン（"user", "client", "internet" 等）を使う
   */
  icon: string;
  /** リソース固有名（例: "orders-table"）。サービス名ラベルはアイコンから自動付与される */
  name?: string;
}

/**
 * UMLシーケンス図のメッセージ種別。
 * - sync: 同期呼び出し（実線＋塗りつぶし矢じり）
 * - async: 非同期メッセージ（実線＋開いた矢じり）
 * - return: 応答（破線＋開いた矢じり）
 * - self: 自己メッセージ（自分自身への折り返し矢印）
 */
export type MessageKind = "sync" | "async" | "return" | "self";

export interface SequenceMessage {
  type: "message";
  /** 送信元 participant ID */
  from: string;
  /** 宛先 participant ID（self の場合は from と同じでよい） */
  to: string;
  /** 処理内容ラベル（例: "PutItem (orders)"） */
  label: string;
  /** 既定は sync */
  kind?: MessageKind;
  /**
   * 宛先の活性化バー（実行仕様）の制御。
   * 省略時: sync は宛先を活性化、return は送信元を非活性化する
   */
  activate?: boolean;
  deactivate?: boolean;
}

/** 複合フラグメント（alt/opt/loop/par/break）の開始。対応する end まで囲む */
export interface SequenceFragmentStart {
  type: "fragment";
  kind: "alt" | "opt" | "loop" | "par" | "break";
  /** ガード条件やループ条件（例: "cache miss", "3回リトライ"） */
  label?: string;
}

/** alt の分岐区切り（else 区画） */
export interface SequenceFragmentElse {
  type: "else";
  label?: string;
}

/** 直近の fragment を閉じる */
export interface SequenceFragmentEnd {
  type: "end";
}

/** ライフラインをまたぐ補足ノート */
export interface SequenceNoteEvent {
  type: "note";
  /** ノートを載せる participant ID（1つ以上） */
  over: string[];
  text: string;
}

export type SequenceEvent =
  | SequenceMessage
  | SequenceFragmentStart
  | SequenceFragmentElse
  | SequenceFragmentEnd
  | SequenceNoteEvent;

export interface SequenceSpec {
  /** 図のタイトル */
  title?: string;
  /** ライフライン。左から順に表示される（トラフィックの入口側を左に） */
  participants: SequenceParticipant[];
  /** 上から時系列順のイベント列 */
  events: SequenceEvent[];
}
