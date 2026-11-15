import { localizedNextConfig } from '@helvetly/i18n/next'
import type { NextConfig } from 'next'

const config: NextConfig = {
  agentRules: false, // the root AGENTS.md is the only agent guide
  devIndicators: false,
  allowedDevOrigins: ['*.helvetly.com'], // pnpm dev:tunnel (scripts/dev-tunnel.sh)
  // Static files only (out/): every page is known at build time. Served by Cloudflare Pages at helvetly.com.
  output: 'export',
  images: { unoptimized: true }, // no image server in a static export
  ...localizedNextConfig,
}

export default config
