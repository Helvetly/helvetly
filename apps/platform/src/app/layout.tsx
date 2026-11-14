import '@helvetly/ui/globals.css'
import { RootLayout } from '@helvetly/ui/components/root-layout'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: { default: 'Helvetly', template: '%s · Helvetly' },
  description: 'Helvetly platform.',
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // D (the theme) is one of the platform's own shortcuts (lib/shortcuts).
    <RootLayout themeHotkey={false}>
      <Providers>{children}</Providers>
    </RootLayout>
  )
}
