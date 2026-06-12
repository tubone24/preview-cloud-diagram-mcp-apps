#!/usr/bin/env node
/**
 * build-azure-icons.mjs
 * Azure公式アイコンアセットからアイコンを取り込み、
 * ミニファイ済みSVGとマニフェストJSONを生成するビルドスクリプト。
 *
 * Usage:
 *   node scripts/build-azure-icons.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  minifySvg,
  toKebabCase,
  validateAliases,
  writeGeneratedJson,
} from './lib/icon-build-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ICONS_DIR = path.join(PROJECT_ROOT, '参考', 'Azure_Public_Service_Icons', 'Icons');
const OUT_GENERATED_DIR = path.join(PROJECT_ROOT, 'src', 'generated', 'azure');

const AZURE_COLOR = '#0078D4';

/**
 * カテゴリフォルダ名 → 表示名
 * 全29カテゴリを網羅
 */
const CATEGORY_DISPLAY_MAP = {
  'ai + machine learning':  'AI + Machine Learning',
  'analytics':              'Analytics',
  'app services':           'App Services',
  'azure ecosystem':        'Azure Ecosystem',
  'azure stack':            'Azure Stack',
  'blockchain':             'Blockchain',
  'compute':                'Compute',
  'containers':             'Containers',
  'databases':              'Databases',
  'devops':                 'DevOps',
  'general':                'General',
  'hybrid + multicloud':    'Hybrid + Multicloud',
  'identity':               'Identity',
  'integration':            'Integration',
  'intune':                 'Intune',
  'iot':                    'IoT',
  'management + governance': 'Management + Governance',
  'menu':                   'Menu',
  'migrate':                'Migrate',
  'migration':              'Migration',
  'mixed reality':          'Mixed Reality',
  'mobile':                 'Mobile',
  'monitor':                'Monitor',
  'networking':             'Networking',
  'new icons':              'New Icons',
  'other':                  'Other',
  'security':               'Security',
  'storage':                'Storage',
  'web':                    'Web',
};

/**
 * カテゴリ優先順（先勝ちdedup用）
 * 仕様: compute, networking, databases, storage, web, containers,
 *       ai + machine learning, analytics, integration, security, identity,
 *       devops, iot の順 → その他(アルファベット順) → general, azure stack, other, menu, new icons
 */
const CATEGORY_PRIORITY = [
  'compute',
  'networking',
  'databases',
  'storage',
  'web',
  'containers',
  'ai + machine learning',
  'analytics',
  'integration',
  'security',
  'identity',
  'devops',
  'iot',
];

/** 最低優先カテゴリ（後ろから順に最低優先） */
const CATEGORY_LOWEST_PRIORITY = ['new icons', 'menu', 'other', 'azure stack', 'general'];

/**
 * カテゴリの優先度スコアを返す（小さいほど優先）
 * @param {string} category
 * @returns {number}
 */
function categoryPriorityScore(category) {
  const idx = CATEGORY_PRIORITY.indexOf(category);
  if (idx !== -1) return idx; // 0 〜 12

  const lowestIdx = CATEGORY_LOWEST_PRIORITY.indexOf(category);
  if (lowestIdx !== -1) {
    // general(4) → new icons(0) の逆順で大きい値
    return 1000 + (CATEGORY_LOWEST_PRIORITY.length - 1 - lowestIdx);
  }

  // その他カテゴリはアルファベット順で中間
  return 100 + category.charCodeAt(0);
}

/**
 * ファイル名からアイコンIDを生成する。
 * 形式: {5桁数字}-icon-service-{サービス名}.svg
 * 1. 数字プレフィックス + `-icon-service-` を除去
 * 2. 括弧とその中身を除去
 * 3. toKebabCase
 * 4. azure- プレフィックス付与（二重禁止）
 * @param {string} filename
 * @returns {string}
 */
function fileNameToId(filename) {
  // 拡張子除去
  let name = filename.replace(/\.svg$/i, '');
  // 数字プレフィックス + -icon-service- 除去（数字は5桁以上対応）
  name = name.replace(/^\d+-icon-service-/, '');
  // 括弧とその中身を除去（半角）
  name = name.replace(/\([^)]*\)/g, '');
  // kebab化
  const kebab = toKebabCase(name);
  // azure- プレフィックス付与（二重禁止）
  if (kebab.startsWith('azure-')) {
    return kebab;
  }
  return `azure-${kebab}`;
}

