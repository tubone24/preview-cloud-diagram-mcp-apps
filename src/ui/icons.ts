// アイコン解決モジュール。
// node.icon の文字列を icon-svgs.json のキーへ解決し、data URI とラベル用サービス名を返す。
import manifestJson from "../generated/icon-manifest.json";
import iconSvgsJson from "../generated/icon-svgs.json";
import type { IconEntry, IconManifest } from "../shared/diagram-spec";

const MANIFEST = manifestJson as IconManifest;
const SVGS: Record<string, string> = iconSvgsJson;

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

const ALL_ENTRIES: IconEntry[] = [
  ...MANIFEST.services,
  ...MANIFEST.resources,
  ...MANIFEST.groups,
];
const ENTRY_BY_ID = new Map<string, IconEntry>(ALL_ENTRIES.map((e) => [e.id, e]));

const uriCache = new Map<string, string>();

/** アイコンIDから data URI を返す（<image href> 用。id衝突を避けるためインラインSVGは使わない） */
export function iconDataUri(id: string): string | null {
  const svg = SVGS[id];
  if (!svg) return null;
  let uri = uriCache.get(id);
  if (!uri) {
    uri = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    uriCache.set(id, uri);
  }
  return uri;
}

function tryDirect(q: string): string | null {
  if (Object.prototype.hasOwnProperty.call(SVGS, q)) return q;
  const alias = MANIFEST.aliases[q];
  if (alias && Object.prototype.hasOwnProperty.call(SVGS, alias)) return alias;
  return null;
}

const resolveCache = new Map<string, ResolvedIcon>();

/**
 * 解決順: そのまま → aliases → 小文字化 → amazon-/aws- プレフィックス付与 →
 * manifest 内の部分一致（id/name） → null（フォールバック）
 */
export function resolveIcon(query: string): ResolvedIcon {
  const cached = resolveCache.get(query);
  if (cached) return cached;

  let id = tryDirect(query);
  if (!id) {
    const lower = query.trim().toLowerCase();
    id =
      tryDirect(lower) ??
      tryDirect(`amazon-${lower}`) ??
      tryDirect(`aws-${lower}`);
    if (!id && lower.length >= 2) {
      const hit = ALL_ENTRIES.find(
        (e) => e.id.includes(lower) || e.name.toLowerCase().includes(lower),
      );
      if (hit && Object.prototype.hasOwnProperty.call(SVGS, hit.id)) id = hit.id;
    }
  }

  const entry = id ? ENTRY_BY_ID.get(id) : undefined;
  const result: ResolvedIcon = {
    id,
    name: entry?.name ?? query,
    color: entry?.color ?? "#7D8998",
    dataUri: id ? iconDataUri(id) : null,
  };
  resolveCache.set(query, result);
  return result;
}
