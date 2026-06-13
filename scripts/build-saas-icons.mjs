#!/usr/bin/env node
/**
 * build-saas-icons.mjs
 * SaaS / mBaaS アイコンを simple-icons と公式アセットから取り込み、
 * ミニファイ済みSVGとマニフェストJSONを生成するビルドスクリプト。
 *
 * Usage:
 *   node scripts/build-saas-icons.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  minifySvg,
  validateAliases,
  writeGeneratedJson,
} from './lib/icon-build-common.mjs';
import { SAAS_CATALOG } from './saas-icon-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets', 'saas-icons');
const OUT_GENERATED_DIR = path.join(PROJECT_ROOT, 'src', 'generated', 'saas');

/**
 * ブランドカラーが白に近い（相対輝度が高い）かチェックする。
 * 輝度 > 0.85 を「ほぼ白」と判定する。
 * @param {string} hex - 6文字の16進カラーコード（#なし）
 * @returns {boolean}
 */
function isNearlyWhite(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.85;
}

/**
 * simple-icons からアイコンデータを取得する。
 * @param {string} siSlug - simple-icons のエクスポート名（例: "siVercel"）
 * @returns {{ hex: string, path: string, title: string }}
 */
async function getSimpleIcon(siSlug) {
  const si = await import('simple-icons');
  const icon = si[siSlug];
  if (!icon) {
    throw new Error(`simple-icons: "${siSlug}" not found. Check the slug in saas-icon-catalog.mjs.`);
  }
  return icon;
}

/**
 * tile モード用 SVG を合成する。
 * 角丸タイル背景 + 白抜きグリフ（元パスを 75% スケール、中央寄せ）。
 * @param {string} hex - ブランドカラー hex（#なし）
 * @param {string} iconPath - simple-icons の SVG path d属性値
 * @returns {string}
 */
function buildTileSvg(hex, iconPath) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#${hex}"/><path fill="#FFFFFF" transform="translate(3,3) scale(0.75)" d="${iconPath}"/></svg>`;
}

/**
 * 通常モード用 SVG を合成する（simple-icons path から）。
 * @param {string} fill - fillカラー（#付き）
 * @param {string} iconPath - simple-icons の SVG path d属性値
 * @returns {string}
 */
function buildSimpleSvg(fill, iconPath) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="${iconPath}"/></svg>`;
}

async function main() {
  console.log('Building SaaS icons...');
  console.log(`Assets dir : ${ASSETS_DIR}`);
  console.log(`Output dir : ${OUT_GENERATED_DIR}`);
  console.log('');

  const services = [];
  const svgMap = {};
  const tileApplied = [];
  const whiteLuminanceWarnings = [];

  for (const entry of SAAS_CATALOG) {
    const { id, name, category, siSlug, officialFile, fill, tile, aliases: _aliases } = entry;

    process.stdout.write(`  Processing ${id} ...`);

    let svgString;
    let colorHex;

    if (officialFile) {
      // 公式SVGファイルを優先使用
      const officialPath = path.join(ASSETS_DIR, officialFile);
      let raw;
      try {
        raw = await readFile(officialPath, 'utf8');
      } catch {
        throw new Error(
          `[FATAL] officialFile "${officialFile}" specified for "${id}" but not found at: ${officialPath}`,
        );
      }
      svgString = minifySvg(raw);

      // カラーは simple-icons から取得（公式SVGでも color フィールド用に必要）
      const siIcon = await getSimpleIcon(siSlug);
      colorHex = fill ?? siIcon.hex;

      console.log(` official SVG (color: #${colorHex})`);
    } else {
      // simple-icons からSVGを合成
      const siIcon = await getSimpleIcon(siSlug);
      colorHex = fill ?? siIcon.hex;

      // 輝度ガード: ブランドカラーがほぼ白なのに tile でも fill 指定でもない場合は警告
      if (isNearlyWhite(colorHex) && !tile && fill == null) {
        whiteLuminanceWarnings.push(
          `  [warn] "${id}" has a near-white brand color (#${colorHex}) but tile=false and no fill override. ` +
          `Consider setting tile: true in saas-icon-catalog.mjs.`,
        );
      }

      if (tile) {
        svgString = minifySvg(buildTileSvg(colorHex, siIcon.path));
        tileApplied.push(id);
        console.log(` tile mode (bg: #${colorHex})`);
      } else {
        const fillColor = fill ? fill : `#${colorHex}`;
        svgString = minifySvg(buildSimpleSvg(fillColor, siIcon.path));
        console.log(` simple-icons (color: #${colorHex})`);
      }
    }

    svgMap[id] = svgString;
    services.push({ id, name, category, color: `#${colorHex}` });
  }

  // 輝度ガード警告を出力
  if (whiteLuminanceWarnings.length > 0) {
    console.log('');
    for (const w of whiteLuminanceWarnings) {
      console.warn(w);
    }
  }

  // エイリアスマップ構築
  const aliases = {};
  for (const entry of SAAS_CATALOG) {
    for (const alias of entry.aliases) {
      aliases[alias] = entry.id;
    }
  }

  // 全ID セット
  const allIds = new Set(Object.keys(svgMap));

  // エイリアス検証
  console.log('');
  console.log('Validating aliases...');
  validateAliases(aliases, allIds);

  // manifest 構築
  const manifest = {
    services,
    resources: [],
    groups: [],
    aliases,
  };

  // 出力
  console.log('Writing output...');
  writeGeneratedJson(OUT_GENERATED_DIR, manifest, svgMap);

  // 必須ID検証（fail-fast）
  const REQUIRED_IDS = [
    'saas-vercel',
    'saas-supabase',
    'saas-github',
    'saas-firebase',
  ];
  const missingRequired = REQUIRED_IDS.filter((id) => !allIds.has(id));

  console.log('');
  console.log('=== Summary ===');
  console.log(`Services   : ${services.length}`);
  console.log(`Aliases    : ${Object.keys(aliases).length} (all validated)`);
  if (tileApplied.length > 0) {
    console.log(`Tile mode  : ${tileApplied.join(', ')}`);
  } else {
    console.log(`Tile mode  : (none)`);
  }

  const requiredStatus = REQUIRED_IDS.map((id) =>
    allIds.has(id) ? `${id} ✓` : `${id} ✗`,
  ).join(', ');
  console.log(`Required IDs: ${requiredStatus}`);

  if (missingRequired.length > 0) {
    console.error(
      `\nERROR: Required IDs not found: ${missingRequired.join(', ')}`,
    );
    process.exit(1);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
