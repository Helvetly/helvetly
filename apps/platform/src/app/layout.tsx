import { RootLayout } from '@helvetly/ui/components/root-layout'

import '@helvetly/ui/globals.css'
import type { ReactNode } from 'react'

import { Providers } from '@/components/providers'

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // D (the theme) is one of the platform's own shortcuts (lib/shortcuts).
    <RootLayout themeHotkey={false}>
      <Providers>{children}</Providers>
    </RootLayout>
  )
}
