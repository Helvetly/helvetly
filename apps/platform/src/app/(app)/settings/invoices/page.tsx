import { PageTitle } from '@/components/page-title'
import { InvoiceSettingsPage } from '@/components/settings/invoice-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="invoiceSettings" />
      <InvoiceSettingsPage />
    </>
  )
}
