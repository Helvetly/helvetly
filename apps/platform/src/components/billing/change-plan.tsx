'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { PlanScreen } from '@/components/shell/plan-gate'
import { errorMessage } from '@/lib/api'
import { people, trialDaysLeft, useBilling, usePublicOffer, type Billing } from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { PlanCards } from './plan-cards'

/**
 * The plan picker, a full-screen page reached from Plan & billing's "Change plan"; Checkout and a
 * change in place return to Plan & billing.
 */
export function ChangePlan() {
  const billing = useBilling()
  const offer = usePublicOffer()
  const data = billing.data
  return (
    <PlanScreen
      action={
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Link href="/settings/billing">
            <ArrowLeft className="size-3.5" aria-hidden />
            {translate('backToBilling')}
          </Link>
        </Button>
      }
    >
      <div className="grid max-w-2xl justify-items-center gap-4 text-center">
        <h1 className="text-display font-semibold tracking-[-0.035em] text-balance">
          {data?.plan ? translate('changeYourPlan') : translate('chooseAPlan')}
        </h1>
        <p className="max-w-xl text-title-sm text-pretty text-muted-foreground">
          {translate('onePricePerPersonTheWholeTeamIncluded')}
          {data && data.seats > 0
            ? translate('inThisWorkspaceNow', { value1: people(data.seats) })
            : ''}
          {translate('addPeopleOrMoveUpWhenYouGrowThe')}
        </p>
        {data && <CurrentPlanPill billing={data} />}
      </div>
      <div className="mt-12 w-full max-w-[1080px]">
        {billing.error ? (
          <p role="alert" className="text-center text-sm text-muted-foreground">
            {translate('plansCouldnTBeLoaded')}
            {errorMessage(billing.error)}
          </p>
        ) : !data ? (
          <Loader label={translate('loadingPlans')} className="min-h-96" />
        ) : (
          <PlanCards billing={data} offer={offer.data} />
        )}
      </div>
    </PlanScreen>
  )
}

/** Where the workspace stands, in the hero's words: the plan, its status and the trial's days left. */
function CurrentPlanPill({ billing }: { billing: Billing }) {
  const plan = billing.plans.find((entry) => entry.id === billing.plan)
  if (!plan) return null
  const trial = billing.status === 'trialing' && billing.trial_end
  const left = trial ? trialDaysLeft(billing.trial_end ?? '') : 0
  return (
    <p
      data-slot="current-plan-pill"
      className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full bg-card px-3.5 py-1.5 text-body-sm shadow-elevation-1"
    >
      <span className="size-2 rounded-full bg-brand-solid" aria-hidden />
      <span>
        {translate('youReOn')}
        <span className="font-medium">{plan.name}</span>
      </span>
      {trial && (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground tabular-nums">
            {left === 0
              ? translate('trialEndsToday')
              : translate('leftInTheTrial', { left: left, value2: left === 1 ? 'day' : 'days' })}
          </span>
        </>
      )}
    </p>
  )
}
