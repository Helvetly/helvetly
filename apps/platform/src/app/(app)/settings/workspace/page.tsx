import type { Metadata } from 'next'

import { WorkspaceSettings } from '@/components/settings/workspace-settings'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('workspace') }

export default function WorkspacePage() {
  return <WorkspaceSettings />
}
