import { Suspense } from 'react'

import { PageTitle } from '@/components/page-title'
import { ProductsPage } from '@/components/products/products-page'
import { PageLoading } from '@/components/shell/page-loading'

export default function Page() {
  // The list's state lives in the URL (useSearchParams), which needs a boundary in a static export.
  return (
    <>
      <PageTitle message="productsServices" />

      <Suspense fallback={<PageLoading />}>
        <ProductsPage />
      </Suspense>
    </>
  )
}
