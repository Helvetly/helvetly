import { PageTitle } from '@/components/page-title'
import { RedirectToWorkspaceEmails } from '@/components/settings/redirect-to-workspace-emails'

/** Email templates moved into the workspace settings; old links and bookmarks land there. */
export default function Page() {
  return (
    <>
      <PageTitle message="workspace" />
      <RedirectToWorkspaceEmails />
    </>
  )
}
