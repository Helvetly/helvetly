import type { Metadata } from 'next'

import { InvoiceSettingsPage } from '@/components/settings/invoice-settings'

export const metadata: Metadata = { title: 'Invoice settings' }

export default function Page() {
  return <InvoiceSettingsPage />
}
