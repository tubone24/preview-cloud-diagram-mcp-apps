// アイコン解決モジュール。
// node.icon の文字列を icon-svgs.json のキーへ解決し、data URI とラベル用サービス名を返す。
// 3プロバイダー（aws/azure/gcp）のマニフェストをマージし、provider 別に解決する。
import awsManifestJson from "../generated/aws/icon-manifest.json";
import awsIconSvgsJson from "../generated/aws/icon-svgs.json";
import azureManifestJson from "../generated/azure/icon-manifest.json";
import azureIconSvgsJson from "../generated/azure/icon-svgs.json";
import gcpManifestJson from "../generated/gcp/icon-manifest.json";
import gcpIconSvgsJson from "../generated/gcp/icon-svgs.json";
import type { IconEntry, IconManifest, Provider } from "../shared/diagram-spec";

// ---- 全プロバイダー統合 SVGs マップ（IDはプロバイダーごとにプレフィックスで衝突しない） ----
const ALL_SVGS: Record<string, string> = {
  ...(awsIconSvgsJson as Record<string, string>),
  ...(azureIconSvgsJson as Record<string, string>),
  ...(gcpIconSvgsJson as Record<string, string>),
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

const CATALOGS: Record<Provider, ProviderCatalog> = {
  aws: buildCatalog(awsManifestJson as IconManifest),
  azure: buildCatalog(azureManifestJson as IconManifest),
  gcp: buildCatalog(gcpManifestJson as IconManifest),
};

// AWS General カテゴリの汎用アイコン（全プロバイダーからフォールバックで解決可能にする）
// user, users, client, internet 等の共通概念アイコンを保持
const AWS_GENERAL_IDS = new Set<string>(
  CATALOGS.aws.entries
    .filter((e) => e.category.toLowerCase() === "general")
    .map((e) => e.id),
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

/** アイコンIDから data URI を返す（3プロバイダー統合 svgs マップから引く） */
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
const PROVIDER_PREFIXES: Record<Provider, string[]> = {
  aws: ["amazon-", "aws-"],
  azure: ["azure-"],
  gcp: ["gcp-", "google-"],
};

const resolveCache = new Map<string, ResolvedIcon>();

/**
 * 解決順:
 *   1. 指定 provider カタログ内で: 完全一致/alias → 小文字化 → プレフィックス試行 →
 *      プレフィックス除去 → 部分一致（最短id優先）
 *   2. 未解決時フォールバック: AWS General カテゴリのアイコン（user, users, client, internet 等）
 *      を全プロバイダーから解決可能にする
 *   3. それでも未解決なら null
 *
 * キャッシュキーは `${provider}:${query}`
 */
export function resolveIcon(query: string, provider: Provider = "aws"): ResolvedIcon {
  const cacheKey = `${provider}:${query}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  const catalog = CATALOGS[provider];
  const prefixes = PROVIDER_PREFIXES[provider];

  let id = resolveInCatalog(catalog, query, prefixes);

  // フォールバック: AWS General カテゴリのアイコン（provider 非依存の汎用概念）
  if (!id && provider !== "aws") {
    const awsCatalog = CATALOGS.aws;
    const awsPrefixes = PROVIDER_PREFIXES.aws;
    const fallbackId = resolveInCatalog(awsCatalog, query, awsPrefixes);
    if (fallbackId && AWS_GENERAL_IDS.has(fallbackId)) {
      id = fallbackId;
    }
  }

  // id が得られた場合、エントリはプロバイダーカタログ → AWS General の順で引く
  let entry = id ? catalog.entryById.get(id) : undefined;
  if (!entry && id) {
    // フォールバックで AWS General から解決した場合
    entry = CATALOGS.aws.entryById.get(id);
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
