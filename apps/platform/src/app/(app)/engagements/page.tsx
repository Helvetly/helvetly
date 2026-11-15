import type { Metadata } from 'next'
import { Suspense } from 'react'

import { EngagementsPage } from '@/components/engagements/engagements-page'
import { PageLoading } from '@/components/shell/page-loading'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('engagements') }

export default function Page() {
  // The page reads ?id= and ?new= (useSearchParams), which needs a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <EngagementsPage />
    </Suspense>
  )
}
