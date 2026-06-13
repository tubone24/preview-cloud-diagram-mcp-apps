#!/usr/bin/env node
/**
 * build-generic-icons.mjs
 * 汎用（generic）プロバイダー用アイコンを生成するビルドスクリプト。
 *
 * 流用方針:
 *   AWS 公式 SVG（assets/aws-icons/ 配下）を読み込み、「白以外の全色を #232F3D に
 *   正規化」してベンダー中立アイコンに変換する。
 *   → orange / magenta / green / purple / 2種グレー など多色のソースを一律で中立化する。
 *   → #FFF / #FFFFFF（グループや色付きservice系の白抜きグリフ）は必ず保持する。
 *   → fill="none" / fill="url(#...)" / id 属性は不変。
 *
 * Usage:
 *   node scripts/build-generic-icons.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  minifySvg,
  validateAliases,
  writeGeneratedJson,
} from './lib/icon-build-common.mjs';
import { GENERIC_CATALOG } from './generic-icon-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets', 'aws-icons');
const OUT_GENERATED_DIR = path.join(PROJECT_ROOT, 'src', 'generated', 'generic');

/** 中立化後の唯一の色（AWS の濃紺グレー）。元 SVG の General 系線画と同色。 */
const NEUTRAL_COLOR = '#232F3D';

/** 保持すべき白の判定（3桁/6桁、大文字小文字無視） */
const WHITE_RE = /^#(?:fff|ffffff)$/i;

/**
 * 単一の hex カラー（先頭 # 付き）を中立化する。
 * 白（#fff/#ffffff）はそのまま、それ以外は NEUTRAL_COLOR に置換する。
 * @param {string} hex
 * @returns {string}
 */
function neutralizeColor(hex) {
  return WHITE_RE.test(hex) ? hex : NEUTRAL_COLOR;
}

/**
 * SVG 内の fill / stroke の色を中立化する。
 *
 * 厳密に以下の2形態のみを対象にアンカーする:
 *   1. 属性形式:   (fill|stroke)="#hex"
 *   2. inline style: (fill|stroke):#hex   （style="...":  fill:#abc; など）
 *
 * hex は6桁を先に評価する（先に3桁を許すと "#8C4FFF" が "#8C4" で部分マッチして壊れる）。
 * "none" / "url(#...)" / id 属性は hex に一致しないため不変。
 * @param {string} svg
 * @returns {string}
 */
function neutralizeFill(svg) {
  // 1. 属性形式: fill="#aabbcc" / stroke="#abc"
  let out = svg.replace(
    /(fill|stroke)="(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})"/g,
    (_m, attr, hex) => `${attr}="${neutralizeColor(hex)}"`,
  );
  // 2. inline style 形式: fill:#aabbcc / stroke: #abc
  out = out.replace(
    /(fill|stroke)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/g,
    (_m, attr, hex) => `${attr}:${neutralizeColor(hex)}`,
  );
  return out;
}

async function main() {
  console.log('Building generic icons...');
  console.log(`Assets dir : ${ASSETS_DIR}`);
  console.log(`Output dir : ${OUT_GENERATED_DIR}`);
  console.log('');

  const resources = [];
  const groups = [];
  const svgMap = {};
  const aliases = {};
  /** alias キー重複ガード */
  const aliasSeen = new Map();

  for (const entry of GENERIC_CATALOG) {
    const { id, name, category, sourceFile, aliases: entryAliases, kind } = entry;

    process.stdout.write(`  Processing ${id} ...`);

    // ソース SVG 読み込み
    const srcPath = path.join(ASSETS_DIR, sourceFile);
    let raw;
    try {
      raw = await readFile(srcPath, 'utf8');
    } catch {
      throw new Error(
        `[FATAL] sourceFile "${sourceFile}" specified for "${id}" but not found at: ${srcPath}`,
      );
    }

    // 中立化 → ミニファイ
    const neutralized = neutralizeFill(raw);
    svgMap[id] = minifySvg(neutralized);

    const iconEntry = { id, name, category, color: NEUTRAL_COLOR };
    if (kind === 'group') {
      groups.push(iconEntry);
    } else {
      resources.push(iconEntry);
    }

    // エイリアス収集（重複ガード）
    for (const alias of entryAliases) {
      const key = alias.toLowerCase();
      if (aliasSeen.has(key)) {
        throw new Error(
          `[FATAL] duplicate alias "${alias}" in generic catalog: ${aliasSeen.get(key)} and ${id}`,
        );
      }
      aliasSeen.set(key, id);
      aliases[alias] = id;
    }

    console.log(` ${kind === 'group' ? 'group' : 'resource'} (from ${sourceFile})`);
  }

  // 全ID セット
  const allIds = new Set(Object.keys(svgMap));

  // エイリアス検証
  console.log('');
  console.log('Validating aliases...');
  validateAliases(aliases, allIds);

  // manifest 構築（generic は services を持たない）
  const manifest = {
    services: [],
    resources,
    groups,
    aliases,
  };

  // 出力
  console.log('Writing output...');
  writeGeneratedJson(OUT_GENERATED_DIR, manifest, svgMap);

  // 必須ID検証（fail-fast）
  const REQUIRED_IDS = [
    'generic-server',
    'generic-database',
    'generic-router',
    'generic-user',
    'generic-load-balancer',
    'generic-corporate-data-center',
  ];
  const missingRequired = REQUIRED_IDS.filter((id) => !allIds.has(id));

  console.log('');
  console.log('=== Summary ===');
  console.log(`Resources : ${resources.length}`);
  console.log(`Groups    : ${groups.length}`);
  console.log(`Aliases   : ${Object.keys(aliases).length} (all validated)`);

  const requiredStatus = REQUIRED_IDS.map((id) =>
    allIds.has(id) ? `${id} ✓` : `${id} ✗`,
  ).join(', ');
  console.log(`Required IDs: ${requiredStatus}`);

  if (missingRequired.length > 0) {
    console.error(`\nERROR: Required IDs not found: ${missingRequired.join(', ')}`);
    process.exit(1);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
