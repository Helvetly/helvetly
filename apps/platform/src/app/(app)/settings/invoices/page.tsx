import type { Metadata } from 'next'

import { InvoiceSettingsPage } from '@/components/settings/invoice-settings'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('invoiceSettings') }

export default function Page() {
  return <InvoiceSettingsPage />
}
