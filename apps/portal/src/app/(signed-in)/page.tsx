import type { Metadata } from 'next'

import { PortalOverview } from '@/components/portal-overview'

export const metadata: Metadata = { title: 'Overview' }

export default function PortalPage() {
  return <PortalOverview />
}
