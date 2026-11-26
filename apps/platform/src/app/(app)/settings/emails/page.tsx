import { PageTitle } from '@/components/page-title'
import { ClientEmailsSettings } from '@/components/settings/client-emails'

export default function ClientEmailsPage() {
  return (
    <>
      <PageTitle message="clientEmails" />
      <ClientEmailsSettings />
    </>
  )
}
