#!/usr/bin/env node
/**
 * build-icons.mjs
 * AWS公式アセットパッケージからアイコンを取り込み、
 * ミニファイ済みSVGとマニフェストJSONを生成するビルドスクリプト。
 *
 * Usage:
 *   node scripts/build-icons.mjs
 *   AWS_ASSET_DIR=/path/to/Asset-Package node scripts/build-icons.mjs
 */

import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_ASSET_DIR =
  '/Users/kagadminmac/Downloads/Asset-Package_07312025.49d3aab7f9e6131e51ade8f7c6c8b961ee7d3bb1';
const ASSET_DIR = process.env.AWS_ASSET_DIR || DEFAULT_ASSET_DIR;

const SERVICE_ICONS_DIR = path.join(ASSET_DIR, 'Architecture-Service-Icons_07312025');
const GROUP_ICONS_DIR = path.join(ASSET_DIR, 'Architecture-Group-Icons_07312025');
const RESOURCE_ICONS_ROOT = path.join(ASSET_DIR, 'Resource-Icons_07312025');
const GENERAL_RESOURCE_ICONS_DIR = path.join(
  RESOURCE_ICONS_ROOT,
  'Res_General-Icons',
  'Res_48_Light',
);

const OUT_ASSETS_DIR = path.join(PROJECT_ROOT, 'assets', 'aws-icons');
const OUT_GENERATED_DIR = path.join(PROJECT_ROOT, 'src', 'generated');

// フォルダ名 (Arch_ プレフィックス除去後) → { 表示名, AWS公式カテゴリ色 }
const CATEGORY_MAP = {
  'Analytics': { name: 'Analytics', color: '#8C4FFF' },
  'App-Integration': { name: 'Application Integration', color: '#E7157B' },
  'Artificial-Intelligence': { name: 'Artificial Intelligence', color: '#01A88D' },
  'Blockchain': { name: 'Blockchain', color: '#ED7100' },
  'Business-Applications': { name: 'Business Applications', color: '#DD344C' },
  'Cloud-Financial-Management': { name: 'Cloud Financial Management', color: '#7AA116' },
  'Compute': { name: 'Compute', color: '#ED7100' },
  'Containers': { name: 'Containers', color: '#ED7100' },
  'Customer-Enablement': { name: 'Customer Enablement', color: '#C925D1' },
  'Database': { name: 'Database', color: '#C925D1' },
  'Developer-Tools': { name: 'Developer Tools', color: '#C925D1' },
  'End-User-Computing': { name: 'End User Computing', color: '#01A88D' },
  'Front-End-Web-Mobile': { name: 'Front-End Web & Mobile', color: '#DD344C' },
  'Games': { name: 'Games', color: '#8C4FFF' },
  'General-Icons': { name: 'General', color: '#232F3E' },
  'Internet-of-Things': { name: 'Internet of Things', color: '#7AA116' },
  'Management-Governance': { name: 'Management & Governance', color: '#E7157B' },
  'Media-Services': { name: 'Media Services', color: '#ED7100' },
  'Migration-Modernization': { name: 'Migration & Modernization', color: '#01A88D' },
  'Networking-Content-Delivery': { name: 'Networking & Content Delivery', color: '#8C4FFF' },
  'Quantum-Technologies': { name: 'Quantum Technologies', color: '#ED7100' },
  'Satellite': { name: 'Satellite', color: '#C925D1' },
  'Security-Identity-Compliance': { name: 'Security, Identity & Compliance', color: '#DD344C' },
  'Storage': { name: 'Storage', color: '#7AA116' },
};

const NEUTRAL_COLOR = '#7D8998';

// リソースアイコンのカテゴリフォルダ名 (Res_ プレフィックス除去後) → CATEGORY_MAP のキー
// フォルダ名がサービスアイコン側と揺らいでいるものだけここで吸収する
const RESOURCE_CATEGORY_KEY_MAP = {
  'Application-Integration': 'App-Integration',
  'IoT': 'Internet-of-Things',
};

