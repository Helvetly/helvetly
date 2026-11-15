import './site.css'
import { ThemeProvider } from '@helvetly/ui/components/theme-provider'
import { fontClassName } from '@helvetly/ui/lib/fonts'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Analytics } from '@/components/analytics'
import { RevealObserver } from '@/components/reveal-observer'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.helvetly.com'),
  title: {
    default: 'Helvetly · The calm back office for Swiss companies',
    template: '%s · Helvetly',
  },
  description:
    'Invoices with Swiss QR bills, expenses, clients, e-signatures, e-invoicing and the VAT return in one place, with Heidi, an AI assistant that knows your books.',
  openGraph: { type: 'website', siteName: 'Helvetly' },
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={fontClassName}>
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
