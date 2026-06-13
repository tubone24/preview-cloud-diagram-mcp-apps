// アイコン解決モジュール。
// node.icon の文字列を icon-svgs.json のキーへ解決し、data URI とラベル用サービス名を返す。
// 4プロバイダー（aws/azure/gcp/saas）のマニフェストをマージし、provider 別に解決する。
import awsManifestJson from "../generated/aws/icon-manifest.json";
import awsIconSvgsJson from "../generated/aws/icon-svgs.json";
import azureManifestJson from "../generated/azure/icon-manifest.json";
import azureIconSvgsJson from "../generated/azure/icon-svgs.json";
import gcpManifestJson from "../generated/gcp/icon-manifest.json";
import gcpIconSvgsJson from "../generated/gcp/icon-svgs.json";
import saasManifestJson from "../generated/saas/icon-manifest.json";
import saasIconSvgsJson from "../generated/saas/icon-svgs.json";
import genericManifestJson from "../generated/generic/icon-manifest.json";
import genericIconSvgsJson from "../generated/generic/icon-svgs.json";
import type { BaseProvider, IconEntry, IconManifest, Provider } from "../shared/diagram-spec";

// ---- 全プロバイダー統合 SVGs マップ（IDはプロバイダーごとにプレフィックスで衝突しない） ----
// generic は末尾に置く（ID 衝突なし。順序は first-wins の MULTI_PROVIDER_ORDER と一致させる）
const ALL_SVGS: Record<string, string> = {
  ...(awsIconSvgsJson as Record<string, string>),
  ...(azureIconSvgsJson as Record<string, string>),
  ...(gcpIconSvgsJson as Record<string, string>),
  ...(saasIconSvgsJson as Record<string, string>),
  ...(genericIconSvgsJson as Record<string, string>),
};

// ---- プロバイダー別カタログ ----
interface ProviderCatalog {
  entries: IconEntry[];
  entryById: Map<string, IconEntry>;
  aliases: Record<string, string>;
}

function buildCatalog(manifest: IconManifest): ProviderCatalog {
  const entries: IconEntry[] = [
    ...manifest.services,
    ...manifest.resources,
    ...manifest.groups,
  ];
  return {
    entries,
    entryById: new Map(entries.map((e) => [e.id, e])),
    aliases: manifest.aliases,
  };
}

const CATALOGS: Record<BaseProvider, ProviderCatalog> = {
  aws: buildCatalog(awsManifestJson as IconManifest),
  azure: buildCatalog(azureManifestJson as IconManifest),
  gcp: buildCatalog(gcpManifestJson as IconManifest),
  saas: buildCatalog(saasManifestJson as IconManifest),
  generic: buildCatalog(genericManifestJson as IconManifest),
};

// multi モードの探索順序（generic は末尾＝first-wins で既存解決を不変に保つ）
const MULTI_PROVIDER_ORDER: BaseProvider[] = ["aws", "azure", "gcp", "saas", "generic"];

// AWS General カテゴリの汎用アイコン（全プロバイダーからフォールバックで解決可能にする）
// user, users, client, internet 等の共通概念アイコンを保持
const awsGeneralEntries: IconEntry[] = CATALOGS.aws.entries.filter(
  (e) => e.category.toLowerCase() === "general",
);
const AWS_GENERAL_IDS = new Set<string>(awsGeneralEntries.map((e) => e.id));
const awsGeneralAliasTable = new Map<string, string>(
  Object.entries((awsManifestJson as IconManifest).aliases)
    .filter(([, v]) => AWS_GENERAL_IDS.has(v))
    .map(([k, v]) => [k.toLowerCase(), v]),
);

export interface ResolvedIcon {
  /** 解決済み正規ID。解決不能なら null（フォールバックアイコン表示） */
  id: string | null;
  /** ラベルに使うサービス名（例: "Amazon EC2"）。未解決時はクエリ文字列そのまま */
  name: string;
  /** カテゴリ色 */
  color: string;
  /** SVG data URI。未解決時は null */
  dataUri: string | null;
}

const uriCache = new Map<string, string>();

/** アイコンIDから data URI を返す（4プロバイダー統合 svgs マップから引く） */
export function iconDataUri(id: string): string | null {
  const svg = ALL_SVGS[id];
  if (!svg) return null;
  let uri = uriCache.get(id);
  if (!uri) {
    uri = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    uriCache.set(id, uri);
  }
  return uri;
}

