import { RootLayout } from '@helvetly/ui/components/root-layout'

import '@helvetly/ui/globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Providers } from '@/components/providers'

// The app is never for search engines; the website (apps/web) is.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // D (the theme) is one of the platform's own shortcuts (lib/shortcuts).
    <RootLayout themeHotkey={false}>
      <Providers>{children}</Providers>
    </RootLayout>
  )
}
