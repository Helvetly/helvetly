import { PageTitle } from '@/components/page-title'
import { WorkspaceSettings } from '@/components/settings/workspace-settings'

export default function WorkspacePage() {
  return (
    <>
      <PageTitle message="workspace" />
      <WorkspaceSettings />
    </>
  )
}