// よく使う略称 → 正規ID（manifest生成後に存在検証する）
const ALIASES = {
  's3': 'amazon-simple-storage-service',
  'ec2': 'amazon-ec2',
  'lambda': 'aws-lambda',
  'rds': 'amazon-rds',
  'dynamodb': 'amazon-dynamodb',
  'cloudfront': 'amazon-cloudfront',
  'api-gateway': 'amazon-api-gateway',
  'apigateway': 'amazon-api-gateway',
  'elb': 'elastic-load-balancing',
  'alb': 'elastic-load-balancing',
  'nlb': 'elastic-load-balancing',
  'ecs': 'amazon-elastic-container-service',
  'eks': 'amazon-elastic-kubernetes-service',
  'fargate': 'aws-fargate',
  'sqs': 'amazon-simple-queue-service',
  'sns': 'amazon-simple-notification-service',
  'route53': 'amazon-route-53',
  'route-53': 'amazon-route-53',
  'cloudwatch': 'amazon-cloudwatch',
  'iam': 'aws-identity-and-access-management',
  'cognito': 'amazon-cognito',
  'elasticache': 'amazon-elasticache',
  'aurora': 'amazon-aurora',
  'step-functions': 'aws-step-functions',
  'eventbridge': 'amazon-eventbridge',
  'kinesis': 'amazon-kinesis',
  'athena': 'amazon-athena',
  'glue': 'aws-glue',
  'redshift': 'amazon-redshift',
  'sagemaker': 'amazon-sagemaker-ai',
  'bedrock': 'amazon-bedrock',
  'ecr': 'amazon-elastic-container-registry',
  'codebuild': 'aws-codebuild',
  'codepipeline': 'aws-codepipeline',
  'kms': 'aws-key-management-service',
  'waf': 'aws-waf',
  'secrets-manager': 'aws-secrets-manager',
  'cloudtrail': 'aws-cloudtrail',
  'efs': 'amazon-efs',
  'opensearch': 'amazon-opensearch-service',
  'amplify': 'aws-amplify',
  'appsync': 'aws-appsync',
  'batch': 'aws-batch',
  'lightsail': 'amazon-lightsail',
  'direct-connect': 'aws-direct-connect',
  'vpn': 'aws-site-to-site-vpn',
  'transit-gateway': 'aws-transit-gateway',
  'ses': 'amazon-simple-email-service',
  'mq': 'amazon-mq',
  'msk': 'amazon-managed-streaming-for-apache-kafka',
  'neptune': 'amazon-neptune',
  'documentdb': 'amazon-documentdb',
  'memorydb': 'amazon-memorydb',
  'backup': 'aws-backup',
  'organizations': 'aws-organizations',
  'control-tower': 'aws-control-tower',
  'quicksight': 'amazon-quicksight',
  // --- リソースアイコン（補助アイコン）向けエイリアス ---
  // 注: eks-pod / fargate-task は対応するリソースアイコンがアセットに存在しないため定義しない
  'ecs-task': 'amazon-elastic-container-service-task',
  'ecs-service': 'amazon-elastic-container-service-service',
  'ecs-service-connect': 'amazon-elastic-container-service-ecs-service-connect',
  'ecs-container': 'amazon-elastic-container-service-container-1',
  'ecr-image': 'amazon-elastic-container-registry-image',
  'ec2-instance': 'amazon-ec2-instance',
  'ec2-instances': 'amazon-ec2-instances',
  'ec2-ami': 'amazon-ec2-ami',
  'lambda-function': 'aws-lambda-lambda-function',
  's3-bucket': 'amazon-simple-storage-service-bucket',
  's3-bucket-with-objects': 'amazon-simple-storage-service-bucket-with-objects',
  'dynamodb-table': 'amazon-dynamodb-table',
  'sqs-queue': 'amazon-simple-queue-service-queue',
  'sqs-message': 'amazon-simple-queue-service-message',
  'sns-topic': 'amazon-simple-notification-service-topic',
  'nat-gateway': 'amazon-vpc-nat-gateway',
  'internet-gateway': 'amazon-vpc-internet-gateway',
  'vpc-endpoints': 'amazon-vpc-endpoints',
  'route53-hosted-zone': 'amazon-route-53-hosted-zone',
  'eventbridge-event': 'amazon-eventbridge-event',
};

/** SVG軽量ミニファイ。id属性やurl(#...)参照は壊さない。 */
function minifySvg(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '') // XML宣言除去
    .replace(/<!--[\s\S]*?-->/g, '') // コメント除去
    .replace(/<title>[\s\S]*?<\/title>/g, '') // title除去
    .replace(/>\s+</g, '><') // タグ間の改行・空白を圧縮
    .replace(/\s{2,}/g, ' ') // 連続空白を1つに
    .trim();
}

/** 名前部分（例: "Amazon-EC2" / "Amazon-Elastic-Container-Service_Task"）→ 表示名（"Amazon EC2" / "Amazon Elastic Container Service Task"） */
function toDisplayName(namePart) {
  return namePart.replace(/[_-]/g, ' ');
}

/** 名前部分 → ID（小文字化、`_` は `-` に正規化） */
function toId(namePart) {
  return namePart.toLowerCase().replace(/_/g, '-');
}

