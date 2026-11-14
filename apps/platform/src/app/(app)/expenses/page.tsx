import type { Metadata } from 'next'
import { Suspense } from 'react'

import { ExpensesPage } from '@/components/expenses/expenses-page'
import { PageLoading } from '@/components/shell/page-loading'

export const metadata: Metadata = { title: 'Expenses' }

export default function Page() {
  // The list's state lives in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <ExpensesPage />
    </Suspense>
  )
}
