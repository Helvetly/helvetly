import { Suspense } from 'react'

import { EngagementsPage } from '@/components/engagements/engagements-page'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The page reads ?id= and ?new= (useSearchParams), which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="engagements" />

      <Suspense fallback={<PageLoading />}>
        <EngagementsPage />
      </Suspense>
    </>
  )
}
