// アイコンID解決・検索ユーティリティ。
// src/generated/icon-manifest.json（build:icons の生成物）を唯一のソースとする。

import manifestJson from "../generated/icon-manifest.json";
import type { IconEntry, IconManifest } from "../shared/diagram-spec";

const manifest = manifestJson as IconManifest;

/** services + resources + groups を結合した全エントリ */
export const allIconEntries: IconEntry[] = [
  ...manifest.services,
  ...manifest.resources,
  ...manifest.groups,
];

const entryById = new Map<string, IconEntry>(allIconEntries.map((e) => [e.id, e]));

/** 別名キーを小文字化したテーブル（"s3" → "amazon-simple-storage-service"） */
const aliasTable = new Map<string, string>(
  Object.entries(manifest.aliases).map(([k, v]) => [k.toLowerCase(), v]),
);

/** idまたはaliasの完全一致を試す。当たれば正規IDを返す */
function lookupExact(candidate: string): string | undefined {
  if (entryById.has(candidate)) return candidate;
  const aliased = aliasTable.get(candidate);
  if (aliased && entryById.has(aliased)) return aliased;
  return undefined;
}

/**
 * アイコンIDを正規IDに解決する。解決順:
 * 1. そのまま（manifestのid）
 * 2. aliases テーブル
 * 3. 小文字化・空白→ハイフン化して再試行
 * 4. "amazon-" / "aws-" プレフィックスを付与して再試行
 * 5. プレフィックスを剥がして再試行
 * 6. id・name への部分一致（最初の候補）
 * 解決できなければ null を返す。
 */
export function resolveIconId(icon: string): string | null {
  const direct = lookupExact(icon);
  if (direct) return direct;

  const normalized = icon.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const lower = lookupExact(normalized);
  if (lower) return lower;

  for (const prefix of ["amazon-", "aws-"]) {
    if (!normalized.startsWith(prefix)) {
      const prefixed = lookupExact(prefix + normalized);
      if (prefixed) return prefixed;
    }
  }

  const stripped = normalized.replace(/^(amazon-|aws-)/, "");
  if (stripped !== normalized) {
    const hit = lookupExact(stripped);
    if (hit) return hit;
  }

  // 部分一致（id優先、次にname）
  const partial =
    allIconEntries.find((e) => e.id.includes(normalized)) ??
    allIconEntries.find((e) => e.name.toLowerCase().includes(normalized));
  if (partial) return partial.id;

  return null;
}

export interface IconSearchResult {
  id: string;
  name: string;
  category: string;
}

/** 大文字小文字無視の部分一致でアイコンを検索する（最大 limit 件） */
export function searchIcons(query?: string, category?: string, limit = 50): IconSearchResult[] {
  let entries = allIconEntries;

  if (category) {
    const c = category.trim().toLowerCase();
    entries = entries.filter((e) => e.category.toLowerCase().includes(c));
  }

  if (query) {
    const q = query.trim().toLowerCase();
    // エイリアスキーに部分一致した場合、その正規IDもヒット扱いにする
    const aliasHits = new Set<string>();
    for (const [alias, id] of aliasTable) {
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
export function categorySummary(): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of allIconEntries) {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}

/** エイリアス総数（サマリ表示用） */
export const aliasCount = aliasTable.size;
