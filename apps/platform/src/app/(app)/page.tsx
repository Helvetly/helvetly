import type { Metadata } from 'next'

import { Dashboard } from '@/components/dashboard/dashboard'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('home') }

export default function DashboardPage() {
  return <Dashboard />
}
