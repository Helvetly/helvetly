import type { Metadata } from 'next'

import { ChoosePlan } from '@/components/shell/plan-gate'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('chooseAPlan') }

export default function ChoosePlanPage() {
  return <ChoosePlan />
}
