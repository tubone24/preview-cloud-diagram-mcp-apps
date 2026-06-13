// クラウド構成図の宣言的スペック（AWS / Azure / GCP / SaaS / Multi 対応）。
// render_diagram ツールの入力契約であり、UI側プログレッシブレンダリングの契約でもある。
// elements は「ユーザー/入口側から処理の流れの順」に並べる。
// ホストがツール引数をストリーミングする間、UIは配列の先頭から順に描画していく。

/** 単一クラウドプロバイダー種別（SaaS / 汎用含む） */
export type BaseProvider = "aws" | "azure" | "gcp" | "saas" | "generic";

/** クラウドプロバイダー種別（multi は複数プロバイダー混在モード） */
export type Provider = BaseProvider | "multi";

/** 型ガード: 文字列が有効な Provider かを判定する */
export function isProvider(p: unknown): p is Provider {
  return (
    p === "aws" ||
    p === "azure" ||
    p === "gcp" ||
    p === "saas" ||
    p === "generic" ||
    p === "multi"
  );
}

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
  | "generic"
  // Azure
  | "azure-cloud"
  | "azure-subscription"
  | "azure-resource-group"
  | "azure-vnet"
  | "azure-subnet"
  | "azure-availability-zone"
  | "azure-management-group"
  | "azure-app-service-plan"
  // GCP
  | "gcp-cloud"
  | "gcp-project"
  | "gcp-vpc"
  | "gcp-region"
  | "gcp-zone"
  | "gcp-subnet"
  | "gcp-shared-vpc"
  | "c4-system-boundary"
  | "c4-container-boundary"
  | "pipeline-stage";

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
  /** アイコンID（例: "amazon-ec2", "aws-lambda", "user"）。list_icons で検索可能 */
  icon: string;
  /** リソース固有名（例: "web-server-01"）。サービス名ラベルはアイコンから自動付与される */
  name?: string;
  /** 所属するグループID */
  parent?: string;
  /** 番号コールアウト（黒丸＋白太字番号）。spec.steps の凡例と対応する1始まりの番号 */
  step?: number;
  /** C4-style technology label shown as "[Tech]" under the name */
  tech?: string;
  /** C4-style short description shown in small text under the label */
  description?: string;
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
  /** Line style. Use "dashed" for triggers/webhooks/async flows. Defaults to solid */
  style?: "solid" | "dashed";
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
  /** クラウドプロバイダー。省略時は "aws" 扱い（後方互換） */
  provider?: Provider;
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
  // Azure (ブランドカラー #0078D4 基調)
  "azure-cloud":             { label: "Microsoft Azure",   color: "#0078D4", border: "solid",  iconId: null },
  "azure-subscription":      { label: "Subscription",      color: "#0078D4", border: "dashed", iconId: "azure-subscriptions" },
  "azure-resource-group":    { label: "Resource group",    color: "#7D8998", border: "dashed", iconId: "azure-resource-groups" },
  "azure-vnet":              { label: "Virtual network",   color: "#0078D4", border: "solid",  iconId: "azure-virtual-networks" },
  "azure-subnet":            { label: "Subnet",            color: "#00B7C3", border: "solid",  iconId: null },
  "azure-availability-zone": { label: "Availability Zone", color: "#00A4A6", border: "dashed", iconId: null },
  "azure-management-group":  { label: "Management group",  color: "#0078D4", border: "dotted", iconId: "azure-management-groups" },
  "azure-app-service-plan":  { label: "App Service plan",  color: "#0078D4", border: "dashed", iconId: null },
  // GCP (ブランドカラー #4285F4 基調 + Google緑)
  "gcp-cloud":      { label: "Google Cloud", color: "#4285F4", border: "solid",  iconId: "gcp-my-cloud" },
  "gcp-project":    { label: "Project",      color: "#4285F4", border: "solid",  iconId: "gcp-project" },
  "gcp-vpc":        { label: "VPC network",  color: "#4285F4", border: "solid",  iconId: "gcp-virtual-private-cloud" },
  "gcp-region":     { label: "Region",       color: "#00A4A6", border: "dotted", iconId: null },
  "gcp-zone":       { label: "Zone",         color: "#00A4A6", border: "dashed", iconId: null },
  "gcp-subnet":     { label: "Subnet",       color: "#34A853", border: "solid",  iconId: null },
  "gcp-shared-vpc": { label: "Shared VPC",   color: "#4285F4", border: "dashed", iconId: "gcp-virtual-private-cloud" },
  // C4 / CI-CD (provider-agnostic)
  "c4-system-boundary":    { label: "System boundary",    color: "#444B53", border: "dashed", iconId: null },
  "c4-container-boundary": { label: "Container boundary", color: "#7D8998", border: "dashed", iconId: null },
  "pipeline-stage":        { label: "Stage",              color: "#7D8998", border: "solid",  iconId: null },
};

/** プロバイダーごとに使用可能なグループ種別の一覧 */
export const GROUP_KINDS_BY_PROVIDER: Record<Provider, GroupKind[]> = {
  aws: [
    "aws-cloud",
    "region",
    "availability-zone",
    "vpc",
    "public-subnet",
    "private-subnet",
    "security-group",
    "auto-scaling-group",
    "aws-account",
    "ec2-instance-contents",
    "server-contents",
    "corporate-data-center",
    "spot-fleet",
    "step-functions-workflow",
    "generic",
    "c4-system-boundary",
    "c4-container-boundary",
    "pipeline-stage",
  ],
  azure: [
    "azure-cloud",
    "azure-subscription",
    "azure-resource-group",
    "azure-vnet",
    "azure-subnet",
    "azure-availability-zone",
    "azure-management-group",
    "azure-app-service-plan",
    "generic",
    "corporate-data-center",
    "server-contents",
    "c4-system-boundary",
    "c4-container-boundary",
    "pipeline-stage",
  ],
  gcp: [
    "gcp-cloud",
    "gcp-project",
    "gcp-vpc",
    "gcp-region",
    "gcp-zone",
    "gcp-subnet",
    "gcp-shared-vpc",
    "generic",
    "corporate-data-center",
    "server-contents",
    "c4-system-boundary",
    "c4-container-boundary",
    "pipeline-stage",
  ],
  saas: [
    "generic",
    "corporate-data-center",
    "server-contents",
    "c4-system-boundary",
    "c4-container-boundary",
    "pipeline-stage",
  ],
  generic: [
    "generic",
    "corporate-data-center",
    "server-contents",
    "c4-system-boundary",
    "c4-container-boundary",
    "pipeline-stage",
  ],
  // multi は全 GroupKind を許容（全プロバイダーのグループを混在可能）
  multi: [],
};

// multi は GROUP_STYLES の全キーを動的に設定（循環参照を避けるため定義後に代入）
GROUP_KINDS_BY_PROVIDER.multi = Object.keys(GROUP_STYLES) as GroupKind[];

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
