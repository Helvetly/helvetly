import '@helvetly/ui/globals.css'
import { RootLayout } from '@helvetly/ui/components/root-layout'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: { default: 'Client portal', template: '%s · Client portal' },
  description: 'Your invoices, engagements and documents.',
  robots: { index: false },
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <RootLayout>
      <Providers>{children}</Providers>
    </RootLayout>
  )
}