async function collectServiceIcons() {
  const entries = await readdir(SERVICE_ICONS_DIR, { withFileTypes: true });
  const categoryDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('Arch_'))
    .map((e) => e.name)
    .sort();

  const services = []; // { id, name, category, color, srcPath }
  const seen = new Map(); // id -> srcPath
  const duplicates = [];
  const categoryCounts = {};

  for (const dir of categoryDirs) {
    const categoryKey = dir.replace(/^Arch_/, '');
    const meta = CATEGORY_MAP[categoryKey];
    if (!meta) {
      throw new Error(`Unknown service category folder: ${dir}`);
    }
    const dir48 = path.join(SERVICE_ICONS_DIR, dir, '48');
    let files;
    try {
      files = (await readdir(dir48)).filter((f) => f.endsWith('_48.svg'));
    } catch {
      console.warn(`  [warn] 48px directory not found: ${dir48}`);
      continue;
    }

    for (const file of files.sort()) {
      let namePart = file.replace(/^Arch_/, '').replace(/_48\.svg$/, '');
      // Light/Darkバリアント（例: AWS-Marketplace_Light/_Dark）: Darkは除外、Lightは正規名に統合
      if (/_Dark$/.test(namePart)) continue;
      namePart = namePart.replace(/_Light$/, '');

      const id = toId(namePart);
      const srcPath = path.join(dir48, file);
      if (seen.has(id)) {
        duplicates.push({ id, kept: seen.get(id), skipped: srcPath });
        continue;
      }
      seen.set(id, srcPath);
      services.push({
        id,
        name: toDisplayName(namePart),
        category: meta.name,
        color: meta.color,
        srcPath,
      });
      categoryCounts[meta.name] = (categoryCounts[meta.name] || 0) + 1;
    }
  }
  return { services, duplicates, categoryCounts };
}

async function collectGroupIcons() {
  const files = (await readdir(GROUP_ICONS_DIR)).filter(
    (f) => f.endsWith('_32.svg') && !/_Dark_32\.svg$/.test(f),
  );
  return files.sort().map((file) => {
    const namePart = file.replace(/_32\.svg$/, '');
    return {
      id: toId(namePart),
      name: toDisplayName(namePart),
      category: 'Group',
      color: NEUTRAL_COLOR,
      srcPath: path.join(GROUP_ICONS_DIR, file),
    };
  });
}

async function collectGeneralResourceIcons() {
  const files = (await readdir(GENERAL_RESOURCE_ICONS_DIR)).filter((f) =>
    f.endsWith('_48_Light.svg'),
  );
  return files.sort().map((file) => {
    const namePart = file.replace(/^Res_/, '').replace(/_48_Light\.svg$/, '');
    return {
      id: toId(namePart),
      name: toDisplayName(namePart),
      category: 'General',
      color: NEUTRAL_COLOR,
      srcPath: path.join(GENERAL_RESOURCE_ICONS_DIR, file),
    };
  });
}

/**
 * 全カテゴリのリソースアイコン（補助アイコン）を収集する。
 * Res_General-Icons は collectGeneralResourceIcons で取り込み済みのため除外。
 * 例: Res_Containers/Res_Amazon-Elastic-Container-Service_Task_48.svg
 *     → id: amazon-elastic-container-service-task
 */
async function collectCategoryResourceIcons() {
  const entries = await readdir(RESOURCE_ICONS_ROOT, { withFileTypes: true });
  const categoryDirs = entries
    .filter(
      (e) =>
        e.isDirectory() && e.name.startsWith('Res_') && e.name !== 'Res_General-Icons',
    )
    .map((e) => e.name)
    .sort();

  const resources = [];
  const categoryCounts = {};
  for (const dir of categoryDirs) {
    const folderKey = dir.replace(/^Res_/, '');
    const categoryKey = RESOURCE_CATEGORY_KEY_MAP[folderKey] || folderKey;
    const meta = CATEGORY_MAP[categoryKey];
    if (!meta) {
      throw new Error(`Unknown resource category folder: ${dir}`);
    }
    const dirPath = path.join(RESOURCE_ICONS_ROOT, dir);
    const files = (await readdir(dirPath)).filter((f) => f.endsWith('_48.svg'));
    for (const file of files.sort()) {
      const namePart = file.replace(/^Res_/, '').replace(/_48\.svg$/, '');
      resources.push({
        id: toId(namePart),
        name: toDisplayName(namePart),
        category: meta.name,
        color: meta.color,
        srcPath: path.join(dirPath, file),
      });
      categoryCounts[meta.name] = (categoryCounts[meta.name] || 0) + 1;
    }
  }
  return { resources, categoryCounts };
}

