import { Suspense } from 'react'

import { ExpensesPage } from '@/components/expenses/expenses-page'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The list's state lives in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="expenses" />

      <Suspense fallback={<PageLoading />}>
        <ExpensesPage />
      </Suspense>
    </>
  )
}
