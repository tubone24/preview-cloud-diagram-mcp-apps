#!/usr/bin/env node
/**
 * icon-build-common.mjs
 * AWS / Azure / GCP アイコンビルドスクリプト共通ライブラリ。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * SVG軽量ミニファイ。id属性やurl(#...)参照は壊さない。
 * @param {string} svg
 * @returns {string}
 */
export function minifySvg(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '') // XML宣言除去
    .replace(/<!--[\s\S]*?-->/g, '') // コメント除去
    .replace(/<title>[\s\S]*?<\/title>/g, '') // title除去
    .replace(/>\s+</g, '><') // タグ間の改行・空白を圧縮
    .replace(/\s{2,}/g, ' ') // 連続空白を1つに
    .trim();
}

/**
 * 文字列をkebab-case化する。
 * 空白・アンダースコア→ハイフン、小文字化、連続ハイフン圧縮、英数とハイフン以外除去。
 * @param {string} name
 * @returns {string}
 */
export function toKebabCase(name) {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // 空白・アンダースコア → ハイフン
    .replace(/[^a-z0-9-]/g, '') // 英数とハイフン以外を除去
    .replace(/-{2,}/g, '-') // 連続ハイフンを圧縮
    .replace(/^-+|-+$/g, ''); // 先頭・末尾のハイフンを除去
}

/**
 * エイリアス右辺が validIds に存在しないものを列挙して throw（fail-fast）。
 * @param {Record<string, string>} aliases - エイリアスマップ（短縮名 → 正規ID）
 * @param {Set<string> | Map<string, unknown>} validIds - 有効なIDのセット or マップ
 * @throws {Error} 存在しないIDが1件以上ある場合
 */
export function validateAliases(aliases, validIds) {
  const has = (id) =>
    validIds instanceof Map ? validIds.has(id) : validIds.has(id);

  const missing = Object.entries(aliases).filter(([, target]) => !has(target));
  if (missing.length > 0) {
    const lines = missing
      .map(([alias, target]) => `  ${alias} -> ${target} (not found in manifest)`)
      .join('\n');
    throw new Error(
      `ERROR: the following aliases resolve to non-existent icon IDs:\n${lines}`,
    );
  }
}

/**
 * 生成済みJSONファイルを outDir に書き出す。
 * outDir が存在しない場合は再帰的に作成する。
 * 出力ファイル:
 *   - icon-manifest.json  … JSON.stringify(manifest, null, 2)
 *   - icon-svgs.json      … JSON.stringify(svgMap) （インデントなし）
 *
 * @param {string} outDir - 出力先ディレクトリの絶対パス
 * @param {object} manifest - { services, resources, groups, aliases } 形式のマニフェスト
 * @param {Record<string, string>} svgMap - { [iconId]: minifiedSvgString }
 */
export function writeGeneratedJson(outDir, manifest, svgMap) {
  mkdirSync(outDir, { recursive: true });

  const manifestJson = JSON.stringify(manifest, null, 2);
  const svgsJson = JSON.stringify(svgMap);

  writeFileSync(path.join(outDir, 'icon-manifest.json'), manifestJson, 'utf8');
  writeFileSync(path.join(outDir, 'icon-svgs.json'), svgsJson, 'utf8');

  const serviceCount = manifest.services?.length ?? 0;
  const resourceCount = manifest.resources?.length ?? 0;
  const groupCount = manifest.groups?.length ?? 0;
  const aliasCount = Object.keys(manifest.aliases ?? {}).length;

  console.log(`Wrote ${outDir}`);
  console.log(
    `  services: ${serviceCount}, resources: ${resourceCount}, groups: ${groupCount}, aliases: ${aliasCount}`,
  );
  console.log(
    `  icon-manifest.json: ${Buffer.byteLength(manifestJson)} bytes`,
  );
  console.log(
    `  icon-svgs.json    : ${Buffer.byteLength(svgsJson)} bytes`,
  );
}
