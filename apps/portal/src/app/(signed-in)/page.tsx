import type { Metadata } from 'next'

import { PortalOverview } from '@/components/portal-overview'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('overview') }

export default function PortalPage() {
  return <PortalOverview />
}
