import { localizedNextConfig } from '@helvetly/i18n/next'
import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

const apiUrl = process.env.API_URL ?? 'http://localhost:3333'

// Production is a static export embedded into the Go binary (apps/api), so the platform
// can use no server runtime: no route handlers, server actions, or request-time rendering.
// In development, `next dev` proxies /api to the Go server instead.
export default function config(phase: string): NextConfig {
  // agentRules: our root AGENTS.md is the only agent guide; next dev would write its own.
  const base: NextConfig = {
    agentRules: false,
    devIndicators: false,
    // pnpm dev:tunnel serves next dev on dev-*.helvetly.com (scripts/dev-tunnel.sh).
    allowedDevOrigins: ['*.helvetly.com'],
    ...localizedNextConfig,
  }
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      ...(process.env.HELVETLY_E2E_NEXT_DIST ? { distDir: '.next-e2e' } : {}),
      rewrites: async () => [
        { source: '/api/:path*', destination: `${apiUrl}/api/:path*`, basePath: false },
      ],
      // The proxy buffers 10 MB by default; uploads send up to 95 MB per request, which the API checks itself.
      experimental: { proxyClientMaxBodySize: '100mb' },
      // msw/browser has no `node` export, so the SSR pass of the dev server can't resolve it
      // even though it only runs in the browser; point both passes at the browser build.
      turbopack: { resolveAlias: { 'msw/browser': './node_modules/msw/lib/browser/index.js' } },
    }
  }
  return { ...base, output: 'export', trailingSlash: true, images: { unoptimized: true } }
}
