import { browserLanguageNextConfig } from '@helvetly/i18n/next'
import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

const apiUrl = process.env.API_URL ?? 'http://localhost:3333'

// Like apps/platform: a static export the Go binary embeds and serves on PORTAL_URL's host, so no
// server runtime. In development, `next dev` proxies /api to the Go server instead.
export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    agentRules: false,
    devIndicators: false,
    // pnpm dev:tunnel serves next dev on dev-*.helvetly.com (scripts/dev-tunnel.sh).
    allowedDevOrigins: ['*.helvetly.com'],
    ...browserLanguageNextConfig,
  }
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      ...(process.env.HELVETLY_E2E_NEXT_DIST ? { distDir: '.next-e2e' } : {}),
      rewrites: async () => [
        { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
        // A workspace's own portal (/w/<slug>/), as the Go server serves it: API calls keep the prefix, pages drop it.
        { source: '/w/:slug/api/:path*', destination: `${apiUrl}/w/:slug/api/:path*` },
        { source: '/w/:slug', destination: '/' },
        { source: '/w/:slug/:path*', destination: '/:path*' },
      ],
    }
  }
  return { ...base, output: 'export', trailingSlash: true, images: { unoptimized: true } }
}
