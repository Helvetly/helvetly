import { Suspense } from 'react'

import { ClientsPage } from '@/components/clients/clients-page'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The list's state lives in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="clients" />

      <Suspense fallback={<PageLoading />}>
        <ClientsPage />
      </Suspense>
    </>
  )
}
