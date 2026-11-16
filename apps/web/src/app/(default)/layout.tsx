import { defaultLocale } from '@helvetly/i18n'
import type { ReactNode } from 'react'

import { SiteShell, siteMetadata } from '@/components/site-shell'

// English pages keep the site's root URLs; the routes re-export the pages of app/[lang] (see its layout).
export const metadata = siteMetadata(defaultLocale)

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return <SiteShell lang={defaultLocale}>{children}</SiteShell>
}
