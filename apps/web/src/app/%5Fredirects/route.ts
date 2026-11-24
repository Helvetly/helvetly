import { defaultLocale, isLocale, locales, localizedHref } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'

import { publicPaths } from '@/lib/public-paths'

// Cloudflare Workers Static Assets reads this file from the export as /_redirects.
export const dynamic = 'force-static'

export function GET() {
  const paths = publicPaths()
  const rules = Object.keys(locales)
    .filter(isLocale)
    .filter((lang) => lang !== defaultLocale)
    .flatMap((lang) =>
      paths.flatMap((path) => {
        const old = localizedHref(path, lang)
        const target = publicHref(path, lang)
        return old === target
          ? []
          : [old, old + '/', old + '.html'].map((alias) => `${alias} ${target} 301`)
      }),
    )
  return new Response(rules.join('\n') + '\n')
}
