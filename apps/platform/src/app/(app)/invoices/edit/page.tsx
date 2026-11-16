import { Suspense } from 'react'

import { InvoicesPage } from '@/components/invoices/invoices-page'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // Older links: the list renders with the editor drawer open. The URL's state needs a boundary in a static export.
  return (
    <>
      <PageTitle message="editInvoice" />

      <Suspense fallback={<PageLoading />}>
        <InvoicesPage />
      </Suspense>
    </>
  )
}
