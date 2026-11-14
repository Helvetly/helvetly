import type { Metadata } from 'next'

import { VATReturnPage } from '@/components/settings/vat-return'

export const metadata: Metadata = { title: 'VAT return' }

export default function Page() {
  return <VATReturnPage />
}