/**
 * IDから表示名を生成（ハイフンをスペースに変換し、各単語を Title Case に）
 * azure- プレフィックスを除去してから変換。
 * @param {string} id
 * @returns {string}
 */
function idToName(id) {
  // azure- プレフィックスを除去
  const withoutPrefix = id.startsWith('azure-') ? id.slice('azure-'.length) : id;
  return withoutPrefix
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * SVGファイル内の id="..." 属性を抽出する。
 * @param {string} svg
 * @returns {string[]}
 */
function extractSvgIds(svg) {
  const matches = svg.matchAll(/\bid="([^"]+)"/g);
  return [...matches].map((m) => m[1]);
}

/**
 * 全カテゴリのアイコンを収集し、dedup処理を行う。
 * @returns {Promise<{icons: Array, skipped: number}>}
 */
async function collectIcons() {
  // カテゴリディレクトリ一覧を取得
  const entries = await readdir(ICONS_DIR, { withFileTypes: true });
  const categoryDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // 全アイコン候補を収集（ID, カテゴリ, ファイル名, パス）
  /** @type {Array<{id: string, category: string, filename: string, srcPath: string, priority: number}>} */
  const candidates = [];

  for (const catDir of categoryDirs) {
    if (!CATEGORY_DISPLAY_MAP[catDir]) {
      console.warn(`[warn] Unknown category directory: ${catDir} (skipping)`);
      continue;
    }

    const catPath = path.join(ICONS_DIR, catDir);
    let files;
    try {
      files = await readdir(catPath);
    } catch {
      console.warn(`[warn] Cannot read directory: ${catPath}`);
      continue;
    }

    const svgFiles = files.filter((f) => f.endsWith('.svg')).sort();
    const catPriority = categoryPriorityScore(catDir);

    for (const filename of svgFiles) {
      const id = fileNameToId(filename);
      candidates.push({
        id,
        category: catDir,
        filename,
        srcPath: path.join(catPath, filename),
        priority: catPriority,
      });
    }
  }

  // dedup: 同一IDが複数カテゴリにある場合、優先順で先勝ち
  // 同一優先度はファイル名ソート（既にソート済みなので先着）
  /** @type {Map<string, {id: string, category: string, filename: string, srcPath: string}>} */
  const seen = new Map();
  let skippedCount = 0;

  // 優先度昇順 → 同優先度はファイル名順（既ソート済み）でソート
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.filename.localeCompare(b.filename);
  });

  const icons = [];
  for (const cand of candidates) {
    if (seen.has(cand.id)) {
      const kept = seen.get(cand.id);
      console.log(
        `  [skip] ${cand.id}: ${cand.category}/${cand.filename} skipped (kept: ${kept.category}/${kept.filename})`,
      );
      skippedCount++;
      continue;
    }
    seen.set(cand.id, { id: cand.id, category: cand.category, filename: cand.filename, srcPath: cand.srcPath });
    icons.push(cand);
  }

  return { icons, skippedCount };
}

