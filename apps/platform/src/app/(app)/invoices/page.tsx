import type { Metadata } from 'next'
import { Suspense } from 'react'

import { InvoicesPage } from '@/components/invoices/invoices-page'
import { PageLoading } from '@/components/shell/page-loading'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('invoices') }

export default function Page() {
  // The list's state lives in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <InvoicesPage />
    </Suspense>
  )
}
