import { Suspense } from 'react'

import { PageTitle } from '@/components/page-title'
import { QuotesPage } from '@/components/quotes/quotes-page'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The view, the open quote and a new one live in the URL (useSearchParams): a boundary in a static export.
  return (
    <>
      <PageTitle message="quotes" />

      <Suspense fallback={<PageLoading />}>
        <QuotesPage />
      </Suspense>
    </>
  )
}
