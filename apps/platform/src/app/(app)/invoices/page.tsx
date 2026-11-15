import { Suspense } from 'react'

import { InvoicesPage } from '@/components/invoices/invoices-page'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The list's state lives in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="invoices" />

      <Suspense fallback={<PageLoading />}>
        <InvoicesPage />
      </Suspense>
    </>
  )
}
