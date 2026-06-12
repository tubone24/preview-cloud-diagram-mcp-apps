// アイコンID解決・検索ユーティリティ。
// src/generated/{aws,azure,gcp}/icon-manifest.json（build:icons の生成物）を唯一のソースとする。

import awsManifest from "../generated/aws/icon-manifest.json";
import azureManifest from "../generated/azure/icon-manifest.json";
import gcpManifest from "../generated/gcp/icon-manifest.json";
import type { IconEntry, IconManifest, Provider } from "../shared/diagram-spec";

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

const CATALOGS: Record<Provider, ProviderCatalog> = {
  aws: buildCatalog(awsManifest as IconManifest),
  azure: buildCatalog(azureManifest as IconManifest),
  gcp: buildCatalog(gcpManifest as IconManifest),
};

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
const PROVIDER_PREFIXES: Record<Provider, string[]> = {
  aws: ["amazon-", "aws-"],
  azure: ["azure-"],
  gcp: ["gcp-", "google-"],
};

/**
 * アイコンIDを正規IDに解決する。解決順:
 * 1. そのまま（manifestのid / alias）
 * 2. 小文字化・空白→ハイフン化して再試行
 * 3. プロバイダー別プレフィックスを付与して再試行
 *    （gcp: "google-" → "gcp-" への読み替えも試行）
 * 4. プレフィックスを剥がして再試行
 * 5. id・name への部分一致（最初の候補）
 * 6. [azure/gcp のみ] AWS General カテゴリへのフォールバック
 * 解決できなければ null を返す。
 */
export function resolveIconId(icon: string, provider: Provider = "aws"): string | null {
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

  // 6. AWS General カテゴリへのフォールバック（azure / gcp のみ、自プロバイダーで未解決の場合）
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

export interface IconSearchResult {
  id: string;
  name: string;
  category: string;
}

/** 大文字小文字無視の部分一致でアイコンを検索する（最大 limit 件） */
export function searchIcons(
  query?: string,
  category?: string,
  limit = 50,
  provider: Provider = "aws",
): IconSearchResult[] {
  const catalog = CATALOGS[provider];
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
  const catalog = CATALOGS[provider];
  const counts = new Map<string, number>();
  for (const e of catalog.entries) {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}
