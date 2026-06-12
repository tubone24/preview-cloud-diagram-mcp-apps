#!/usr/bin/env node
/**
 * build-gcp-icons.mjs
 * GCPアイコンアセットからアイコンを取り込み、
 * ミニファイ済みSVGとマニフェストJSONを生成するビルドスクリプト。
 *
 * Usage:
 *   node scripts/build-gcp-icons.mjs
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

const UNIQUE_ICONS_DIR = path.join(PROJECT_ROOT, '参考', 'Unique Icons');
const LEGACY_ICONS_DIR = path.join(PROJECT_ROOT, '参考', 'google-cloud-legacy-icons');
const CATEGORY_ICONS_DIR = path.join(PROJECT_ROOT, '参考', 'Category Icons');

const OUT_GENERATED_DIR = path.join(PROJECT_ROOT, 'src', 'generated', 'gcp');

const GCP_COLOR = '#4285F4';

// Unique → Legacy dedup マップ（Uniqueと同一サービスのlegacyディレクトリ名）
const UNIQUE_OVERRIDES = {
  'GKE': 'google_kubernetes_engine',
  'BigQuery': 'bigquery',
  'Cloud Run': 'cloud_run',
  'Cloud Storage': 'cloud_storage',
  'Compute Engine': 'compute_engine',
  'Cloud SQL': 'cloud_sql',
  'Cloud Spanner': 'cloud_spanner',
  'Vertex AI': 'vertexai',
  'AlloyDB': 'alloydb_for_postgresql',
  'Anthos': 'anthos',
  'Apigee': 'apigee_api_platform',
  'Looker': 'looker',
  'Security Command Center': 'security_command_center',
};

// Unique 19サービスのカテゴリマップ
const UNIQUE_CATEGORY_MAP = {
  'GKE': 'Containers',
  'BigQuery': 'Data Analytics',
  'Cloud Run': 'Serverless',
  'Cloud Storage': 'Storage',
  'Compute Engine': 'Compute',
  'Cloud SQL': 'Databases',
  'Cloud Spanner': 'Databases',
  'Vertex AI': 'AI + ML',
  'AlloyDB': 'Databases',
  'Anthos': 'Hybrid & Multicloud',
  'Apigee': 'API Management',
  'AI Hypercomputer': 'Compute',
  'Distributed Cloud': 'Hybrid & Multicloud',
  'Hyperdisk': 'Storage',
  'Looker': 'Data Analytics',
  'Mandiant': 'Security',
  'Security Command Center': 'Security',
  'Security Operations': 'Security',
  'Threat Intelligence': 'Security',
};

// Legacy カテゴリマップ（フォールバックは 'Other'）
const LEGACY_CATEGORY_MAP = {
  // Compute
  'compute_engine': 'Compute',
  'app_engine': 'Serverless',
  'cloud_functions': 'Serverless',
  'cloud_run': 'Serverless',
  'cloud_run_for_anthos': 'Serverless',
  'batch': 'Compute',
  'bare_metal_solutions': 'Compute',
  'cloud_gpu': 'Compute',
  'cloud_tpu': 'Compute',
  'vmware_engine': 'Compute',
  'container_optimized_os': 'Compute',
  'local_ssd': 'Compute',
  'persistent_disk': 'Storage',
  // Containers
  'google_kubernetes_engine': 'Containers',
  'gke_on-prem': 'Containers',
  'container_registry': 'Containers',
  'artifact_registry': 'Containers',
  'kuberun': 'Containers',
  // Databases
  'cloud_sql': 'Databases',
  'cloud_spanner': 'Databases',
  'alloydb_for_postgresql': 'Databases',
  'bigtable': 'Databases',
  'firestore': 'Databases',
  'datastore': 'Databases',
  'memorystore': 'Databases',
  'database_migration_service': 'Databases',
  // Storage
  'cloud_storage': 'Storage',
  'filestore': 'Storage',
  'transfer': 'Storage',
  'transfer_appliance': 'Storage',
  'backup': 'Storage',
  // Data Analytics
  'bigquery': 'Data Analytics',
  'dataflow': 'Data Analytics',
  'dataproc': 'Data Analytics',
  'pubsub': 'Data Analytics',
  'analytics_hub': 'Data Analytics',
  'data_catalog': 'Data Analytics',
  'dataplex': 'Data Analytics',
  'dataproc_metastore': 'Data Analytics',
  'datastream': 'Data Analytics',
  'data_fusion': 'Data Analytics',
  'cloud_data_fusion': 'Data Analytics',
  'looker': 'Data Analytics',
  'data_studio': 'Data Analytics',
  // AI + ML
  'vertexai': 'AI + ML',
  'ai_platform': 'AI + ML',
  'ai_platform_unified': 'AI + ML',
  'ai_hub': 'AI + ML',
  'automl': 'AI + ML',
  'automl_natural_language': 'AI + ML',
  'automl_tables': 'AI + ML',
  'automl_translation': 'AI + ML',
  'automl_video_intelligence': 'AI + ML',
  'automl_vision': 'AI + ML',
  'dialogflow': 'AI + ML',
  'dialogflow_cx': 'AI + ML',
  'document_ai': 'AI + ML',
  'recommendations_ai': 'AI + ML',
  'retail_api': 'AI + ML',
  'tensorflow_enterprise': 'AI + ML',
  'contact_center_ai': 'AI + ML',
  'speech-to-text': 'AI + ML',
  'text-to-speech': 'AI + ML',
  'cloud_natural_language_api': 'AI + ML',
  'cloud_translation_api': 'AI + ML',
  'cloud_vision_api': 'AI + ML',
  'video_intelligence_api': 'AI + ML',
  'healthcare_nlp_api': 'AI + ML',
  'media_translation_api': 'AI + ML',
  'dialogflow_insights': 'AI + ML',
  'advanced_agent_modeling': 'AI + ML',
  // Networking
  'cloud_cdn': 'Networking',
  'cloud_dns': 'Networking',
  'cloud_load_balancing': 'Networking',
  'cloud_nat': 'Networking',
  'cloud_router': 'Networking',
  'cloud_vpn': 'Networking',
  'cloud_interconnect': 'Networking',
  'network_connectivity_center': 'Networking',
  'network_intelligence_center': 'Networking',
  'network_security': 'Networking',
  'network_tiers': 'Networking',
  'network_topology': 'Networking',
  'cloud_network': 'Networking',
  'partner_interconnect': 'Networking',
  'private_service_connect': 'Networking',
  'private_connectivity': 'Networking',
  'traffic_director': 'Networking',
  'cloud_domains': 'Networking',
  'cloud_external_ip_addresses': 'Networking',
  'cloud_firewall_rules': 'Networking',
  'cloud_routes': 'Networking',
  'premium_network_tier': 'Networking',
  'standard_network_tier': 'Networking',
  'virtual_private_cloud': 'Networking',
  'service_discovery': 'Networking',
  // Security
  'identity_and_access_management': 'Security',
  'key_management_service': 'Security',
  'secret_manager': 'Security',
  'security_command_center': 'Security',
  'cloud_armor': 'Security',
  'binary_authorization': 'Security',
  'certificate_authority_service': 'Security',
  'certificate_manager': 'Security',
  'cloud_ids': 'Security',
  'access_context_manager': 'Security',
  'assured_workloads': 'Security',
  'beyondcorp': 'Security',
  'cloud_ekm': 'Security',
  'cloud_hsm': 'Security',
  'identity-aware_proxy': 'Security',
  'identity_platform': 'Security',
  'key_access_justifications': 'Security',
  'managed_service_for_microsoft_active_directory': 'Security',
  'phishing_protection': 'Security',
  'policy_analyzer': 'Security',
  'risk_manager': 'Security',
  'security': 'Security',
  'security_health_advisor': 'Security',
  'security_key_enforcement': 'Security',
  'web_risk': 'Security',
  'web_security_scanner': 'Security',
  'workload_identity_pool': 'Security',
  // Developer Tools
  'cloud_build': 'Developer Tools',
  'cloud_code': 'Developer Tools',
  'cloud_deploy': 'Developer Tools',
  'cloud_scheduler': 'Developer Tools',
  'cloud_tasks': 'Developer Tools',
  'eventarc': 'Developer Tools',
  'workflows': 'Developer Tools',
  'cloud_shell': 'Developer Tools',
  'cloud_endpoints': 'Developer Tools',
  'cloud_api_gateway': 'Developer Tools',
  'api': 'Developer Tools',
  'api_analytics': 'Developer Tools',
  'api_monetization': 'Developer Tools',
  'apigee_api_platform': 'Developer Tools',
  'apigee_sense': 'Developer Tools',
  'connectors': 'Developer Tools',
  'developer_portal': 'Developer Tools',
  'cloud_test_lab': 'Developer Tools',
  // Management & Governance
  'cloud_logging': 'Management & Governance',
  'cloud_monitoring': 'Management & Governance',
  'trace': 'Management & Governance',
  'profiler': 'Management & Governance',
  'error_reporting': 'Management & Governance',
  'debugger': 'Management & Governance',
  'cloud_ops': 'Management & Governance',
  'stackdriver': 'Management & Governance',
  'cloud_deployment_manager': 'Management & Governance',
  'asset_inventory': 'Management & Governance',
  'cloud_asset_inventory': 'Management & Governance',
  'billing': 'Management & Governance',
  'quotas': 'Management & Governance',
  'config': 'Management & Governance',
  'configuration_management': 'Management & Governance',
  'os_configuration_management': 'Management & Governance',
  'os_inventory_management': 'Management & Governance',
  'os_patch_management': 'Management & Governance',
  'administration': 'Management & Governance',
  'cloud_audit_logs': 'Management & Governance',
  'permissions': 'Management & Governance',
  'performance_dashboard': 'Management & Governance',
  'user_preferences': 'Management & Governance',
  'runtime_config': 'Management & Governance',
  'release_notes': 'Management & Governance',
  'connectivity_test': 'Management & Governance',
  // Hybrid & Multicloud
  'anthos': 'Hybrid & Multicloud',
  'anthos_config_management': 'Hybrid & Multicloud',
  'anthos_service_mesh': 'Hybrid & Multicloud',
  'migrate_for_anthos': 'Hybrid & Multicloud',
  'migrate_for_compute_engine': 'Hybrid & Multicloud',
  // Other specific
  'datalab': 'Data Analytics',
  'datashare': 'Data Analytics',
  'datapol': 'Data Analytics',
  'data_labeling': 'AI + ML',
  'data_qna': 'AI + ML',
  'cloud_healthcare_api': 'Healthcare',
  'cloud_healthcare_marketplace': 'Healthcare',
  'genomics': 'Healthcare',
  'cloud_composer': 'Developer Tools',
  'dataprep': 'Data Analytics',
  'fleet_engine': 'Maps & Geospatial',
  'google_maps_platform': 'Maps & Geospatial',
  'real-world_insights': 'Maps & Geospatial',
  'game_servers': 'Gaming',
  'stream_suite': 'Media',
  'cloud_media_edge': 'Media',
  'iot_core': 'IoT',
  'iot_edge': 'IoT',
  'cloud_inference_api': 'AI + ML',
  'cloud_optimization_ai': 'AI + ML',
  'cloud_optimization_ai_-_fleet_routing_api': 'AI + ML',
  'quantum_engine': 'Compute',
  'gce_systems_management': 'Management & Governance',
  'cloud_for_marketing': 'Business',
  'financial_services_marketplace': 'Business',
  'advanced_solutions_lab': 'AI + ML',
  'agent_assist': 'AI + ML',
};

// エイリアスマップ
const ALIASES = {
  // よく使う略称
  'gke': 'gcp-gke',
  'gce': 'gcp-compute-engine',
  'compute-engine': 'gcp-compute-engine',
  'gcs': 'gcp-cloud-storage',
  'bq': 'gcp-bigquery',
  'pubsub': 'gcp-pubsub',
  'pub-sub': 'gcp-pubsub',
  'cloud-functions': 'gcp-cloud-functions',
  'run': 'gcp-cloud-run',
  'spanner': 'gcp-cloud-spanner',
  'cloud-sql': 'gcp-cloud-sql',
  'firestore': 'gcp-firestore',
  'bigtable': 'gcp-bigtable',
  'dataflow': 'gcp-dataflow',
  'dataproc': 'gcp-dataproc',
  'vertex-ai': 'gcp-vertex-ai',
  'gae': 'gcp-app-engine',
  'app-engine': 'gcp-app-engine',
  // UNIQUE_OVERRIDES由来のlegacy相当ID
  'gcp-google-kubernetes-engine': 'gcp-gke',
  'gcp-alloydb-for-postgresql': 'gcp-alloydb',
  'gcp-apigee-api-platform': 'gcp-apigee',
};

/** legacyディレクトリ名をTitle Case表示名に変換 */
function legacyDirToDisplayName(dirName) {
  return dirName
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Unique Iconsを収集する */
async function collectUniqueIcons() {
  const entries = await readdir(UNIQUE_ICONS_DIR, { withFileTypes: true });
  const serviceDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const icons = [];
  for (const dirName of serviceDirs) {
    const svgDir = path.join(UNIQUE_ICONS_DIR, dirName, 'SVG');
    let files;
    try {
      files = await readdir(svgDir);
    } catch {
      console.warn(`  [warn] SVG directory not found: ${svgDir}`);
      continue;
    }

    // {anything}-512-color.svg または {anything}-512-color-rgb.svg にマッチするファイルを探す
    const svgFile = files.find(
      (f) => f.endsWith('-512-color.svg') || f.endsWith('-512-color-rgb.svg'),
    );
    if (!svgFile) {
      console.warn(`  [warn] No -512-color[-rgb].svg found in: ${svgDir}`);
      continue;
    }

    const id = `gcp-${toKebabCase(dirName)}`;
    const category = UNIQUE_CATEGORY_MAP[dirName] ?? 'Other';

    icons.push({
      id,
      name: dirName,
      category,
      color: GCP_COLOR,
      srcPath: path.join(svgDir, svgFile),
      _uniqueDirName: dirName,
    });
  }
  return icons;
}

/** Legacy Iconsを収集する（dedup済み） */
async function collectLegacyIcons(skipSet) {
  const entries = await readdir(LEGACY_ICONS_DIR, { withFileTypes: true });
  const serviceDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const icons = [];
  const skipped = [];

  for (const dirName of serviceDirs) {
    // dedup: Uniqueでカバーされているlegacyはスキップ
    if (skipSet.has(dirName)) {
      skipped.push(dirName);
      continue;
    }

    const svgFile = path.join(LEGACY_ICONS_DIR, dirName, `${dirName}.svg`);
    let exists = true;
    try {
      await readFile(svgFile, 'utf8');
    } catch {
      exists = false;
    }
    if (!exists) {
      console.warn(`  [warn] SVG file not found: ${svgFile}`);
      continue;
    }

    const id = `gcp-${toKebabCase(dirName)}`;
    const category = LEGACY_CATEGORY_MAP[dirName] ?? 'Other';
    const displayName = legacyDirToDisplayName(dirName);

    icons.push({
      id,
      name: displayName,
      category,
      color: GCP_COLOR,
      srcPath: svgFile,
      _legacyDirName: dirName,
    });
  }

  return { icons, skipped };
}

/** Category Iconsを収集する */
async function collectCategoryIcons() {
  const entries = await readdir(CATEGORY_ICONS_DIR, { withFileTypes: true });
  const categoryDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const icons = [];
  for (const dirName of categoryDirs) {
    const svgDir = path.join(CATEGORY_ICONS_DIR, dirName, 'SVG');
    let files;
    try {
      files = await readdir(svgDir);
    } catch {
      console.warn(`  [warn] SVG directory not found: ${svgDir}`);
      continue;
    }

    const svgFile = files.find(
      (f) => f.endsWith('-512-color.svg') || f.endsWith('-512-color-rgb.svg'),
    );
    if (!svgFile) {
      console.warn(`  [warn] No -512-color[-rgb].svg found in: ${svgDir}`);
      continue;
    }

    const id = `gcp-category-${toKebabCase(dirName)}`;

    icons.push({
      id,
      name: dirName,
      category: dirName,
      color: GCP_COLOR,
      srcPath: path.join(svgDir, svgFile),
    });
  }
  return icons;
}

async function main() {
  console.log(
    `GCP asset dirs: ${UNIQUE_ICONS_DIR}, ${LEGACY_ICONS_DIR}, ${CATEGORY_ICONS_DIR}`,
  );

  console.log('Collecting icons...');

  // Uniqueを収集
  const uniqueIcons = await collectUniqueIcons();

  // Uniqueがカバーするlegacyディレクトリ名のセット
  const legacySkipSet = new Set(Object.values(UNIQUE_OVERRIDES));

  // Legacyを収集（dedup）
  const { icons: legacyIcons, skipped: dedupSkipped } = await collectLegacyIcons(legacySkipSet);

  // dedupスキップをログ出力
  for (const dirName of dedupSkipped) {
    // どのUnique名に対応するか逆引き
    const uniqueName = Object.entries(UNIQUE_OVERRIDES).find(
      ([, legacyDir]) => legacyDir === dirName,
    )?.[0] ?? '?';
    console.log(
      `  [skip] Legacy '${dirName}' skipped (covered by Unique '${uniqueName}')`,
    );
  }

  // Categoryを収集
  const categoryIcons = await collectCategoryIcons();

  // UNIQUE_OVERRIDES由来のエイリアスを生成（legacy ID → unique ID）
  const uniqueOverrideAliases = {};
  for (const uniqueIcon of uniqueIcons) {
    const legacyDirName = UNIQUE_OVERRIDES[uniqueIcon._uniqueDirName];
    if (legacyDirName) {
      const legacyId = `gcp-${toKebabCase(legacyDirName)}`;
      uniqueOverrideAliases[legacyId] = uniqueIcon.id;
    }
  }

  // 全サービスアイコン（Unique + Legacy）
  const allServices = [...uniqueIcons, ...legacyIcons];

  // SVGマップ構築（ミニファイ）
  console.log('Minifying SVGs...');
  const svgMap = {};

  for (const icon of [...allServices, ...categoryIcons]) {
    const raw = await readFile(icon.srcPath, 'utf8');
    svgMap[icon.id] = minifySvg(raw);
  }

  // 全ID セット
  const allIds = new Set(Object.keys(svgMap));

  // エイリアスマップ（固定 + UNIQUE_OVERRIDES由来）を結合
  const finalAliases = { ...ALIASES, ...uniqueOverrideAliases };

  // エイリアス検証
  console.log('Validating aliases...');
  validateAliases(finalAliases, allIds);

  // manifest構築
  const stripSrc = ({ srcPath, _uniqueDirName, _legacyDirName, ...rest }) => rest;
  const manifest = {
    services: allServices.map(stripSrc),
    resources: [],
    groups: categoryIcons.map(stripSrc),
    aliases: finalAliases,
  };

  // 出力
  console.log('Writing output...');
  writeGeneratedJson(OUT_GENERATED_DIR, manifest, svgMap);

  // 必須ID検証（fail-fast）
  const REQUIRED_IDS = [
    'gcp-my-cloud',
    'gcp-project',
    'gcp-virtual-private-cloud',
  ];
  const missingRequired = REQUIRED_IDS.filter((id) => !allIds.has(id));

  console.log('');
  console.log('=== Summary ===');
  console.log(`Services : ${allServices.length}`);
  console.log(`Groups   : ${categoryIcons.length}`);
  console.log(`Total icons: ${Object.keys(svgMap).length}`);
  console.log(`Unique icons  : ${uniqueIcons.length}`);
  console.log(`Legacy icons  : ${legacyIcons.length}（dedup後）`);
  console.log(`Dedup skipped : ${dedupSkipped.length}`);
  console.log(`Aliases: ${Object.keys(finalAliases).length} (all validated)`);

  const requiredStatus = REQUIRED_IDS.map((id) =>
    allIds.has(id) ? `${id} ✓` : `${id} ✗`,
  ).join(', ');
  console.log(`Required IDs: ${requiredStatus}`);

  if (missingRequired.length > 0) {
    console.error(
      `ERROR: Required IDs not found: ${missingRequired.join(', ')}`,
    );
    process.exit(1);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