/** 指定カタログ内で query を id / alias で直接照合する */
function tryDirectInCatalog(catalog: ProviderCatalog, q: string): string | null {
  if (Object.prototype.hasOwnProperty.call(ALL_SVGS, q) && catalog.entryById.has(q)) return q;
  const alias = catalog.aliases[q];
  if (alias && Object.prototype.hasOwnProperty.call(ALL_SVGS, alias)) return alias;
  return null;
}

/** 指定カタログ内でフル解決シーケンスを試みる（完全一致 → 正規化 → プレフィックス試行 → 部分一致） */
function resolveInCatalog(catalog: ProviderCatalog, query: string, prefixes: string[]): string | null {
  // ① そのまま / alias
  let id = tryDirectInCatalog(catalog, query);
  if (id) return id;

  const lower = query.trim().toLowerCase();
  // ② 小文字化
  id = tryDirectInCatalog(catalog, lower);
  if (id) return id;

  // ③ プロバイダー別プレフィックス付与
  for (const pfx of prefixes) {
    id = tryDirectInCatalog(catalog, `${pfx}${lower}`);
    if (id) return id;
  }

  // ④ プレフィックス除去（例: "amazon-s3" → "s3"）
  for (const pfx of prefixes) {
    if (lower.startsWith(pfx)) {
      const stripped = lower.slice(pfx.length);
      id = tryDirectInCatalog(catalog, stripped);
      if (id) return id;
    }
  }

  // ⑤ 部分一致（id/name、最短id優先）
  if (lower.length >= 2) {
    // プレフィックス除去後の stripped も試す
    let stripped = lower;
    for (const pfx of prefixes) {
      if (lower.startsWith(pfx)) {
        stripped = lower.slice(pfx.length);
        break;
      }
    }
    const hits = catalog.entries.filter(
      (e) =>
        (e.id.includes(lower) ||
          e.id.includes(stripped) ||
          e.name.toLowerCase().includes(lower)) &&
        Object.prototype.hasOwnProperty.call(ALL_SVGS, e.id),
    );
    hits.sort((a, b) => a.id.length - b.id.length);
    if (hits.length > 0) return hits[0].id;
  }

  return null;
}

/** provider 別のプレフィックスリスト */
const PROVIDER_PREFIXES: Record<BaseProvider, string[]> = {
  aws: ["amazon-", "aws-"],
  azure: ["azure-"],
  gcp: ["gcp-", "google-"],
  saas: ["saas-"],
  generic: ["generic-"],
};

/**
 * プレフィックスからプロバイダーを検出する（multi モードの委譲用）
 */
function detectProviderByPrefix(normalized: string): BaseProvider | null {
  if (normalized.startsWith("azure-")) return "azure";
  if (normalized.startsWith("gcp-") || normalized.startsWith("google-")) return "gcp";
  if (normalized.startsWith("saas-")) return "saas";
  if (normalized.startsWith("generic-")) return "generic";
  if (normalized.startsWith("amazon-") || normalized.startsWith("aws-")) return "aws";
  return null;
}

const resolveCache = new Map<string, ResolvedIcon>();

/**
 * multi モードでアイコンIDを解決する（サーバー側と同一の探索順序）:
 * 1. プレフィックス検出による委譲
 * 2. 完全一致フェーズ（全カタログ横断、MULTI_PROVIDER_ORDER 順）
 * 3. 部分一致フェーズ（MULTI_PROVIDER_ORDER 順）
 * 4. AWS General フォールバック
 */
