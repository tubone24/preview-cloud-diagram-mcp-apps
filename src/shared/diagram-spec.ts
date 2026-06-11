// AWS構成図の宣言的スペック。
// render_aws_diagram ツールの入力契約であり、UI側プログレッシブレンダリングの契約でもある。
// elements は「ユーザー/入口側から処理の流れの順」に並べる。
// ホストがツール引数をストリーミングする間、UIは配列の先頭から順に描画していく。

/** AWS公式アイコンデッキで定義されているグループ枠の種類 */
export type GroupKind =
  | "aws-cloud"
  | "region"
  | "availability-zone"
  | "vpc"
  | "public-subnet"
  | "private-subnet"
  | "security-group"
  | "auto-scaling-group"
  | "aws-account"
  | "ec2-instance-contents"
  | "server-contents"
  | "corporate-data-center"
  | "spot-fleet"
  | "step-functions-workflow"
  | "generic";

export interface GroupElement {
  type: "group";
  /** 図内で一意なID */
  id: string;
  kind: GroupKind;
  /** 表示ラベル。省略時は kind の既定ラベル（例: "AWS Cloud"） */
  label?: string;
  /** 入れ子の親グループID */
  parent?: string;
}

export interface NodeElement {
  type: "node";
  /** 図内で一意なID */
  id: string;
  /** アイコンID（例: "amazon-ec2", "aws-lambda", "user"）。list_aws_icons で検索可能 */
  icon: string;
  /** リソース固有名（例: "web-server-01"）。サービス名ラベルはアイコンから自動付与される */
  name?: string;
  /** 所属するグループID */
  parent?: string;
  /** 番号コールアウト（黒丸＋白太字番号）。spec.steps の凡例と対応する1始まりの番号 */
  step?: number;
}

export interface EdgeElement {
  type: "edge";
  id?: string;
  /** 接続元のノード/グループID */
  from: string;
  /** 接続先のノード/グループID */
  to: string;
  /** 線上に白背景の小さな箱で表示するラベル（例: "HTTPS", "VPC Peering"） */
  label?: string;
  /** 矢印の向き。既定は forward */
  direction?: "forward" | "both" | "none";
  /** 番号コールアウト（黒丸＋白太字番号）を線の中点に表示。spec.steps と対応する1始まりの番号 */
  step?: number;
}

/** アイコンで表現できない補足説明を載せる注釈ボックス */
export interface NoteElement {
  type: "note";
  /** 図内で一意なID */
  id: string;
  /** 注釈テキスト（複数行可） */
  text: string;
  /** 配置先グループID（省略時はキャンバス直置き） */
  parent?: string;
  /** この要素の近くに配置したいノード/グループID */
  attachTo?: string;
}

export type DiagramElement = GroupElement | NodeElement | EdgeElement | NoteElement;

export interface DiagramSpec {
  /** 図のタイトル */
  title?: string;
  /** 入口側（ユーザー/クライアント）から順に並べた図の構成要素 */
  elements: DiagramElement[];
  /**
   * 番号コールアウトの凡例（1始まり）。図の下に「① …」形式の手順リストとして表示される。
   * node/edge の step と対応させる
   */
  steps?: string[];
}

/** グループ枠の公式スタイル定義（AWS Architecture Icons Deck 2025.07.31 準拠） */
export interface GroupStyle {
  /** 既定ラベル */
  label: string;
  /** 枠線色 */
  color: string;
  /** 枠線スタイル */
  border: "solid" | "dashed" | "dotted";
  /** グループアイコンID（assets/aws-icons/groups/ 内）。null はアイコンなし（generic等） */
  iconId: string | null;
}

export const GROUP_STYLES: Record<GroupKind, GroupStyle> = {
  "aws-cloud": { label: "AWS Cloud", color: "#000000", border: "solid", iconId: "aws-cloud" },
  region: { label: "Region", color: "#00A4A6", border: "dotted", iconId: "region" },
  "availability-zone": { label: "Availability Zone", color: "#00A4A6", border: "dashed", iconId: null },
  vpc: { label: "VPC", color: "#8C4FFF", border: "solid", iconId: "virtual-private-cloud-vpc" },
  "public-subnet": { label: "Public subnet", color: "#7AA116", border: "solid", iconId: "public-subnet" },
  "private-subnet": { label: "Private subnet", color: "#00A4A6", border: "solid", iconId: "private-subnet" },
  "security-group": { label: "Security group", color: "#DD344C", border: "solid", iconId: null },
  "auto-scaling-group": { label: "Auto Scaling group", color: "#ED7100", border: "dashed", iconId: "auto-scaling-group" },
  "aws-account": { label: "AWS account", color: "#E7157B", border: "solid", iconId: "aws-account" },
  "ec2-instance-contents": { label: "EC2 instance contents", color: "#ED7100", border: "solid", iconId: "ec2-instance-contents" },
  "server-contents": { label: "Server contents", color: "#7D8998", border: "solid", iconId: "server-contents" },
  "corporate-data-center": { label: "Corporate data center", color: "#7D8998", border: "solid", iconId: "corporate-data-center" },
  "spot-fleet": { label: "Spot Fleet", color: "#ED7100", border: "solid", iconId: "spot-fleet" },
  "step-functions-workflow": { label: "AWS Step Functions workflow", color: "#E7157B", border: "solid", iconId: null },
  generic: { label: "", color: "#7D8998", border: "dashed", iconId: null },
};

/** アイコンマニフェストの1エントリ */
export interface IconEntry {
  /** 正規化ID（例: "amazon-ec2"） */
  id: string;
  /** 表示名 = ラベルに使うサービス名（例: "Amazon EC2"） */
  name: string;
  /** カテゴリ（例: "Compute"） */
  category: string;
  /** カテゴリ色 */
  color: string;
}

export interface IconManifest {
  services: IconEntry[];
  resources: IconEntry[];
  groups: IconEntry[];
  /** 別名 → 正規ID（例: "s3" → "amazon-simple-storage-service"） */
  aliases: Record<string, string>;
}
