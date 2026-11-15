import { Suspense } from 'react'

import { DocumentsPage } from '@/components/documents/documents-page'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The folder, view and open file live in the URL (useSearchParams), which needs a boundary in a
  // static export.
  return (
    <>
      <PageTitle message="documents" />

      <Suspense fallback={<PageLoading />}>
        <DocumentsPage />
      </Suspense>
    </>
  )
}
