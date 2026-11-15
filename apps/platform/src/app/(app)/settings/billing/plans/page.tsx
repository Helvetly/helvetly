import { ChangePlan } from '@/components/billing/change-plan'
import { PageTitle } from '@/components/page-title'

export default function PlansPage() {
  return (
    <>
      <PageTitle message="plans" />
      <ChangePlan />
    </>
  )
}
