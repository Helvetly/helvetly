import type { Metadata } from 'next'
import { Suspense } from 'react'

import { QuotesPage } from '@/components/quotes/quotes-page'
import { PageLoading } from '@/components/shell/page-loading'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('quotes') }

export default function Page() {
  // The view, the open quote and a new one live in the URL (useSearchParams): a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <QuotesPage />
    </Suspense>
  )
}
