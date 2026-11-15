import { Suspense } from 'react'

import { BillingSettings } from '@/components/billing/billing-settings'
import { PageTitle } from '@/components/page-title'
import { PageLoading } from '@/components/shell/page-loading'

export default function BillingPage() {
  // Checkout returns through the URL, so the page needs a Suspense boundary.
  return (
    <>
      <PageTitle message="planBilling" />
      <Suspense fallback={<PageLoading />}>
        <BillingSettings />
      </Suspense>
    </>
  )
}
