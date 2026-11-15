import './site.css'
import { ThemeProvider } from '@helvetly/ui/components/theme-provider'
import type { Metadata } from 'next'
import { Geist_Mono, Instrument_Serif, Inter } from 'next/font/google'
import type { ReactNode } from 'react'

import { RevealObserver } from '@/components/reveal-observer'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { cn } from '@/lib/cn'

// The app's fonts (as RootLayout) plus a serif for the accent words in headlines.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-serif',
})

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
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('font-sans antialiased', sans.variable, mono.variable, serif.variable)}
    >
      {/* Browser extensions (Grammarly, ColorZilla…) add attributes to <body> before hydration; not our markup. */}
      <body className="min-h-svh" suppressHydrationWarning>
        <ThemeProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
          <RevealObserver />
        </ThemeProvider>
      </body>
    </html>
  )
}
