'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { PlanBadge } from '@helvetly/ui/components/plan-badge'
import { cn } from '@helvetly/ui/lib/utils'
import { Download, Lock } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import type { MenuKit } from '@/components/data/menus'
import {
  FEATURE_LABELS,
  lockedFeature,
  useBilling,
  type Billing,
  type FeatureKey,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

export const PLANS_HREF = '/settings/billing/plans'

/** A feature the workspace's plan lacks: the plan that has it and a short reason; null while allowed. */
export function featureLock(billing: Billing | undefined, feature: FeatureKey) {
  // without a plan the whole workspace is read-only and says so; no tag on every entry point
  if (billing?.plan === '') return null
  const locked = lockedFeature(billing, feature)
  if (!locked) return null
  const name = FEATURE_LABELS[feature]
  return {
    plan: locked.plan,
    hint: locked.plan
      ? translate('yourPlanDoesntIncludeDoes', { name, plan: locked.plan.name })
      : translate('yourPlanDoesntInclude', { name }),
  }
}

export type FeatureLock = ReturnType<typeof featureLock>

const seeLabel = (lock: NonNullable<FeatureLock>) =>
  lock.plan ? translate('see2', { name: lock.plan.name }) : translate('seePlans')

/**
 * Employees and payroll are not shown at all on a plan without them, unless the owner still has records to read and
 * export (a downgrade): then the pages stay, read-only. While billing loads they are hidden too, so nothing flashes
 * in and out; a member who cannot read billing (it errors) sees them as before, the API still guards them.
 */
export const employeesHidden = (billing: Billing | undefined, loading = false) =>
  loading || (Boolean(featureLock(billing, 'employees')) && !billing?.has_employees)

/**
 * Billing and whether its first answer is still to come. A refused read (a member without billing access) is not
 * "loading", even though React Query flips an errored query back to pending on every refetch.
 */
export function useBillingStatus() {
  const { data, isPending, errorUpdateCount } = useBilling()
  return { billing: data, loading: isPending && errorUpdateCount === 0 }
}

export function useEmployeesHidden() {
  const { billing, loading } = useBillingStatus()
  return employeesHidden(billing, loading)
}

/** `featureLock` for the signed-in workspace. */
export const useFeatureLock = (feature: FeatureKey) => featureLock(useBilling().data, feature)

/** The plan an entry point needs, as a small tag beside its label: "🔒 Pro". */
export function PlanTag({
  lock,
  className,
}: {
  lock: NonNullable<FeatureLock>
  className?: string
}) {
  return (
    <PlanBadge
      plan={lock.plan?.id}
      locked
      data-slot="plan-tag"
      className={cn('ml-auto', className)}
    >
      {lock.plan?.name ?? translate('upgrade')}
      <span className="sr-only">: {lock.hint}</span>
    </PlanBadge>
  )
}

/** A toast for an entry point the plan lacks, with the way to the plans. */
export function toastLocked(
  lock: NonNullable<FeatureLock>,
  seePlans = () => window.location.assign(PLANS_HREF),
) {
  toast(`${lock.hint}.`, {
    id: `locked-${lock.hint}`,
    action: { label: seeLabel(lock), onClick: seePlans },
  })
}

/** Why a page's new work is off, in the page's content: what stays available and the way to the plans. */
export function FeatureLockNotice({
  lock,
  kept,
  className,
}: {
  lock: FeatureLock
  /** What still works, e.g. "Expenses you already have stay available." */
  kept: string
  className?: string
}) {
  if (!lock) return null
  return (
    <Callout
      data-slot="feature-lock-notice"
      tone="warning"
      className={className}
      icon={Lock}
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href={PLANS_HREF}>{seeLabel(lock)}</Link>
        </Button>
      }
    >
      {lock.hint}. {kept}
    </Callout>
  )
}

/** The action while allowed; a toast naming the plan it needs while locked. */
export const unlessLocked = (lock: FeatureLock, action: () => void) =>
  lock ? () => toastLocked(lock) : action

/** A menu's CSV download, or, on a plan without data exports, a disabled item naming the plan that has them. */
export function ExportItem({
  Item,
  href,
  children,
}: {
  Item: MenuKit['Item']
  href: string
  children: ReactNode
}) {
  const lock = useFeatureLock('data_export')
  if (lock)
    return (
      <Item disabled>
        <Download /> {children}
        <PlanTag lock={lock} />
      </Item>
    )
  return (
    <Item asChild>
      <a href={href} download>
        <Download /> {children}
      </a>
    </Item>
  )
}

/**
 * Content the plan lacks that must still be on screen: blurred, inert and out of the tab order, with the notice and
 * its way to the plans on top. Read-only data the person may still use is not wrapped in it.
 */
export function LockedArea({
  lock,
  kept,
  children,
}: {
  lock: NonNullable<FeatureLock>
  kept: string
  children: ReactNode
}) {
  return (
    <div data-slot="locked-area" className="relative">
      <div inert aria-hidden className="pointer-events-none opacity-50 blur-[3px] select-none">
        {children}
      </div>
      <div className="absolute inset-x-0 top-0 p-4">
        <FeatureLockNotice lock={lock} kept={kept} />
      </div>
    </div>
  )
}
