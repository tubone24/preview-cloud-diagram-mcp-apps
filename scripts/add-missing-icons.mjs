#!/usr/bin/env node
/**
 * add-missing-icons.mjs
 * 参考フォルダ（元アセット）なしで generated JSON に直接アイコン・エイリアスを追加する
 * ワンショットスクリプト。build:icons が再実行できない環境向け。
 * （build-gcp-icons.mjs / build-azure-icons.mjs にも同じ内容を反映済み）
 *
 * Usage: node scripts/add-missing-icons.mjs <firebase-svg-path>
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifySvg } from './lib/icon-build-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const GCP_DIR = path.join(PROJECT_ROOT, 'src', 'generated', 'gcp');
const AZURE_DIR = path.join(PROJECT_ROOT, 'src', 'generated', 'azure');

const firebaseSvgPath = process.argv[2];
if (!firebaseSvgPath) {
  console.error('Usage: node scripts/add-missing-icons.mjs <firebase-svg-path>');
  process.exit(1);
}

async function loadJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

// ---- GCP: gcp-firebase アイコン追加 + エイリアス ----
const gcpManifest = await loadJson(path.join(GCP_DIR, 'icon-manifest.json'));
const gcpSvgs = await loadJson(path.join(GCP_DIR, 'icon-svgs.json'));

const firebaseSvg = minifySvg(await readFile(firebaseSvgPath, 'utf8'));

if (!gcpSvgs['gcp-firebase']) {
  gcpSvgs['gcp-firebase'] = firebaseSvg;
  gcpManifest.services.push({
    id: 'gcp-firebase',
    name: 'Firebase',
    category: 'Other',
    color: '#4285F4',
  });
  console.log('added: gcp-firebase (svg + manifest entry)');
} else {
  console.log('skip: gcp-firebase already exists');
}

const GCP_NEW_ALIASES = {
  'firebase': 'gcp-firebase',
  'firebase-auth': 'gcp-firebase',
  'firebase-authentication': 'gcp-firebase',
  'gcp-firebase-authentication': 'gcp-firebase',
  'vision-ai': 'gcp-cloud-vision-api',
  'gcp-vision-ai': 'gcp-cloud-vision-api',
  'vision': 'gcp-cloud-vision-api',
};

// ---- Azure: エイリアスのみ ----
const azureManifest = await loadJson(path.join(AZURE_DIR, 'icon-manifest.json'));

const AZURE_NEW_ALIASES = {
  'azure-blob-storage': 'azure-blob-block',
  'blob-storage': 'azure-blob-block',
  'azure-cache-for-redis': 'azure-cache-redis',
  'cache-for-redis': 'azure-cache-redis',
  'redis': 'azure-cache-redis',
};

function mergeAliases(manifest, newAliases, label) {
  const ids = new Set(
    [...manifest.services, ...(manifest.resources ?? []), ...(manifest.groups ?? [])].map(
      (e) => e.id,
    ),
  );
  for (const [alias, target] of Object.entries(newAliases)) {
    if (!ids.has(target)) {
      throw new Error(`${label}: alias target not found: ${alias} -> ${target}`);
    }
    if (manifest.aliases[alias]) {
      console.log(`skip alias (exists): ${alias} -> ${manifest.aliases[alias]}`);
      continue;
    }
    manifest.aliases[alias] = target;
    console.log(`added alias [${label}]: ${alias} -> ${target}`);
  }
}

mergeAliases(gcpManifest, GCP_NEW_ALIASES, 'gcp');
mergeAliases(azureManifest, AZURE_NEW_ALIASES, 'azure');

// ---- 書き出し（既存フォーマットに合わせる: manifest=2スペース, svgs=ミニファイ） ----
await writeFile(
  path.join(GCP_DIR, 'icon-manifest.json'),
  JSON.stringify(gcpManifest, null, 2),
  'utf8',
);
await writeFile(path.join(GCP_DIR, 'icon-svgs.json'), JSON.stringify(gcpSvgs), 'utf8');
await writeFile(
  path.join(AZURE_DIR, 'icon-manifest.json'),
  JSON.stringify(azureManifest, null, 2),
  'utf8',
);

console.log('Done.');