// エイリアスマップ（右辺は生成IDに合わせて調整）
// ファイル名から導出したID一覧を元に設定
const ALIASES = {
  // VM系
  'vm':               'azure-virtual-machine',
  'vmss':             'azure-vm-scale-sets',
  // Kubernetes
  'aks':              'azure-kubernetes-services',
  // Functions / App Service
  'functions':        'azure-function-apps',
  'app-service':      'azure-app-services',
  // Databases
  'sql':              'azure-sql-database',
  'cosmos':           'azure-cosmos-db',
  'cosmosdb':         'azure-cosmos-db',
  // Storage
  'storage-account':  'azure-storage-accounts',
  'blob':             'azure-blob-block',
  // Networking
  'vnet':             'azure-virtual-networks',
  'nsg':              'azure-network-security-groups',
  'lb':               'azure-load-balancers',
  'app-gateway':      'azure-application-gateways',
  'agw':              'azure-application-gateways',
  'front-door':       'azure-front-door-and-cdn-profiles',
  // Integration / API
  'apim':             'azure-api-management-services',
  // Containers
  'acr':              'azure-container-registries',
  'aci':              'azure-container-instances',
  // Security
  'key-vault':        'azure-key-vaults',
  'keyvault':         'azure-key-vaults',
  // Identity
  'entra-id':         'azure-entra-domain-services',
  'aad':              'azure-entra-domain-services',
  'active-directory': 'azure-entra-domain-services',
  // Messaging
  'event-hub':        'azure-event-hubs',
  'service-bus':      'azure-service-bus',
  'event-grid':       'azure-event-grid-topics',
  // Monitoring / Logging
  'log-analytics':    'azure-log-analytics-workspaces',
  'app-insights':     'azure-application-insights',
  // Analytics
  'synapse':          'azure-synapse-analytics',
  'databricks':       'azure-databricks',
  // AI
  'openai':           'azure-openai',
  // Networking security
  'firewall':         'azure-firewalls',
  'bastion':          'azure-bastions',
  'expressroute':     'azure-expressroute-circuits',
  // DevOps
  'devops':           'azure-devops',
  // Monitor
  'monitor':          'azure-monitor',
};

/**
 * 必須IDが存在するか検証し、ない場合は throw する。
 * @param {Set<string>} allIds
 */
function validateRequiredIds(allIds) {
  const REQUIRED_IDS = [
    'azure-subscriptions',
    'azure-resource-groups',
    'azure-virtual-networks',
    'azure-management-groups',
  ];

  const missing = REQUIRED_IDS.filter((id) => !allIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `ERROR: Required IDs not found in manifest:\n${missing.map((id) => `  ${id}`).join('\n')}`,
    );
  }

  console.log(
    `Required IDs: ${REQUIRED_IDS.map((id) => `${id} ✓`).join(', ')}`,
  );
}

async function main() {
  console.log(`Azure icons dir: ${ICONS_DIR}`);
  console.log('Collecting icons...');

  const { icons, skippedCount } = await collectIcons();

  console.log(`Collected ${icons.length} icons (skipped ${skippedCount} duplicates)`);

  // SVG読み込み・ミニファイ
  console.log('Minifying SVGs...');
  const svgMap = {};
  const svgIdSet = new Map(); // svgId -> iconId（重複検出用）

  for (const icon of icons) {
    const raw = await readFile(icon.srcPath, 'utf8');
    const minified = minifySvg(raw);
    svgMap[icon.id] = minified;

    // SVG内 id="..." の重複チェック
    const svgIds = extractSvgIds(raw);
    for (const svgId of svgIds) {
      if (svgIdSet.has(svgId)) {
        console.log(
          `  [warn] SVG id="${svgId}" found in both ${svgIdSet.get(svgId)} and ${icon.id}`,
        );
      } else {
        svgIdSet.set(svgId, icon.id);
      }
    }
  }

  const allIds = new Set(Object.keys(svgMap));

  // エイリアス検証
  console.log('Validating aliases...');
  validateAliases(ALIASES, allIds);
  console.log(`Aliases: ${Object.keys(ALIASES).length} (all validated)`);

  // manifest構築
  const manifest = {
    services: icons.map(({ id, category }) => ({
      id,
      name: idToName(id),
      category: CATEGORY_DISPLAY_MAP[category] ?? category,
      color: AZURE_COLOR,
    })),
    resources: [],
    groups: [],
    aliases: ALIASES,
  };

  // 出力
  console.log('Writing output...');
  writeGeneratedJson(OUT_GENERATED_DIR, manifest, svgMap);

  // 必須ID検証（fail-fast）
  validateRequiredIds(allIds);

  // サマリ
  console.log('');
  console.log('=== Summary ===');
  console.log(`Services      : ${icons.length}`);
  console.log(`Dedup skipped : ${skippedCount}`);
  console.log(`Aliases       : ${Object.keys(ALIASES).length} (all validated)`);
  console.log(`Total in/out  : ${icons.length + skippedCount} SVGs in → ${icons.length} services out`);
  console.log(`vm alias → ${ALIASES['vm']}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
