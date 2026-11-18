import '@/app/site.css'
import type { Locale } from '@helvetly/i18n'
import { LanguageProvider } from '@helvetly/ui/components/language-provider'
import { ThemeProvider } from '@helvetly/ui/components/theme-provider'
import { TranslatorSafeDom } from '@helvetly/ui/components/translator-safe-dom'
import { fontClassName } from '@helvetly/ui/lib/fonts'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Analytics } from '@/components/analytics'
import { RevealObserver } from '@/components/reveal-observer'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { WebMcp } from '@/components/webmcp'
import { translatorFor } from '@/lib/i18n'
import { pageMetadata, SITE_URL, TITLE_TEMPLATE } from '@/lib/metadata'

/** The home page's metadata, which every page without its own inherits, and the title template. */
export function siteMetadata(lang: Locale): Metadata {
  const translate = translatorFor(lang)
  const title = translate('metaHomeTitle')
  return {
    ...pageMetadata(lang, '/', { absolute: title }, translate('metaHomeDescription')),
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: TITLE_TEMPLATE },
  }
}

/** The document every page shares, in one language: both root layouts and the global 404 render it. */
export function SiteShell({ lang, children }: { lang: Locale; children: ReactNode }) {
  return (
    <html lang={lang} suppressHydrationWarning className={fontClassName}>
      {/* Browser extensions (Grammarly, ColorZilla…) add attributes to <body> before hydration; not our markup. */}
      <body className="min-h-svh" suppressHydrationWarning>
        <TranslatorSafeDom />
        <ThemeProvider>
          <LanguageProvider language={lang}>
            <SiteHeader />
            {children}
            <SiteFooter lang={lang} />
            <RevealObserver />
            <Analytics />
            <WebMcp lang={lang} />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
