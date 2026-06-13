// アイコンID解決・検索ユーティリティ。
// src/generated/{aws,azure,gcp,saas}/icon-manifest.json（build:icons の生成物）を唯一のソースとする。

import awsManifest from "../generated/aws/icon-manifest.json";
import azureManifest from "../generated/azure/icon-manifest.json";
import gcpManifest from "../generated/gcp/icon-manifest.json";
import saasManifest from "../generated/saas/icon-manifest.json";
import genericManifest from "../generated/generic/icon-manifest.json";
import type { BaseProvider, IconEntry, IconManifest, Provider } from "../shared/diagram-spec";

// ---- プロバイダーカタログ ----

interface ProviderCatalog {
  /** services + resources + groups を結合した全エントリ */
  entries: IconEntry[];
  /** id → エントリの高速ルックアップ */
  entryById: Map<string, IconEntry>;
  /** 別名キーを小文字化したテーブル（"s3" → "amazon-simple-storage-service"） */
  aliasTable: Map<string, string>;
  /** エイリアス総数（サマリ表示用） */
  aliasCount: number;
}

function buildCatalog(manifest: IconManifest): ProviderCatalog {
  const entries: IconEntry[] = [
    ...manifest.services,
    ...(manifest.resources ?? []),
    ...(manifest.groups ?? []),
  ];
  const entryById = new Map<string, IconEntry>(entries.map((e) => [e.id, e]));
  const aliasTable = new Map<string, string>(
    Object.entries(manifest.aliases).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { entries, entryById, aliasTable, aliasCount: aliasTable.size };
}

const CATALOGS: Record<BaseProvider, ProviderCatalog> = {
  aws: buildCatalog(awsManifest as IconManifest),
  azure: buildCatalog(azureManifest as IconManifest),
  gcp: buildCatalog(gcpManifest as IconManifest),
  saas: buildCatalog(saasManifest as IconManifest),
  generic: buildCatalog(genericManifest as IconManifest),
};

/** multi モードの探索順序（generic は末尾＝first-wins で既存解決を不変に保つ） */
const MULTI_PROVIDER_ORDER: BaseProvider[] = ["aws", "azure", "gcp", "saas", "generic"];

/** AWS の "General" カテゴリリソース（汎用アイコン）をフォールバック用に保持 */
const awsGeneralEntries: IconEntry[] = (awsManifest as IconManifest).resources.filter(
  (e) => e.category === "General",
);
const awsGeneralById = new Map<string, IconEntry>(awsGeneralEntries.map((e) => [e.id, e]));
const awsGeneralAliasTable = new Map<string, string>(
  Object.entries((awsManifest as IconManifest).aliases)
    .filter(([, v]) => awsGeneralById.has(v))
    .map(([k, v]) => [k.toLowerCase(), v]),
);

// ---- 後方互換: AWS 単独エクスポート ----

/** services + resources + groups を結合した全エントリ（AWS、後方互換） */
export const allIconEntries: IconEntry[] = CATALOGS.aws.entries;

/** エイリアス総数（AWSサマリ表示用、後方互換） */
export const aliasCount = CATALOGS.aws.aliasCount;

// ---- 内部ヘルパー ----

/** id または alias の完全一致を試す。当たれば正規IDを返す */
function lookupExact(candidate: string, catalog: ProviderCatalog): string | undefined {
  if (catalog.entryById.has(candidate)) return candidate;
  const aliased = catalog.aliasTable.get(candidate);
  if (aliased && catalog.entryById.has(aliased)) return aliased;
  return undefined;
}

/** AWS General プールで id/alias を検索する */
function lookupInGeneralPool(candidate: string): string | undefined {
  if (awsGeneralById.has(candidate)) return candidate;
  const aliased = awsGeneralAliasTable.get(candidate);
  if (aliased && awsGeneralById.has(aliased)) return aliased;
  return undefined;
}

/** プロバイダー別のプレフィックス候補リスト */
const PROVIDER_PREFIXES: Record<BaseProvider, string[]> = {
  aws: ["amazon-", "aws-"],
  azure: ["azure-"],
  gcp: ["gcp-", "google-"],
  saas: ["saas-"],
  generic: ["generic-"],
};

/**
 * プレフィックスからプロバイダーを検出する（multi モードの委譲用）
 * 正規化済み文字列を受け取り、対応する BaseProvider を返す。未検出は null。
 */
function detectProviderByPrefix(normalized: string): BaseProvider | null {
  if (normalized.startsWith("azure-")) return "azure";
  if (normalized.startsWith("gcp-") || normalized.startsWith("google-")) return "gcp";
  if (normalized.startsWith("saas-")) return "saas";
  if (normalized.startsWith("generic-")) return "generic";
  if (normalized.startsWith("amazon-") || normalized.startsWith("aws-")) return "aws";
  return null;
}

/**
 * 単一プロバイダー内でアイコンIDを解決する（multi 以外用）。
 * 解決順:
 * 1. そのまま（id / alias）
 * 2. 小文字化・空白→ハイフン化して再試行
 * 3. プロバイダー別プレフィックスを付与して再試行
 * 4. プレフィックスを剥がして再試行
 * 5. id・name への部分一致（最初の候補）
 * 6. AWS General カテゴリへのフォールバック
 * 解決できなければ null を返す。
 */
function resolveInSingleProvider(icon: string, provider: BaseProvider): string | null {
  const catalog = CATALOGS[provider];
  const prefixes = PROVIDER_PREFIXES[provider];

  // 1. そのまま（id / alias）
  const direct = lookupExact(icon, catalog);
  if (direct) return direct;

  // 2. 小文字化・空白→ハイフン化
  const normalized = icon.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const lower = lookupExact(normalized, catalog);
  if (lower) return lower;

  // 3. プロバイダー別プレフィックスを付与して試行
  for (const prefix of prefixes) {
    if (!normalized.startsWith(prefix)) {
      const prefixed = lookupExact(prefix + normalized, catalog);
      if (prefixed) return prefixed;
    }
  }

  // 3b. GCP 限定: "google-" を "gcp-" に読み替えて試行
  if (provider === "gcp" && normalized.startsWith("google-")) {
    const replaced = "gcp-" + normalized.slice("google-".length);
    const hit = lookupExact(replaced, catalog);
    if (hit) return hit;
  }

  // 4. プレフィックスを剥がして再試行
  const prefixPattern = new RegExp(`^(${prefixes.map((p) => p.replace("-", "\\-")).join("|")})`);
  const stripped = normalized.replace(prefixPattern, "");
  if (stripped !== normalized) {
    const hit = lookupExact(stripped, catalog);
    if (hit) return hit;
  }

  // 5. id・name への部分一致（最初の候補）
  const partial =
    catalog.entries.find((e) => e.id.includes(normalized)) ??
    catalog.entries.find((e) => e.name.toLowerCase().includes(normalized));
  if (partial) return partial.id;

  // 6. AWS General カテゴリへのフォールバック（aws 以外のみ、自プロバイダーで未解決の場合）
  if (provider !== "aws") {
    const generalHit = lookupInGeneralPool(normalized);
    if (generalHit) return generalHit;
    const generalPartial =
      awsGeneralEntries.find((e) => e.id.includes(normalized)) ??
      awsGeneralEntries.find((e) => e.name.toLowerCase().includes(normalized));
    if (generalPartial) return generalPartial.id;
  }

  return null;
}

/**
 * multi モードでアイコンIDを解決する。解決順:
 * 1. プレフィックス検出による委譲（azure- → azure のみ、など）
 * 2. 完全一致フェーズ（全カタログ横断、MULTI_PROVIDER_ORDER 順）
 * 3. 部分一致フェーズ（MULTI_PROVIDER_ORDER 順）
 * 4. AWS General フォールバック
 */
function resolveInMulti(icon: string): string | null {
  const normalized = icon.trim().toLowerCase().replace(/[\s_]+/g, "-");

  // 1. プレフィックス検出による委譲
  const detectedProvider = detectProviderByPrefix(normalized);
  if (detectedProvider !== null) {
    return resolveInSingleProvider(icon, detectedProvider);
  }

  // 2. 完全一致フェーズ（全カタログ横断、部分一致より先に全カタログをスキャン）
  for (const provider of MULTI_PROVIDER_ORDER) {
    const catalog = CATALOGS[provider];
    // 直接一致
    const direct = lookupExact(normalized, catalog);
    if (direct) return direct;
    // 元の文字列でも試行（大文字小文字等）
    const directOrig = lookupExact(icon, catalog);
    if (directOrig) return directOrig;
    // プレフィックス付与一致
    for (const prefix of PROVIDER_PREFIXES[provider]) {
      if (!normalized.startsWith(prefix)) {
        const prefixed = lookupExact(prefix + normalized, catalog);
        if (prefixed) return prefixed;
      }
    }
    // プレフィックス除去一致
    for (const prefix of PROVIDER_PREFIXES[provider]) {
      if (normalized.startsWith(prefix)) {
        const stripped = normalized.slice(prefix.length);
        const hit = lookupExact(stripped, catalog);
        if (hit) return hit;
      }
    }
    // GCP 限定: "google-" → "gcp-" 読み替え
    if (provider === "gcp" && normalized.startsWith("google-")) {
      const replaced = "gcp-" + normalized.slice("google-".length);
      const hit = lookupExact(replaced, catalog);
      if (hit) return hit;
    }
  }

  // 3. 部分一致フェーズ（MULTI_PROVIDER_ORDER 順）
  for (const provider of MULTI_PROVIDER_ORDER) {
    const catalog = CATALOGS[provider];
    const partial =
      catalog.entries.find((e) => e.id.includes(normalized)) ??
      catalog.entries.find((e) => e.name.toLowerCase().includes(normalized));
    if (partial) return partial.id;
  }

  // 4. AWS General フォールバック
  const generalHit = lookupInGeneralPool(normalized);
  if (generalHit) return generalHit;
  const generalPartial =
    awsGeneralEntries.find((e) => e.id.includes(normalized)) ??
    awsGeneralEntries.find((e) => e.name.toLowerCase().includes(normalized));
  if (generalPartial) return generalPartial.id;

  return null;
}

/**
 * アイコンIDを正規IDに解決する。
 * provider が "multi" の場合は resolveInMulti を使用。
 * それ以外は resolveInSingleProvider を使用。
 */
export function resolveIconId(icon: string, provider: Provider = "aws"): string | null {
  if (provider === "multi") {
    return resolveInMulti(icon);
  }
  return resolveInSingleProvider(icon, provider);
}

export interface IconSearchResult {
  id: string;
  name: string;
  category: string;
}

// ---- multi モード用マージドカタログ（alias は先勝ちマージ） ----
function buildMultiCatalog(): ProviderCatalog {
  const entries: IconEntry[] = [];
  const entryById = new Map<string, IconEntry>();
  const aliasTable = new Map<string, string>();

  for (const provider of MULTI_PROVIDER_ORDER) {
    const cat = CATALOGS[provider];
    for (const e of cat.entries) {
      if (!entryById.has(e.id)) {
        entries.push(e);
        entryById.set(e.id, e);
      }
    }
    for (const [alias, id] of cat.aliasTable) {
      if (!aliasTable.has(alias)) {
        aliasTable.set(alias, id);
      }
    }
  }
  return { entries, entryById, aliasTable, aliasCount: aliasTable.size };
}

const MULTI_CATALOG: ProviderCatalog = buildMultiCatalog();

/** 大文字小文字無視の部分一致でアイコンを検索する（最大 limit 件） */
export function searchIcons(
  query?: string,
  category?: string,
  limit = 50,
  provider: Provider = "aws",
): IconSearchResult[] {
  const catalog = provider === "multi" ? MULTI_CATALOG : CATALOGS[provider];
  let entries = catalog.entries;

  if (category) {
    const c = category.trim().toLowerCase();
    entries = entries.filter((e) => e.category.toLowerCase().includes(c));
  }

  if (query) {
    const q = query.trim().toLowerCase();
    // エイリアスキーに部分一致した場合、その正規IDもヒット扱いにする
    const aliasHits = new Set<string>();
    for (const [alias, id] of catalog.aliasTable) {
      if (alias.includes(q)) aliasHits.add(id);
    }
    entries = entries.filter(
      (e) => e.id.includes(q) || e.name.toLowerCase().includes(q) || aliasHits.has(e.id),
    );
  }

  return entries.slice(0, limit).map(({ id, name, category: cat }) => ({
    id,
    name,
    category: cat,
  }));
}

/** カテゴリ名 → 件数のサマリ（引数なし検索のレスポンス用） */
export function categorySummary(
  provider: Provider = "aws",
): { category: string; count: number }[] {
  const catalog = provider === "multi" ? MULTI_CATALOG : CATALOGS[provider];
  const counts = new Map<string, number>();
  for (const e of catalog.entries) {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}
