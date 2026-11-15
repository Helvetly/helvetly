import type { Metadata } from 'next'

import { PeriodsSettings } from '@/components/settings/periods-settings'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('monthEndClose') }

export default function Page() {
  return <PeriodsSettings />
}
