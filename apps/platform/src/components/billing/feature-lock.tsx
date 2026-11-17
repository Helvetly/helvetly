'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
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
 * export (a downgrade): then the pages stay, read-only.
 */
export const employeesHidden = (billing: Billing | undefined) =>
  Boolean(featureLock(billing, 'employees')) && !billing?.has_employees

export const useEmployeesHidden = () => employeesHidden(useBilling().data)

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
    <span
      data-slot="plan-tag"
      className={cn(
        'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-caption leading-5 font-medium text-muted-foreground',
        className,
      )}
    >
      <Lock className="size-3" aria-hidden />
      {lock.plan?.name ?? translate('upgrade')}
      <span className="sr-only">: {lock.hint}</span>
    </span>
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
