import { llmsTxt } from '@/lib/llms'

// Generated once at build time: the site is a static export.
export const dynamic = 'force-static'

export function GET() {
  return new Response(llmsTxt(), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
