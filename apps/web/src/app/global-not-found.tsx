import { defaultLocale } from '@helvetly/i18n'

import { NotFoundView } from '@/components/not-found-view'
import { SiteShell } from '@/components/site-shell'
import { notFoundMetadata } from '@/lib/metadata'

// Unmatched URLs: with two root layouts ((default) and [lang]) there is no single layout to render them in.
// Next adds noindex to the global 404. Localized static 404 pages set it themselves.
export const metadata = { ...notFoundMetadata(defaultLocale), robots: null }

export default function GlobalNotFound() {
  return (
    <SiteShell lang={defaultLocale}>
      <NotFoundView />
    </SiteShell>
  )
}
