import type { Metadata } from 'next'
import { Suspense } from 'react'

import { DocumentsPage } from '@/components/documents/documents-page'
import { PageLoading } from '@/components/shell/page-loading'

export const metadata: Metadata = { title: 'Documents' }

export default function Page() {
  // The folder, view and open file live in the URL (useSearchParams), which needs a boundary in a
  // static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <DocumentsPage />
    </Suspense>
  )
}
