import type { Metadata } from 'next'
import { Suspense } from 'react'

import { BillingSettings } from '@/components/billing/billing-settings'
import { PageLoading } from '@/components/shell/page-loading'

export const metadata: Metadata = { title: 'Plan & billing' }

export default function BillingPage() {
  // The return from Checkout is read from the URL (useSearchParams): a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <BillingSettings />
    </Suspense>
  )
}
