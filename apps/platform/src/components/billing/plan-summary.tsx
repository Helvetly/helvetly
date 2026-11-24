'use client'
import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CreditCard,
  ExternalLink,
  Info,
  Layers,
  Lock,
  Sparkles,
  Tag,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SettingsSection } from '@/components/settings/layout'
import {
  describeDiscount,
  formatPrice,
  freeForever,
  isPaid,
  nextCharge,
  nextPlan,
  planTotal,
  taxNoteLong,
  seatTotal,
  trialDaysLeft,
  type Billing,
  type PlanId,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

const BADGES = {
  past_due: { tone: STATUS_TONES.subscription.past_due, label: translate('pastDue') },
  cancels: { tone: STATUS_TONES.subscription.cancels, label: translate('cancels') },
  trialing: { tone: STATUS_TONES.subscription.trialing, label: translate('trial') },
  active: { tone: STATUS_TONES.subscription.active, label: translate('active') },
} satisfies Record<string, { tone: Tone; label: string }>

const badgeOf = (billing: Billing) =>
  BADGES[
    billing.status === 'past_due'
      ? 'past_due'
      : billing.cancel_at_period_end
        ? 'cancels'
        : billing.status === 'trialing'
          ? 'trialing'
          : 'active'
  ]

const PLANS_PAGE = '/settings/billing/plans'

/**
 * The head of Plan & billing: the plan's name, status and total with the ways to change it on the
 * left; on the right (under it on a narrow card) what happens next as a countdown: the trial's days,
 * the period until renewal or the end, or what needs doing (a failed payment, no plan).
 */
export function PlanSummary({
  billing,
  onPortal,
  portalPending,
}: {
  billing: Billing
  onPortal: () => void
  portalPending: boolean
}) {
  const plan = billing.plans.find((entry) => entry.id === billing.plan)
  const badge = badgeOf(billing)
  const notes = notesOf(billing)
  return (
    <SettingsSection
      id="plan"
      icon={Layers}
      title={translate('plan')}
      description={translate('planSectionHint')}
    >
      <div data-slot="plan-summary" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-title font-semibold tracking-[-0.015em]">
                {plan
                  ? plan.name
                  : billing.plan === 'free'
                    ? translate('planFree')
                    : translate('noPlan')}
              </h3>
              {plan && <Badge tone={badge.tone}>{badge.label}</Badge>}
            </div>
            <p className="text-body-sm text-muted-foreground">
              {billing.plan === 'free'
                ? translate('freePlanSummary')
                : !plan
                  ? translate('thisWorkspaceIsReadOnlyUntilItHasA')
                  : `${billing.interval === 'year' ? translate('billedYearly') : translate('billedMonthly')} · ${taxNoteLong(billing.currency)}`}
            </p>
          </div>
          {plan && <Price billing={billing} />}
        </div>
        <NextStep billing={billing} onPortal={onPortal} portalPending={portalPending} />
        {notes}
        <Actions billing={billing} onPortal={onPortal} portalPending={portalPending} />
      </div>
    </SettingsSection>
  )
}

/** The total in large type, with how it adds up (the included people, then each further one) or the flat price. */
function Price({ billing }: { billing: Billing }) {
  const tiered = seatTotal(billing)
  const price = billing.plans.find((entry) => entry.id === billing.plan)?.prices[
    billing.interval || 'month'
  ]
  const total = planTotal(billing)
  if (!total) return null
  const interval = billing.interval || 'month'
  return (
    <div data-slot="plan-price" className="grid gap-1 tabular-nums sm:text-right">
      <p className="text-body-sm text-muted-foreground">
        {tiered && price ? (
          translate('planTierLine', {
            price: formatPrice(price),
            included: price.included_people,
            extra: Math.max(0, billing.seats - price.included_people),
            extraPrice: formatPrice({ amount: price.extra_person, currency: price.currency }),
          })
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {translate('flatPriceForTheWorkspace')}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={translate('aboutTheFlatPrice')}
                  className="rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-pretty">
                {translate('anEarlierFlatPriceForTheWholeWorkspaceIt')}
              </TooltipContent>
            </Tooltip>
          </span>
        )}
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-title font-semibold tracking-[-0.015em]">{formatPrice(total)}</span>
        <span className="text-body text-muted-foreground">/ {interval}</span>
      </p>
    </div>
  )
}

/** What comes next, by state: the trial's countdown, the renewal or end, a failed payment, Free's trial offer. */
function NextStep({
  billing,
  onPortal,
  portalPending,
}: {
  billing: Billing
  onPortal: () => void
  portalPending: boolean
}) {
  if (!billing.enabled) return null
  if (!isPaid(billing.plan)) {
    if (billing.payment_overdue)
      return (
        <Panel
          tone="danger"
          label={translate('paymentFailed')}
          icon={<AlertTriangle aria-hidden />}
          title={translate('paymentFailed')}
          action={
            billing.can_manage &&
            billing.has_customer && (
              <Button size="sm" variant="outline" disabled={portalPending} onClick={onPortal}>
                <CreditCard aria-hidden />
                {translate('updatePaymentMethod')}
              </Button>
            )
          }
        >
          {billing.can_manage
            ? translate('paymentOverdueOnFree')
            : translate('paymentOverdueOnFreeAsk', { ASK: translate('askAnOwnerOrAdmin') })}
        </Panel>
      )
    if (!billing.trial_available || !billing.can_manage) return null
    const trialPlan = planName(billing, billing.trial_plan)
    return (
      <Panel
        tone="muted"
        label={translate('daysFreeOnPlan', { days: billing.trial_days, plan: trialPlan })}
        icon={<Sparkles aria-hidden />}
        title={translate('daysFreeOnPlan', { days: billing.trial_days, plan: trialPlan })}
      >
        {translate('tryPlanFree', {
          plan: trialPlan,
          trial_days: billing.trial_days,
          trial_seats: billing.trial_seats,
        })}
      </Panel>
    )
  }
  if (billing.status === 'past_due')
    return (
      <Panel
        tone="danger"
        label={translate('paymentFailed')}
        icon={<AlertTriangle aria-hidden />}
        title={translate('paymentFailed')}
        action={
          billing.can_manage && (
            <Button size="sm" variant="outline" disabled={portalPending} onClick={onPortal}>
              <CreditCard aria-hidden />
              {translate('updatePaymentMethod')}
            </Button>
          )
        }
      >
        {translate('theLastChargeDidnTGoThroughStripeRetries')}{' '}
        {billing.can_manage
          ? translate('updateItToKeepThePlanRunningThePlan')
          : translate('anOwnerOrAdminCanUpdateIt')}
      </Panel>
    )
  const next = nextCharge(billing)
  const amount =
    next && next.kind !== 'ends' && next.amount ? (
      <span className="font-medium text-foreground tabular-nums">{formatPrice(next.amount)}</span>
    ) : null
  if (billing.status === 'trialing' && billing.trial_end) {
    const left = trialDaysLeft(billing.trial_end)
    const days = Math.max(billing.trial_days, left)
    return (
      <NextPanel
        title={
          left === 0
            ? translate('yourTrialEndsToday')
            : translate('trialEndsOn', { value1: formatDate(billing.trial_end) })
        }
        detail={translate('dayOf', { value1: Math.min(days, days - left + 1), days: days })}
      >
        {billing.discount && freeForever(billing)
          ? translate('thenFreeForever')
          : amount && (
              <>
                {translate('then')}
                {amount}
                {translate('isCharged')}
                {billing.discount &&
                  translate('withDiscount', { value2: describeDiscount(billing.discount) })}
                .
              </>
            )}
      </NextPanel>
    )
  }
  if (!billing.current_period_end) return null
  const end = formatDate(billing.current_period_end)
  const ends = billing.cancel_at_period_end
  return (
    <NextPanel
      title={ends ? translate('endsOn', { end: end }) : translate('renewsOn', { end: end })}
      detail={
        ends ? translate('thenTheWorkspaceMovesToFree') : translate('thePlanRenewsAutomatically')
      }
    >
      {ends
        ? translate('nothingMoreIsCharged')
        : amount && (
            <>
              {translate('nextCharge')}
              {amount}.
            </>
          )}
    </NextPanel>
  )
}

const PANEL_TONES = {
  muted: 'bg-muted/40',
  danger: 'bg-destructive-surface/60 [&_[data-slot=panel-icon]]:text-destructive',
}

/** What comes next: a quiet tinted block under the plan's name and price. */
function PanelShell({
  tone,
  label,
  children,
}: {
  tone: keyof typeof PANEL_TONES
  label?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={label}
      data-slot="plan-next"
      className={cn('rounded-lg px-3.5 py-3', PANEL_TONES[tone])}
    >
      {children}
    </section>
  )
}

/** The renewal, the end or the trial's end in plain text: when, why, and what is charged. */
function NextPanel({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <PanelShell tone="muted">
      <div className="grid min-w-0 gap-0.5">
        <p className="text-body font-medium text-pretty">{title}</p>
        <p className="text-body-sm text-muted-foreground tabular-nums">{detail}</p>
        {children && <p className="text-body-sm text-pretty text-muted-foreground">{children}</p>}
      </div>
    </PanelShell>
  )
}

function Panel({
  tone,
  label,
  icon,
  title,
  action,
  children,
}: {
  tone: 'muted' | 'danger'
  label: string
  icon: ReactNode
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <PanelShell tone={tone} label={label}>
      <div className="grid gap-3">
        <p className="flex items-center gap-2 text-body font-semibold">
          <span
            data-slot="panel-icon"
            className="text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0"
          >
            {icon}
          </span>
          {title}
        </p>
        <p className="text-body-sm text-pretty text-muted-foreground">{children}</p>
        {action && <div>{action}</div>}
      </div>
    </PanelShell>
  )
}

const planName = (billing: Billing, id: PlanId) =>
  billing.plans.find((entry) => entry.id === id)?.name ?? id

/** Quiet lines under the hero: a scheduled change, a running discount, who may change the plan. */
function notesOf(billing: Billing): ReactNode[] | null {
  const lines: ReactNode[] = []
  if (billing.pending_plan && billing.pending_interval && billing.pending_at)
    lines.push(
      <Note key="pending" icon={<CalendarClock aria-hidden />}>
        <span data-slot="plan-pending">
          {translate('changesToPlanOn', {
            plan: planName(billing, billing.pending_plan),
            interval: billing.pending_interval,
            date: formatDate(billing.pending_at),
          })}
        </span>
      </Note>,
    )
  if (billing.discount)
    lines.push(
      <Note key="discount" icon={<Tag aria-hidden />}>
        {describeDiscount(billing.discount)}
        {billing.discount.ends_at && ` until ${formatDate(billing.discount.ends_at)}`}
      </Note>,
    )
  if (billing.enabled && !billing.can_manage && billing.plan !== '')
    lines.push(
      <Note key="manage" icon={<Lock aria-hidden />}>
        {translate('onlyAnOwnerOrAdminCanChangeTheWorkspace')}
      </Note>,
    )
  return lines.length > 0 ? lines : null
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-body-sm text-pretty text-muted-foreground [&>svg]:mt-px [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  )
}

/**
 * The ways out of the plan: the next plan up as the primary action while there is one, the plans
 * page, and Stripe's portal.
 */
function Actions({
  billing,
  onPortal,
  portalPending,
}: {
  billing: Billing
  onPortal: () => void
  portalPending: boolean
}) {
  if (!billing.enabled) return null
  const portal = billing.has_customer && billing.can_manage
  const canChange = billing.can_manage && billing.status !== 'past_due'
  const upgrade = canChange && !billing.cancel_at_period_end ? nextPlan(billing) : undefined
  return (
    // A narrow card: the buttons share its width.
    <div className="flex w-full flex-wrap items-center gap-2 *:flex-1 @lg:*:flex-none">
      {upgrade ? (
        <>
          <Button asChild>
            <Link href={PLANS_PAGE}>
              <Zap aria-hidden />
              {translate('upgradeTo2')}
              {upgrade.name}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={PLANS_PAGE}>{translate('comparePlans')}</Link>
          </Button>
        </>
      ) : (
        <Button asChild variant={canChange ? 'default' : 'outline'}>
          <Link href={PLANS_PAGE}>
            {!canChange
              ? translate('comparePlans')
              : !isPaid(billing.plan)
                ? translate('chooseAPlan')
                : translate('changePlan')}
            {canChange && <ArrowRight data-icon="inline-end" aria-hidden />}
          </Link>
        </Button>
      )}
      {portal && (
        <Button variant="ghost" disabled={portalPending} onClick={onPortal}>
          <ExternalLink aria-hidden />
          {translate('manageBilling')}
        </Button>
      )}
    </div>
  )
}
