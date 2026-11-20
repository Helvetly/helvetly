import { PageTitle } from '@/components/page-title'
import { ApprovalsSettings } from '@/components/settings/approvals-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="approvals" />
      <ApprovalsSettings />
    </>
  )
}