async function main() {
  console.log(`AWS asset dir: ${ASSET_DIR}`);
  try {
    await stat(ASSET_DIR);
  } catch {
    console.error(`ERROR: asset directory not found: ${ASSET_DIR}`);
    console.error('Set AWS_ASSET_DIR to override the default path.');
    process.exit(1);
  }

  console.log('Collecting icons...');
  const [
    { services, duplicates, categoryCounts },
    groups,
    generalResources,
    { resources: categoryResources, categoryCounts: resourceCategoryCounts },
  ] = await Promise.all([
    collectServiceIcons(),
    collectGroupIcons(),
    collectGeneralResourceIcons(),
    collectCategoryResourceIcons(),
  ]);

  // ID衝突解決: services/groups/取り込み済みリソース と衝突した resources にはプレフィックスを付与
  // (General アイコンは general-、カテゴリ別リソースは resource-)
  const resources = [...generalResources, ...categoryResources];
  const takenIds = new Set([...services.map((s) => s.id), ...groups.map((g) => g.id)]);
  const collisions = [];
  for (const res of resources) {
    if (takenIds.has(res.id)) {
      const prefix = res.category === 'General' ? 'general-' : 'resource-';
      const newId = `${prefix}${res.id}`;
      if (takenIds.has(newId)) {
        throw new Error(`Unresolvable icon ID collision: ${res.id} -> ${newId}`);
      }
      collisions.push({ original: res.id, resolved: newId });
      res.id = newId;
    }
    takenIds.add(res.id);
  }

  // 出力ディレクトリ作成
  const dirs = {
    services: path.join(OUT_ASSETS_DIR, 'services'),
    groups: path.join(OUT_ASSETS_DIR, 'groups'),
    resources: path.join(OUT_ASSETS_DIR, 'resources'),
  };
  await Promise.all([
    ...Object.values(dirs).map((d) => mkdir(d, { recursive: true })),
    mkdir(OUT_GENERATED_DIR, { recursive: true }),
  ]);

  // SVG読み込み・ミニファイ・コピー
  console.log('Minifying and writing SVG files...');
  const svgMap = {};
  async function processIcons(icons, outDir) {
    for (const icon of icons) {
      const raw = await readFile(icon.srcPath, 'utf8');
      const min = minifySvg(raw);
      svgMap[icon.id] = min;
      await writeFile(path.join(outDir, `${icon.id}.svg`), min, 'utf8');
    }
  }
  await processIcons(services, dirs.services);
  await processIcons(groups, dirs.groups);
  await processIcons(resources, dirs.resources);

  // エイリアス検証
  console.log('Validating aliases...');
  const validIds = new Set(takenIds);
  const missing = Object.entries(ALIASES).filter(([, target]) => !validIds.has(target));
  if (missing.length > 0) {
    console.error('ERROR: the following aliases resolve to non-existent icon IDs:');
    for (const [alias, target] of missing) {
      console.error(`  ${alias} -> ${target} (not found in manifest)`);
    }
    process.exit(1);
  }

  // manifest / svgs JSON 出力
  const stripSrc = ({ srcPath, ...rest }) => rest;
  const manifest = {
    services: services.map(stripSrc),
    resources: resources.map(stripSrc),
    groups: groups.map(stripSrc),
    aliases: ALIASES,
  };
  const manifestPath = path.join(OUT_GENERATED_DIR, 'icon-manifest.json');
  const svgsPath = path.join(OUT_GENERATED_DIR, 'icon-svgs.json');
  const manifestJson = JSON.stringify(manifest, null, 2);
  const svgsJson = JSON.stringify(svgMap);
  await writeFile(manifestPath, manifestJson, 'utf8');
  await writeFile(svgsPath, svgsJson, 'utf8');

  // サマリ出力
  console.log('');
  console.log('=== Summary ===');
  console.log(`Services : ${services.length}`);
  for (const [cat, count] of Object.entries(categoryCounts).sort()) {
    console.log(`  - ${cat}: ${count}`);
  }
  console.log(`Groups   : ${groups.length}`);
  console.log(`Resources: ${resources.length}`);
  console.log(`  - General: ${generalResources.length}`);
  for (const [cat, count] of Object.entries(resourceCategoryCounts).sort()) {
    console.log(`  - ${cat}: ${count}`);
  }
  console.log(`Total icons: ${Object.keys(svgMap).length}`);
  if (duplicates.length > 0) {
    console.log('');
    console.log('Duplicate service IDs (first occurrence kept):');
    for (const d of duplicates) {
      console.log(`  - ${d.id}: skipped ${path.relative(ASSET_DIR, d.skipped)}`);
    }
  }
  if (collisions.length > 0) {
    console.log('');
    console.log('Resource ID collisions (renamed with general-/resource- prefix):');
    for (const c of collisions) {
      console.log(`  - ${c.original} -> ${c.resolved}`);
    }
  }
  console.log('');
  console.log(`Aliases: ${Object.keys(ALIASES).length} (all validated)`);
  console.log('');
  console.log(`icon-manifest.json: ${Buffer.byteLength(manifestJson)} bytes`);
  console.log(`icon-svgs.json    : ${Buffer.byteLength(svgsJson)} bytes`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
