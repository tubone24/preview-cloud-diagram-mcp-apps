#!/usr/bin/env node
/**
 * generic-icon-catalog.mjs
 * 汎用（generic）プロバイダー用アイコンカタログの宣言的定義。
 * build-generic-icons.mjs から import して使用する。
 *
 * 流用方針:
 *   AWS 公式 SVG（assets/aws-icons/ 配下）をソースとし、ビルダー側で
 *   「白以外の全色を #232F3D に正規化」してベンダー中立アイコンに変換する。
 *   → 外部アセット調達ゼロでオンプレ／概念図向けの中立デッキを実現する。
 *
 * 各エントリのフィールド:
 *   id         - アイコンID（"generic-" プレフィックス必須）
 *   name       - 表示名（ラベルに使われる）
 *   category   - カテゴリ文字列（list_icons のサマリ・フィルタに使われる）
 *   sourceFile - assets/aws-icons/ からの相対パス（resources/ groups/ services/ いずれか）
 *   aliases    - 短縮名の配列（プレフィックスなしで解決可能にする）
 *   kind       - "resource"（既定）または "group"。group は manifest.groups へ振り分ける
 */

/** @typedef {{id:string,name:string,category:string,sourceFile:string,aliases:string[],kind?:"resource"|"group"}} GenericIconEntry */

