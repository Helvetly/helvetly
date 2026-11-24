import { publicPaths } from '@/lib/public-paths'
import { publicRedirects } from '@/lib/public-redirects'

// Cloudflare Workers Static Assets reads this file from the export as /_redirects.
export const dynamic = 'force-static'

export function GET() {
  const rules = publicRedirects(publicPaths()).map(
    ({ source, destination, statusCode }) => `${source} ${destination} ${statusCode}`,
  )
  return new Response(rules.join('\n') + '\n')
}