function resolveInMulti(query: string): string | null {
  // サーバー側 resolveInMulti と同一の正規化（空白・アンダースコアをハイフンに変換）
  const lower = query.trim().toLowerCase().replace(/[\s_]+/g, "-");

  // 1. プレフィックス検出による委譲
  const detectedProvider = detectProviderByPrefix(lower);
  if (detectedProvider !== null) {
    return resolveInCatalog(CATALOGS[detectedProvider], query, PROVIDER_PREFIXES[detectedProvider]);
  }

  // 2. 完全一致フェーズ（全カタログ横断）
  for (const provider of MULTI_PROVIDER_ORDER) {
    const catalog = CATALOGS[provider];
    const prefixes = PROVIDER_PREFIXES[provider];

    // 直接一致
    let id = tryDirectInCatalog(catalog, query);
    if (id) return id;
    id = tryDirectInCatalog(catalog, lower);
    if (id) return id;

    // プレフィックス付与一致
    for (const pfx of prefixes) {
      id = tryDirectInCatalog(catalog, `${pfx}${lower}`);
      if (id) return id;
    }

    // プレフィックス除去一致
    for (const pfx of prefixes) {
      if (lower.startsWith(pfx)) {
        const stripped = lower.slice(pfx.length);
        id = tryDirectInCatalog(catalog, stripped);
        if (id) return id;
      }
    }

    // GCP 限定: "google-" → "gcp-" 読み替え
    if (provider === "gcp" && lower.startsWith("google-")) {
      const replaced = "gcp-" + lower.slice("google-".length);
      id = tryDirectInCatalog(catalog, replaced);
      if (id) return id;
    }
  }

  // 3. 部分一致フェーズ（MULTI_PROVIDER_ORDER 順、サーバーと同一: 宣言順最初のエントリ採用、ソートなし）
  for (const provider of MULTI_PROVIDER_ORDER) {
    const catalog = CATALOGS[provider];
    // id 部分一致 → name 部分一致の順でサーバーと同じ宣言順採用
    const byId = catalog.entries.find((e) => e.id.includes(lower));
    if (byId) return byId.id;
    const byName = catalog.entries.find((e) => e.name.toLowerCase().includes(lower));
    if (byName) return byName.id;
  }

  // 4. AWS General フォールバック（サーバーと同一: 完全一致 → id部分一致 → name部分一致）
  // 4a. General プール alias / id 完全一致
  if (AWS_GENERAL_IDS.has(lower)) return lower;
  const generalAliased = awsGeneralAliasTable.get(lower);
  if (generalAliased && AWS_GENERAL_IDS.has(generalAliased)) return generalAliased;
  // 4b. General エントリへの部分一致（id → name、宣言順）
  const generalByIdPartial = awsGeneralEntries.find((e) => e.id.includes(lower));
  if (generalByIdPartial) return generalByIdPartial.id;
  const generalByNamePartial = awsGeneralEntries.find((e) => e.name.toLowerCase().includes(lower));
  if (generalByNamePartial) return generalByNamePartial.id;

  return null;
}

/**
 * 解決順:
 *   - multi モード: resolveInMulti（サーバー側と同一の探索順序）
 *   - それ以外: 指定 provider カタログ内で完全一致/alias → 小文字化 → プレフィックス試行 →
 *      プレフィックス除去 → 部分一致（最短id優先）、その後 AWS General フォールバック
 *
 * キャッシュキーは `${provider}:${query}`
 */
export function resolveIcon(query: string, provider: Provider = "aws"): ResolvedIcon {
  const cacheKey = `${provider}:${query}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  let id: string | null = null;

  if (provider === "multi") {
    id = resolveInMulti(query);
  } else {
    const catalog = CATALOGS[provider];
    const prefixes = PROVIDER_PREFIXES[provider];

    id = resolveInCatalog(catalog, query, prefixes);

    // フォールバック: AWS General カテゴリのアイコン（provider 非依存の汎用概念）
    if (!id && provider !== "aws") {
      const awsCatalog = CATALOGS.aws;
      const awsPrefixes = PROVIDER_PREFIXES.aws;
      const fallbackId = resolveInCatalog(awsCatalog, query, awsPrefixes);
      if (fallbackId && AWS_GENERAL_IDS.has(fallbackId)) {
        id = fallbackId;
      }
    }
  }

  // id が得られた場合、エントリはプロバイダーカタログ → 全カタログの順で引く
  let entry: IconEntry | undefined;
  if (id) {
    if (provider !== "multi") {
      entry = CATALOGS[provider].entryById.get(id);
    }
    if (!entry) {
      // multi モード または フォールバックで別プロバイダーのアイコンを引いた場合
      for (const p of MULTI_PROVIDER_ORDER) {
        entry = CATALOGS[p].entryById.get(id);
        if (entry) break;
      }
    }
  }

  const result: ResolvedIcon = {
    id,
    name: entry?.name ?? query,
    color: entry?.color ?? "#7D8998",
    dataUri: id ? iconDataUri(id) : null,
  };
  resolveCache.set(cacheKey, result);
  return result;
}