/** @type {GenericIconEntry[]} */
export const GENERIC_CATALOG = [
  // ── Compute ──────────────────────────────────────────────────────────
  {
    id: 'generic-server',
    name: 'Server',
    category: 'Compute',
    sourceFile: 'resources/server.svg',
    aliases: ['server'],
  },
  {
    id: 'generic-servers',
    name: 'Servers',
    category: 'Compute',
    sourceFile: 'resources/servers.svg',
    aliases: ['servers'],
  },
  {
    id: 'generic-instance',
    name: 'Instance',
    category: 'Compute',
    sourceFile: 'resources/amazon-ec2-instance.svg',
    aliases: ['instance', 'vm', 'virtual-machine'],
  },
  {
    id: 'generic-container',
    name: 'Container',
    category: 'Compute',
    sourceFile: 'resources/amazon-elastic-container-service-container-1.svg',
    aliases: ['container'],
  },
  {
    id: 'generic-client',
    name: 'Client',
    category: 'Compute',
    sourceFile: 'resources/client.svg',
    aliases: ['client'],
  },

  // ── Storage ──────────────────────────────────────────────────────────
  {
    id: 'generic-disk',
    name: 'Disk',
    category: 'Storage',
    sourceFile: 'resources/disk.svg',
    aliases: ['disk'],
  },
  {
    id: 'generic-volume',
    name: 'Volume',
    category: 'Storage',
    sourceFile: 'resources/amazon-elastic-block-store-volume.svg',
    aliases: ['volume'],
  },
  {
    id: 'generic-cold-storage',
    name: 'Cold Storage',
    category: 'Storage',
    sourceFile: 'resources/cold-storage.svg',
    aliases: ['cold-storage', 'archive'],
  },
  {
    id: 'generic-tape',
    name: 'Tape',
    category: 'Storage',
    sourceFile: 'resources/tape-storage.svg',
    aliases: ['tape', 'tape-storage'],
  },
  {
    id: 'generic-object-storage',
    name: 'Object Storage',
    category: 'Storage',
    sourceFile: 'resources/amazon-simple-storage-service-bucket.svg',
    aliases: ['object-storage', 'bucket', 'blob-storage'],
  },
  {
    id: 'generic-backup',
    name: 'Backup',
    category: 'Storage',
    sourceFile: 'resources/aws-backup-backup-vault.svg',
    aliases: ['backup'],
  },

  // ── Database ─────────────────────────────────────────────────────────
  {
    id: 'generic-database',
    name: 'Database',
    category: 'Database',
    sourceFile: 'resources/database.svg',
    aliases: ['database', 'db'],
  },
  {
    id: 'generic-relational-database',
    name: 'Relational Database',
    category: 'Database',
    sourceFile: 'services/amazon-rds.svg',
    aliases: ['relational-database', 'rdbms', 'sql-database'],
  },

  // ── Network ──────────────────────────────────────────────────────────
  {
    id: 'generic-router',
    name: 'Router',
    category: 'Network',
    sourceFile: 'resources/amazon-vpc-router.svg',
    aliases: ['router'],
  },
  {
    id: 'generic-load-balancer',
    name: 'Load Balancer',
    category: 'Network',
    sourceFile: 'resources/elastic-load-balancing-application-load-balancer.svg',
    aliases: ['load-balancer', 'lb', 'alb'],
  },
  {
    id: 'generic-nlb',
    name: 'Network Load Balancer',
    category: 'Network',
    sourceFile: 'resources/elastic-load-balancing-network-load-balancer.svg',
    aliases: ['nlb'],
  },
  {
    id: 'generic-firewall',
    name: 'Firewall',
    category: 'Network',
    sourceFile: 'resources/firewall.svg',
    aliases: ['firewall'],
  },
  {
    id: 'generic-nat-gateway',
    name: 'NAT Gateway',
    category: 'Network',
    sourceFile: 'resources/amazon-vpc-nat-gateway.svg',
    aliases: ['nat-gateway', 'nat'],
  },
  {
    id: 'generic-internet-gateway',
    name: 'Internet Gateway',
    category: 'Network',
    sourceFile: 'resources/amazon-vpc-internet-gateway.svg',
    aliases: ['internet-gateway', 'igw'],
  },
  {
    id: 'generic-vpn-gateway',
    name: 'VPN Gateway',
    category: 'Network',
    sourceFile: 'resources/amazon-vpc-vpn-gateway.svg',
    aliases: ['vpn-gateway', 'vpn'],
  },
  {
    id: 'generic-transit-gateway',
    name: 'Transit Gateway',
    category: 'Network',
    sourceFile: 'services/aws-transit-gateway.svg',
    aliases: ['transit-gateway', 'tgw'],
  },

  // ── People & Devices ──────────────────────────────────────────────────
  {
    id: 'generic-user',
    name: 'User',
    category: 'People & Devices',
    sourceFile: 'resources/user.svg',
    aliases: ['user'],
  },
  {
    id: 'generic-users',
    name: 'Users',
    category: 'People & Devices',
    sourceFile: 'resources/users.svg',
    aliases: ['users'],
  },
  {
    id: 'generic-authenticated-user',
    name: 'Authenticated User',
    category: 'People & Devices',
    sourceFile: 'resources/authenticated-user.svg',
    aliases: ['authenticated-user', 'auth-user'],
  },
  {
    id: 'generic-mobile-client',
    name: 'Mobile Client',
    category: 'People & Devices',
    sourceFile: 'resources/mobile-client.svg',
    aliases: ['mobile-client', 'mobile', 'smartphone'],
  },
  {
    id: 'generic-iot-thing',
    name: 'IoT Thing',
    category: 'People & Devices',
    sourceFile: 'resources/aws-iot-thing-generic.svg',
    aliases: ['iot-thing', 'iot', 'thing'],
  },
  {
    id: 'generic-iot-sensor',
    name: 'IoT Sensor',
    category: 'People & Devices',
    sourceFile: 'resources/aws-iot-sensor.svg',
    aliases: ['iot-sensor', 'sensor'],
  },

  // ── Group icons ───────────────────────────────────────────────────────
  {
    id: 'generic-corporate-data-center',
    name: 'Corporate Data Center',
    category: 'Group',
    sourceFile: 'groups/corporate-data-center.svg',
    aliases: ['corporate-data-center', 'data-center', 'datacenter', 'on-premises', 'on-prem'],
    kind: 'group',
  },
  {
    id: 'generic-server-contents',
    name: 'Server Contents',
    category: 'Group',
    sourceFile: 'groups/server-contents.svg',
    aliases: ['server-contents'],
    kind: 'group',
  },
];
