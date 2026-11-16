'use client'
import { Button } from '@helvetly/ui/components/button'
import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CreditCard,
  ExternalLink,
  Info,
  Lock,
  Tag,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import {
  billingPeriod,
  describeDiscount,
  formatPrice,
  freeForever,
  nextCharge,
  nextPlan,
  people,
  planTotal,
  taxNoteLong,
  seatPrice,
  trialDaysLeft,
  type Billing,
  type PlanId,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { Countdown } from './countdown'

const BADGES = {
  past_due: { tone: 'red', label: translate('pastDue') },
  cancels: { tone: 'amber', label: translate('cancels') },
  trialing: { tone: 'blue', label: translate('trial') },
  active: { tone: 'green', label: translate('active') },
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
    <section
      aria-label={translate('currentPlan')}
      data-slot="plan-summary"
      className="@container overflow-hidden rounded-2xl bg-card shadow-elevation-1"
    >
      <div className="grid @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)]">
        <div className="grid content-start gap-4 p-4 @lg:p-5">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div className="grid min-w-0 gap-1">
              <div className="flex items-center gap-2">
                <span className="text-caption font-medium text-muted-foreground">
                  {translate('currentPlan')}
                </span>
                {plan && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
              </div>
              <h2 className="text-page font-semibold tracking-[-0.025em]">
                {plan ? plan.name : translate('noPlan')}
              </h2>
              <p className="text-body-sm text-muted-foreground">
                {!plan
                  ? translate('thisWorkspaceIsReadOnlyUntilItHasA')
                  : `${billing.interval === 'year' ? translate('billedYearly') : translate('billedMonthly')} · ${taxNoteLong(billing.currency)}`}
              </p>
            </div>
            {plan && <Price billing={billing} />}
          </div>
          <Actions billing={billing} onPortal={onPortal} portalPending={portalPending} />
        </div>
        <NextStep billing={billing} onPortal={onPortal} portalPending={portalPending} />
      </div>
      {notes}
    </section>
  )
}

/** The total in large type, with how it adds up (per person × people) or the legacy flat price. */
function Price({ billing }: { billing: Billing }) {
  const perSeat = seatPrice(billing)
  const total = planTotal(billing)
  if (!total) return null
  const interval = billing.interval || 'month'
  return (
    <div data-slot="plan-price" className="grid gap-1 tabular-nums @lg:border-l @lg:pl-6">
      <p className="text-body-sm text-muted-foreground">
        {perSeat ? (
          translate('perPerson2', { value1: formatPrice(perSeat), value2: people(billing.seats) })
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
        <span className="text-page font-semibold tracking-[-0.025em]">{formatPrice(total)}</span>
        <span className="text-body text-muted-foreground">/ {interval}</span>
      </p>
    </div>
  )
}

/** What comes next, by state: the trial's countdown, the renewal or end, a failed payment, no plan. */
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
  if (billing.plan === '')
    return (
      <Panel
        tone="muted"
        label={translate('readOnly')}
        icon={<Lock aria-hidden />}
        title={translate('readOnly')}
      >
        {billing.trial_available
          ? translate('tryPlanFreeUntilThenNothingCanBeChanged', {
              plan: planName(billing, billing.trial_plan),
              trial_days: billing.trial_days,
              trial_seats: billing.trial_seats,
            })
          : translate('chooseAPlanUntilThenNothingCanBeChanged')}
      </Panel>
    )
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
      <CountdownPanel
        countdown={
          <Countdown
            value={days - left}
            max={days}
            left={left}
            label={translate('trialDaysUsed')}
          />
        }
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
      </CountdownPanel>
    )
  }
  const period = billingPeriod(billing)
  if (!period || !billing.current_period_end) return null
  const end = formatDate(billing.current_period_end)
  const ends = billing.cancel_at_period_end
  return (
    <CountdownPanel
      countdown={
        <Countdown
          value={period.days - period.left}
          max={period.days}
          left={period.left}
          label={translate('billingPeriodElapsed')}
          tone={ends ? 'muted' : 'brand'}
        />
      }
      title={ends ? translate('endsOn', { end: end }) : translate('renewsOn', { end: end })}
      detail={
        ends ? translate('thenTheWorkspaceIsReadOnly') : translate('thePlanRenewsAutomatically')
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
    </CountdownPanel>
  )
}

const PANEL_TONES = {
  brand: 'bg-muted/40',
  muted: 'bg-muted/40',
  danger: 'bg-destructive-surface/60 [&_[data-slot=panel-icon]]:text-destructive',
}

/** The right-hand side of the hero: a tinted panel, under a hairline when it stacks. */
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
      className={cn(
        'flex items-center gap-4 border-t p-4 @lg:px-5 @3xl:border-t-0 @3xl:border-l [&_[data-slot=countdown]_svg]:size-20',
        PANEL_TONES[tone],
      )}
    >
      {children}
    </section>
  )
}

function CountdownPanel({
  countdown,
  title,
  detail,
  children,
}: {
  countdown: ReactNode
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <PanelShell tone="brand">
      {countdown}
      <div className="grid min-w-0 gap-1">
        <p className="text-body font-semibold text-pretty">{title}</p>
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
    <p className="flex items-start gap-2.5 border-t px-4 py-2.5 text-body-sm text-pretty text-muted-foreground @lg:px-5 [&>svg]:mt-px [&>svg]:size-4 [&>svg]:shrink-0">
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
              : billing.plan === ''
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
