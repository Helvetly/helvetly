import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

import slugs from '../../packages/i18n/src/route-slugs.json'
import { publicRedirects } from './src/lib/public-redirects'

const config: NextConfig = {
  agentRules: false, // the root AGENTS.md is the only agent guide
  devIndicators: false,
  allowedDevOrigins: ['*.helvetly.com'], // pnpm dev:tunnel (scripts/dev-tunnel.sh)
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

export default function webConfig(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    // next dev does not serve Cloudflare's _redirects. Comparison pages keep the competitor's slug.
    const paths = Object.keys(slugs).filter((path) => path !== '/help/topic')
    return {
      ...config,
      skipTrailingSlashRedirect: true,
      redirects: async () => publicRedirects([...paths, '/compare/:brand']),
    }
  }
  return { ...config, output: 'export' }
}
