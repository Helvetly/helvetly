'use client'

import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { PlanScreen } from '@/components/shell/plan-gate'
import { errorMessage } from '@/lib/api'
import { people, trialDaysLeft, useBilling, type Billing } from '@/lib/billing'

import { PlanCards } from './plan-cards'
import { PlanComparison } from './plan-extras'

/**
 * The plan picker, a full-screen page reached from Plan & billing's "Change plan"; Checkout and a
 * change in place return to Plan & billing.
 */
export function ChangePlan() {
  const billing = useBilling()
  const data = billing.data
  return (
    <PlanScreen
      action={
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Link href="/settings/billing">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to billing
          </Link>
        </Button>
      }
    >
      <div className="grid max-w-2xl justify-items-center gap-4 text-center">
        <h1 className="text-display font-semibold tracking-[-0.035em] text-balance">
          {data?.plan ? 'Change your plan' : 'Choose a plan'}
        </h1>
        <p className="max-w-xl text-title-sm text-pretty text-muted-foreground">
          One price per person, the whole team included
          {data && data.seats > 0 ? ` (${people(data.seats)} in this workspace now)` : ''}. Add
          people or move up when you grow; the difference is prorated to the day.
        </p>
        {data && <CurrentPlanPill billing={data} />}
      </div>
      <div className="mt-12 w-full max-w-[1080px]">
        {billing.error ? (
          <p role="alert" className="text-center text-sm text-muted-foreground">
            Plans couldn’t be loaded: {errorMessage(billing.error)}
          </p>
        ) : !data ? (
          <Loader label="Loading plans" className="min-h-96" />
        ) : (
          <PlanCards billing={data} />
        )}
      </div>
      {data && (
        <>
          <PlanComparison plans={data.plans} current={data.plan} />
        </>
      )}
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
        You’re on <span className="font-medium">{plan.name}</span>
      </span>
      {trial && (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground tabular-nums">
            {left === 0
              ? 'Trial ends today'
              : `${left} ${left === 1 ? 'day' : 'days'} left in the trial`}
          </span>
        </>
      )}
    </p>
  )
}
