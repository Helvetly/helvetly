import type { Metadata } from 'next'

import { PortalInvoices } from '@/components/portal-invoices'

export const metadata: Metadata = { title: 'Invoices' }

export default function PortalInvoicesPage() {
  return <PortalInvoices />
}
