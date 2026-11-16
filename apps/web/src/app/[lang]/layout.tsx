import { defaultLocale, locales } from '@helvetly/i18n'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { SiteShell, siteMetadata } from '@/components/site-shell'
import { languageOf } from '@/lib/i18n'

// One build serves every language. A static export has no middleware to rewrite URLs, so English lives in
// app/(default) at the root and every other language here under /<lang>; both trees render the same pages.
type Props = Readonly<{ children: ReactNode; params: Promise<{ lang: string }> }>

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(locales)
    .filter((lang) => lang !== defaultLocale)
    .map((lang) => ({ lang }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return siteMetadata(await languageOf(params))
}

export default async function Layout({ children, params }: Props) {
  return <SiteShell lang={await languageOf(params)}>{children}</SiteShell>
}
