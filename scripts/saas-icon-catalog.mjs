#!/usr/bin/env node
/**
 * saas-icon-catalog.mjs
 * SaaS / mBaaS アイコンカタログの宣言的定義。
 * build-saas-icons.mjs から import して使用する。
 *
 * 各エントリのフィールド:
 *   id          - アイコンID（"saas-" プレフィックス必須）
 *   name        - 表示名
 *   category    - カテゴリ文字列
 *   siSlug      - simple-icons のエクスポート名（officialFile がなければこちらを使用）
 *   officialFile- assets/saas-icons/ に置いた公式SVGのファイル名（省略可）
 *   fill        - SVG の fill 色（省略/null 時は simple-icons の hex を使用）
 *   tile        - true で角丸タイル背景+白抜きグリフ（白っぽいブランド色用）
 *   aliases     - エイリアス文字列の配列
 */

/** @type {Array<{id:string,name:string,category:string,siSlug:string,officialFile?:string,fill?:string|null,tile?:boolean,aliases:string[]}>} */
export const SAAS_CATALOG = [
  // ── Hosting & Edge ──────────────────────────────────────────────────
  {
    id: 'saas-vercel',
    name: 'Vercel',
    category: 'Hosting & Edge',
    siSlug: 'siVercel',
    officialFile: 'vercel.svg',
    fill: null,
    tile: false,
    aliases: ['vercel'],
  },
  {
    id: 'saas-netlify',
    name: 'Netlify',
    category: 'Hosting & Edge',
    siSlug: 'siNetlify',
    fill: null,
    tile: false,
    aliases: ['netlify'],
  },
  {
    id: 'saas-cloudflare',
    name: 'Cloudflare',
    category: 'Hosting & Edge',
    siSlug: 'siCloudflare',
    fill: null,
    tile: false,
    aliases: ['cloudflare'],
  },
  {
    id: 'saas-cloudflare-workers',
    name: 'Cloudflare Workers',
    category: 'Hosting & Edge',
    siSlug: 'siCloudflareworkers',
    fill: null,
    tile: false,
    aliases: ['workers', 'cf-workers'],
  },
  {
    id: 'saas-render',
    name: 'Render',
    category: 'Hosting & Edge',
    siSlug: 'siRender',
    fill: null,
    tile: false,
    aliases: ['render'],
  },
  {
    id: 'saas-flyio',
    name: 'Fly.io',
    category: 'Hosting & Edge',
    siSlug: 'siFlydotio',
    fill: null,
    tile: false,
    aliases: ['fly', 'flyio'],
  },
  {
    id: 'saas-heroku',
    name: 'Heroku',
    category: 'Hosting & Edge',
    siSlug: 'siHeroku',
    fill: null,
    tile: false,
    aliases: ['heroku'],
  },

  // ── BaaS / mBaaS ────────────────────────────────────────────────────
  {
    id: 'saas-supabase',
    name: 'Supabase',
    category: 'BaaS / mBaaS',
    siSlug: 'siSupabase',
    officialFile: 'supabase.svg',
    fill: null,
    tile: false,
    aliases: ['supabase'],
  },
  {
    id: 'saas-firebase',
    name: 'Firebase',
    category: 'BaaS / mBaaS',
    siSlug: 'siFirebase',
    fill: null,
    tile: false,
    // GCPカタログに gcp-firebase が存在するため "firebase" エイリアスは付けない（衝突回避）
    aliases: [],
  },
  {
    id: 'saas-appwrite',
    name: 'Appwrite',
    category: 'BaaS / mBaaS',
    siSlug: 'siAppwrite',
    fill: null,
    tile: false,
    aliases: ['appwrite'],
  },

  // ── Database ─────────────────────────────────────────────────────────
  {
    id: 'saas-planetscale',
    name: 'PlanetScale',
    category: 'Database',
    siSlug: 'siPlanetscale',
    fill: null,
    tile: false,
    aliases: ['planetscale'],
  },
  {
    id: 'saas-upstash',
    name: 'Upstash',
    category: 'Database',
    siSlug: 'siUpstash',
    fill: null,
    tile: false,
    aliases: ['upstash'],
  },
  {
    id: 'saas-mongodb',
    name: 'MongoDB',
    category: 'Database',
    siSlug: 'siMongodb',
    fill: null,
    tile: false,
    aliases: ['mongodb', 'mongo'],
  },
  {
    id: 'saas-redis',
    name: 'Redis',
    category: 'Database',
    siSlug: 'siRedis',
    fill: null,
    tile: false,
    aliases: ['redis'],
  },

  // ── Auth & Identity ───────────────────────────────────────────────────
  {
    id: 'saas-auth0',
    name: 'Auth0',
    category: 'Auth & Identity',
    siSlug: 'siAuth0',
    fill: null,
    tile: false,
    aliases: ['auth0'],
  },
  {
    id: 'saas-okta',
    name: 'Okta',
    category: 'Auth & Identity',
    siSlug: 'siOkta',
    fill: null,
    tile: false,
    aliases: ['okta'],
  },
  {
    id: 'saas-clerk',
    name: 'Clerk',
    category: 'Auth & Identity',
    siSlug: 'siClerk',
    fill: null,
    tile: false,
    aliases: ['clerk'],
  },

  // ── Payments ──────────────────────────────────────────────────────────
  {
    id: 'saas-stripe',
    name: 'Stripe',
    category: 'Payments',
    siSlug: 'siStripe',
    fill: null,
    tile: false,
    aliases: ['stripe'],
  },

  // ── Messaging ─────────────────────────────────────────────────────────
  {
    id: 'saas-twilio',
    name: 'Twilio',
    category: 'Messaging',
    siSlug: 'siTwilio',
    fill: null,
    tile: false,
    aliases: ['twilio'],
  },
  {
    id: 'saas-slack',
    name: 'Slack',
    category: 'Messaging',
    siSlug: 'siSlack',
    fill: null,
    tile: false,
    aliases: ['slack'],
  },

  // ── Observability ─────────────────────────────────────────────────────
  {
    id: 'saas-datadog',
    name: 'Datadog',
    category: 'Observability',
    siSlug: 'siDatadog',
    fill: null,
    tile: false,
    aliases: ['datadog'],
  },
  {
    id: 'saas-sentry',
    name: 'Sentry',
    category: 'Observability',
    siSlug: 'siSentry',
    fill: null,
    tile: false,
    aliases: ['sentry'],
  },

  // ── DevOps & CI/CD ───────────────────────────────────────────────────
  {
    id: 'saas-github',
    name: 'GitHub',
    category: 'DevOps & CI/CD',
    siSlug: 'siGithub',
    fill: null,
    tile: false,
    aliases: ['github'],
  },
  {
    id: 'saas-github-actions',
    name: 'GitHub Actions',
    category: 'DevOps & CI/CD',
    siSlug: 'siGithubactions',
    fill: null,
    tile: false,
    aliases: ['github-actions', 'gha'],
  },
  {
    id: 'saas-gitlab',
    name: 'GitLab',
    category: 'DevOps & CI/CD',
    siSlug: 'siGitlab',
    fill: null,
    tile: false,
    aliases: ['gitlab'],
  },
  {
    id: 'saas-docker',
    name: 'Docker',
    category: 'DevOps & CI/CD',
    siSlug: 'siDocker',
    fill: null,
    tile: false,
    aliases: ['docker'],
  },
  {
    id: 'saas-kubernetes',
    name: 'Kubernetes',
    category: 'DevOps & CI/CD',
    siSlug: 'siKubernetes',
    fill: null,
    tile: false,
    aliases: ['kubernetes', 'k8s'],
  },
  {
    id: 'saas-terraform',
    name: 'Terraform',
    category: 'DevOps & CI/CD',
    siSlug: 'siTerraform',
    fill: null,
    tile: false,
    aliases: ['terraform'],
  },

  // ── AI ────────────────────────────────────────────────────────────────
  {
    id: 'saas-openai',
    name: 'OpenAI',
    category: 'AI',
    siSlug: 'siOpenai',
    fill: null,
    tile: false,
    aliases: ['openai'],
  },
  {
    id: 'saas-anthropic',
    name: 'Anthropic',
    category: 'AI',
    siSlug: 'siAnthropic',
    fill: null,
    tile: false,
    aliases: ['anthropic', 'claude'],
  },
];
