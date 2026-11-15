import type { Metadata } from 'next'
import { Suspense } from 'react'

import { BillingSettings } from '@/components/billing/billing-settings'
import { PageLoading } from '@/components/shell/page-loading'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('planBilling') }

export default function BillingPage() {
  // The return from Checkout is read from the URL (useSearchParams): a boundary in a static export.
  return (
    <Suspense fallback={<PageLoading />}>
      <BillingSettings />
    </Suspense>
  )
}
