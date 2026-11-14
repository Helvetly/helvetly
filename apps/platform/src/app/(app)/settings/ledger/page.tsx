import type { Metadata } from 'next'

import { LedgerPage } from '@/components/settings/ledger'

export const metadata: Metadata = { title: 'Ledger' }

export default function Page() {
  return <LedgerPage />
}
