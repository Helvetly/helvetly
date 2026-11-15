import { locale, localizedAlternates } from '@helvetly/i18n'
import { ThemeProvider } from '@helvetly/ui/components/theme-provider'

import './site.css'
import { fontClassName } from '@helvetly/ui/lib/fonts'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Analytics } from '@/components/analytics'
import { RevealObserver } from '@/components/reveal-observer'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = {
  alternates: localizedAlternates('/'),

  metadataBase: new URL('https://www.helvetly.com'),
  title: {
    default: translate('helvetlyTheCalmBackOfficeForSwissCompanies'),
    template: '%s · Helvetly',
  },
  description: translate('invoicesWithSwissQRBillsExpensesClientsESignatures'),
  openGraph: { type: 'website', siteName: translate('helvetly') },
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={locale} suppressHydrationWarning className={fontClassName}>
      {/* Browser extensions (Grammarly, ColorZilla…) add attributes to <body> before hydration; not our markup. */}
      <body className="min-h-svh" suppressHydrationWarning>
        <ThemeProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
          <RevealObserver />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}
