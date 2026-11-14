import type { Metadata } from 'next'

import { PeriodsSettings } from '@/components/settings/periods-settings'

export const metadata: Metadata = { title: 'Month-end close' }

export default function Page() {
  return <PeriodsSettings />
}
