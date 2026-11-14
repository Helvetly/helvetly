import type { Metadata } from 'next'

import { ChangePlan } from '@/components/billing/change-plan'

export const metadata: Metadata = { title: 'Plans' }

export default function PlansPage() {
  return <ChangePlan />
}
