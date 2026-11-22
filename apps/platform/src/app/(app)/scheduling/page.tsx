import { Suspense } from 'react'

import { PageTitle } from '@/components/page-title'
import { SchedulingPage } from '@/components/scheduling/scheduling-page'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The page reads ?view=, ?date= and ?session= (useSearchParams), which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="schedScheduling" />

      <Suspense fallback={<PageLoading />}>
        <SchedulingPage />
      </Suspense>
    </>
  )
}
