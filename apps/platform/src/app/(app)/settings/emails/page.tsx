import { PageTitle } from '@/components/page-title'
import { EmailTemplatesSettingsPage } from '@/components/settings/email-templates-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="emailTemplatesTitle" />
      <EmailTemplatesSettingsPage />
    </>
  )
}
