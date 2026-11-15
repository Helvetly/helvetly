import type { Metadata } from 'next'

import { LedgerPage } from '@/components/settings/ledger'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('ledger') }

export default function Page() {
  return <LedgerPage />
}
