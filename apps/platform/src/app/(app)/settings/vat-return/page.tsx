import type { Metadata } from 'next'

import { VATReturnPage } from '@/components/settings/vat-return'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('vatReturn') }

export default function Page() {
  return <VATReturnPage />
}
