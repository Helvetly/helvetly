import { PageTitle } from '@/components/page-title'
import { DocumentSettingsPage } from '@/components/settings/document-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="documents" />
      <DocumentSettingsPage />
    </>
  )
}
