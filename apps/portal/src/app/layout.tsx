import { RootLayout } from '@helvetly/ui/components/root-layout'

import '@helvetly/ui/globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Providers } from '@/components/providers'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = {
  title: { default: translate('clientPortal'), template: '%s · Client portal' },
  description: translate('yourInvoicesEngagementsAndDocuments'),
  robots: { index: false },
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <RootLayout>
      <Providers>{children}</Providers>
    </RootLayout>
  )
}
