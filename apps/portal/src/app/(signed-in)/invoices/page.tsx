import { PageTitle } from '@/components/page-title'
import { PortalInvoices } from '@/components/portal-invoices'

export default function PortalInvoicesPage() {
  return (
    <>
      <PageTitle message="invoices" />
      <PortalInvoices />
    </>
  )
}
