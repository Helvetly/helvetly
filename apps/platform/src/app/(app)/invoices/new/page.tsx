import type { Metadata } from 'next'
import { Suspense } from 'react'

import { InvoiceEditorPage } from '@/components/invoices/invoice-editor'
import { PageLoading } from '@/components/shell/page-loading'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('newInvoice') }

export default function Page() {
  // The draft's id (and a preset client) come from the URL, which needs a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <InvoiceEditorPage />
    </Suspense>
  )
}
