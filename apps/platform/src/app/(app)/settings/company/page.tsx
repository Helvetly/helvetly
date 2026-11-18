import { PageTitle } from '@/components/page-title'
import { CompanySettingsPage } from '@/components/settings/invoice-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="company" />
      <CompanySettingsPage />
    </>
  )
}
