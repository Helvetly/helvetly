import type { Metadata } from 'next'

import { PortalInvoices } from '@/components/portal-invoices'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('invoices') }

export default function PortalInvoicesPage() {
  return <PortalInvoices />
}
