import { Suspense } from 'react'

import { InvoiceEditorPage } from '@/components/invoices/invoice-editor'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The draft's id (and a preset client) come from the URL, which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="editInvoice" />

      <Suspense fallback={<PageLoading />}>
        <InvoiceEditorPage />
      </Suspense>
    </>
  )
}
