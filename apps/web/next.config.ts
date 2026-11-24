import type { NextConfig } from 'next'

const config: NextConfig = {
  agentRules: false, // the root AGENTS.md is the only agent guide
  devIndicators: false,
  allowedDevOrigins: ['*.helvetly.com'], // pnpm dev:tunnel (scripts/dev-tunnel.sh)
  // Static files only (out/): every page is known at build time. Served by Cloudflare Workers Static Assets at helvetly.com.
  output: 'export',
  images: { unoptimized: true }, // no image server in a static export
  // One build serves every language: English at the root, the others under /<language> (app/[lang]).
  transpilePackages: ['@helvetly/ui', '@helvetly/i18n'],
  // Two root layouts ((default) and [lang]) leave no single layout for unmatched URLs.
  experimental: { globalNotFound: true },
  // Next's own polyfills (Array.prototype.at, Object.hasOwn…) are for browsers older than the ones it supports.
  turbopack: {
    resolveAlias: { '../build/polyfills/polyfill-module': './src/no-polyfills.ts' },
  },
}

export default config
