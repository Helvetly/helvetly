import type { Metadata } from 'next'

import { ChangePlan } from '@/components/billing/change-plan'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('plans') }

export default function PlansPage() {
  return <ChangePlan />
}
