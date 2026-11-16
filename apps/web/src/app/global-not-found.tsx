import { defaultLocale } from '@helvetly/i18n'

import { NotFoundView } from '@/components/not-found-view'
import { SiteShell, siteMetadata } from '@/components/site-shell'

// Unmatched URLs: with two root layouts ((default) and [lang]) there is no single layout to render them in.
export const metadata = siteMetadata(defaultLocale)

export default function GlobalNotFound() {
  return (
    <SiteShell lang={defaultLocale}>
      <NotFoundView />
    </SiteShell>
  )
}
