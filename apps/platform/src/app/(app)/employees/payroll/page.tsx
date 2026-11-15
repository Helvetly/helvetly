import type { Metadata } from 'next'
import { Suspense } from 'react'

import { PayrollPage } from '@/components/employees/payroll-page'
import { PageLoading } from '@/components/shell/page-loading'

export const metadata: Metadata = { title: 'Payroll' }

export default function Page() {
  // The month and the open entry live in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <PayrollPage />
    </Suspense>
  )
}
