'use client'
import { locale } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { PlanFeatureText } from '@helvetly/ui/components/plan-feature-text'
import { Segmented } from '@helvetly/ui/components/segmented'
import { formatDate } from '@helvetly/ui/lib/format'
import { planFeatureLines, planFootnote } from '@helvetly/ui/lib/plan-features'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, Lock, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import {
  ANY_PEOPLE,
  billingKeys,
  formatLimit,
  describeDiscount,
  discounted,
  formatPrice,
  isUpgrade,
  monthOf,
  paymentFailed,
  people,
  seatsCost,
  promoApplies,
  taxNote,
  taxNoteLong,
  useCheckout,
  yearlySaving,
  type Billing,
  limitNoun,
  offerNoun,
  type Interval,
  type LimitKey,
  type Plan,
  type PlanPrice,
  type Promotion,
  type PublicOffer,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { PromoCodeDialog } from './promo-code-dialog'

const TAGLINES: Record<Plan['id'], string> = {
  basic: translate('startInvoicingForFreelancersWithASmallClient'),
  pro: translate('runYourBusinessWithHeidiExpensesSignaturesAnd'),
  business: translate('workWithClientsAtScaleTheClientPortal'),
}

/** A product recommendation, not measured popularity. */
const RECOMMENDED: Plan['id'] = 'pro'

/** Limits that are one fixed cap for the workspace; every other limit is added by each paid person. */
const WORKSPACE_LIMITS: ReadonlySet<string> = new Set([
  'members',
  'clients',
  'products',
  'engagements',
])

/** A refused change says why; an unpaid one also offers Stripe's page to pay it, and stays until dismissed. */
const fail = (error: unknown) => {
  const unpaid = paymentFailed(error)
  if (!unpaid) return toast.error(errorMessage(error))
  const { payUrl } = unpaid
  return toast.error(unpaid.message, {
    duration: Infinity,
    action: payUrl
      ? { label: translate('pay'), onClick: () => window.location.assign(payUrl) }
      : undefined,
  })
}

const textLink = 'underline underline-offset-2 hover:no-underline'

const scopeOf = (key: string) => (WORKSPACE_LIMITS.has(key) ? 'workspace' : 'person')

/**
 * A limit as a plan line: "300 clients per workspace", "100 invoice issues a month per team member", "Unlimited
 * clients", "No expenses".
 */
export function limitLine(key: LimitKey, value: number | null): string {
  if (key === 'members' && value === null) return ANY_PEOPLE
  if (key === 'members')
    return translate('besidesTheOwner', {
      value1: formatLimit(key, value),
      value2: limitNoun('members', value ?? 2),
    })
  const noun = offerNoun(key, value ?? 2)
  if (value === null) return translate('unlimited', { noun })
  if (value === 0) return translate('noLimitNoun', { noun })
  return translate('planLimitLine', {
    value: formatLimit(key, value),
    noun,
    monthly: String(key.endsWith('_per_month')),
    scope: scopeOf(key),
  })
}

/** The seats a change bills: the subscription's paid seats, else the people in the workspace now. */
const billedSeats = (billing: Billing) => billing.paid_seats ?? billing.seats

/** "Up to 25 people" for self-service plans: the most seats a plan here sells (members besides the owner + 1). */
export function selfServiceSeats(plans: Plan[]): number | null {
  const caps = plans.map((plan) => plan.limits.members)
  return caps.length > 0 && caps.every((cap) => cap !== null) ? Math.max(...caps) + 1 : null
}

/** The way to a plan from the workspace's: start the trial, choose, upgrade or switch. */
export function choiceLabel(billing: Billing, plan: Plan, interval: Interval): string {
  if (billing.plan === '')
    return billing.trial_available && plan.id === billing.trial_plan
      ? translate('startDayFreeTrial', { trial_days: billing.trial_days })
      : translate('choose', { name: plan.name })
  if (billing.plan === plan.id)
    return translate('switch2', {
      value1: interval === 'year' ? translate('yearly') : translate('monthly'),
    })
  return isUpgrade(billing.plan, plan.id)
    ? translate('upgradeTo', { name: plan.name })
    : translate('switchTo', { name: plan.name })
}

/** Starts Checkout, or changes the live subscription in place and refreshes Plan & billing. */
export function usePlanCheckout() {
  const queryClient = useQueryClient()
  const checkout = useCheckout()
  const go = (url: string, done?: string) => {
    // A plan change answers with this page: refresh in place instead of reloading.
    if (url.startsWith(window.location.origin)) {
      void queryClient.invalidateQueries({ queryKey: billingKeys.overview })
      const scheduled = new URL(url).searchParams.get('checkout') === 'scheduled'
      toast.success(
        done ??
          (scheduled
            ? translate('yourPlanChangesAtTheEndOfThePaidPeriod')
            : translate('planChangedImmediately')),
      )
      return
    }
    window.location.assign(url)
  }
  /** `done` replaces the success message of a change made in place. */
  const start = (
    input: { plan: Plan['id']; interval: Interval; promotion_code?: string },
    done?: string,
  ) => checkout.mutate(input, { onSuccess: ({ url }) => go(url, done), onError: fail })
  return { start, busy: checkout.isPending }
}

/** What a change costs, for its confirmation: per person, and for the people in the workspace now. */
export function confirmBody(billing: Billing, plan: Plan, interval: Interval): string {
  const price = plan.prices[interval]
  const seats = billedSeats(billing)
  const total =
    price && seats > 0
      ? translate('for2', {
          value1: formatPrice(seatsCost(price, seats)),
          value2: people(seats),
        })
      : ''
  const charge = price
    ? translate('perPersonA', {
        value1: formatPrice(price),
        interval: interval,
        value3: taxNote(billing.currency),
        total: total,
      })
    : ''
  if (billing.status === 'trialing')
    return translate('yourTrialEndsNowAndIsChargedToday2', { name: plan.name, charge })
  const payNow =
    isUpgrade(billing.plan, plan.id) || (interval === 'year' && billing.interval === 'month')
  if (payNow) return translate('planUpgradeCharge', { name: plan.name, charge })
  return translate('planDowngradeCredit', { name: plan.name, charge })
}

/**
 * Basic, Pro and Business side by side, with a monthly / yearly switch: the recommended plan
 * lifted, the current one marked, a big price per person, what the workspace's people pay in
 * total (seats follow the members, nobody picks them), the yearly saving, one way to each plan (a live subscription
 * confirms first) and what each plan includes (the shared plan lines: the offer's numbers, each plan over the one
 * before).
 */
export function PlanCards({ billing, offer }: { billing: Billing; offer?: PublicOffer }) {
  const [interval, setPeriod] = useState<Interval>(billing.interval || 'month')
  // the subscription bills the workspace's people, kept in step by the API as members join or leave
  const team = Math.max(1, billedSeats(billing))
  const most = selfServiceSeats(billing.plans)
  const [confirm, setConfirm] = useState<Plan | null>(null)
  const [promo, setPromo] = useState<Promotion | null>(null)
  const [promoDialog, setPromoDialog] = useState(false)
  const { start, busy } = usePlanCheckout()
  const saving = Math.max(...billing.plans.map(yearlySaving))

  const choose = (plan: Plan) => {
    const promotion_code = promo && promoApplies(promo, plan.id) ? promo.code : undefined
    start({ plan: plan.id, interval, promotion_code })
  }
  const subscribed = billing.plan !== ''
  const trialing = subscribed && billing.status === 'trialing'
  const pastDue = subscribed && billing.status === 'past_due'
  // Pro, unless the workspace already has Pro or more
  const recommended = isUpgrade(billing.plan, RECOMMENDED) ? RECOMMENDED : undefined
  // the offer on sale gives the numbers; the workspace's plans name the plans and their features
  const lines = offer
    ? planFeatureLines(
        { ...offer, plans: billing.plans },
        (id) => billing.plans.find((plan) => plan.id === id)?.features ?? [],
        locale,
      )
    : []

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Segmented
          size="sm"
          label={translate('billingPeriod')}
          value={interval}
          options={[
            { value: 'month', label: translate('monthly2') },
            { value: 'year', label: translate('yearly3') },
          ]}
          onChange={setPeriod}
        />
        {saving > 0 && (
          <Badge tone="green">
            {translate('save')}
            {saving}
            {translate('yearly2')}
          </Badge>
        )}
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-3 lg:gap-5">
        {billing.plans.map((plan) => {
          const included = lines.find((entry) => entry.plan === plan.id)
          const onPlan = billing.plan === plan.id
          const current = onPlan && billing.interval === interval
          const scheduled =
            billing.pending_plan === plan.id && billing.pending_interval === interval
          // choosing the current plan again cancels the scheduled change
          const keep = current && billing.pending_plan !== null
          const price = plan.prices[interval]
          const promoted =
            promo && promoApplies(promo, plan.id) && price ? discounted(price, promo) : null
          const highlight = plan.id === recommended
          const trial = !subscribed && billing.trial_available && plan.id === billing.trial_plan
          const label = choiceLabel(billing, plan, interval)
          const shown = promoted ?? price
          const per = interval === 'year' ? translate('aYear2') : translate('aMonth')
          // a yearly price reads as its month, like the website; the year's price is shown under it
          const perMonth = (p: PlanPrice) => (interval === 'year' ? monthOf(p) : p)
          let note = ''
          if (keep) note = translate('cancelsTheScheduledChange')
          else if (scheduled && billing.pending_at)
            note = translate('startsOnDate', { date: formatDate(billing.pending_at) })
          else if (pastDue && !current) note = translate('updateThePaymentMethodFirst')
          else if (trialing && !current)
            note = translate('yourTrialEndsNowAndIsChargedToday', { name: plan.name })
          else if (trial && shown)
            note = translate('trialNote', {
              plan: plan.name,
              trial_days: billing.trial_days,
              trial_seats: billing.trial_seats,
              value2: formatPrice(shown),
              per: per,
            })
          else if (!subscribed) note = translate('chargedToday')
          const disabled =
            (current && !keep) ||
            scheduled ||
            busy ||
            pastDue ||
            !billing.enabled ||
            !billing.can_manage ||
            !price
          return (
            <section
              key={plan.id}
              aria-label={plan.name}
              data-current={onPlan || undefined}
              data-recommended={highlight || undefined}
              className={cn(
                'relative flex flex-col overflow-hidden rounded-2xl bg-card shadow-elevation-1',
                highlight && 'shadow-elevation-2 ring-2 ring-brand-solid md:-my-3',
                onPlan && !highlight && 'ring-1 ring-brand-solid/40',
              )}
            >
              {highlight && (
                <p className="flex items-center justify-center gap-1.5 bg-brand-surface py-1.5 text-caption font-medium text-brand">
                  <Sparkles className="size-3" aria-hidden />
                  {translate('recommended')}
                </p>
              )}
              <div className={cn('flex flex-1 flex-col p-6 lg:p-7', highlight && 'md:pb-10')}>
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <h2 className="text-title font-semibold tracking-[-0.01em]">{plan.name}</h2>
                  {onPlan && (
                    <Badge tone="blue" size="sm">
                      <Check className="size-3" aria-hidden />
                      {translate('current')}
                    </Badge>
                  )}
                  {scheduled && !onPlan && (
                    <Badge size="sm">
                      <CalendarClock className="size-3" aria-hidden />
                      {translate('scheduled')}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 min-h-[2lh] text-body-sm text-pretty text-muted-foreground">
                  {TAGLINES[plan.id]}
                </p>

                <div data-slot="plan-price" className="mt-5 grid gap-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                    <span className="text-display font-semibold tracking-[-0.035em]">
                      {shown ? formatPrice(perMonth(shown)) : '—'}
                    </span>
                    {promoted && price && (
                      <s className="text-body text-muted-foreground">
                        {formatPrice(perMonth(price))}
                      </s>
                    )}
                  </p>
                  <p className="text-body-sm text-muted-foreground">
                    {translate('perPerson')}
                    {translate('dynamicMonth')}
                  </p>
                </div>
                <p className="mt-3 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                  {interval === 'year' && shown ? (
                    <span className="text-caption text-muted-foreground tabular-nums">
                      <strong className="font-semibold text-foreground">
                        {formatPrice(shown)}
                      </strong>
                      {translate('aYearBilledYearly')}
                    </span>
                  ) : interval === 'month' && plan.prices.year && yearlySaving(plan) > 0 ? (
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {translate('or')}
                      <strong className="font-semibold text-foreground">
                        {formatPrice(plan.prices.year)}
                      </strong>
                      {translate('aYearSave')}
                      {yearlySaving(plan)}%
                    </span>
                  ) : null}
                </p>

                <div
                  data-slot="team-total"
                  className="mt-4 flex items-baseline justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3 text-body-sm"
                >
                  <span className="text-muted-foreground">
                    {translate('for')}
                    {people(team)}
                  </span>
                  <span className="tabular-nums">
                    <span className="text-title-sm font-semibold">
                      {shown ? formatPrice(seatsCost(shown, team)) : '—'}
                    </span>
                    <span className="text-muted-foreground"> / {interval}</span>
                  </span>
                </div>

                <Button
                  size="xl"
                  className="mt-5 w-full"
                  variant={!current && (highlight || trial) && !pastDue ? 'default' : 'outline'}
                  disabled={disabled}
                  onClick={() =>
                    keep
                      ? start(
                          { plan: plan.id, interval },
                          translate('youStayOnPlan', { name: plan.name }),
                        )
                      : subscribed
                        ? setConfirm(plan)
                        : choose(plan)
                  }
                >
                  {keep
                    ? translate('keepPlan', { name: plan.name })
                    : scheduled
                      ? translate('scheduled')
                      : current
                        ? translate('currentPlan')
                        : label}
                </Button>
                <p className="mt-2.5 min-h-[2lh] text-center text-caption text-pretty text-muted-foreground">
                  {note}
                </p>

                {included && (
                  <div className="mt-4 border-t pt-5 text-body-sm">
                    {included.basis && <p className="mb-2.5 font-medium">{included.basis}</p>}
                    <ul
                      aria-label={translate('includes', { name: plan.name })}
                      className="grid gap-2.5"
                    >
                      {included.lines.map((line) => (
                        <li key={line.key} className="flex items-baseline gap-2.5">
                          <Check
                            className="size-3.5 shrink-0 translate-y-0.5 text-brand"
                            aria-hidden
                          />
                          <PlanFeatureText line={line} className="min-w-0 text-pretty" />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      <p
        data-slot="allowance-legend"
        className="mx-auto max-w-2xl text-center text-caption text-pretty text-muted-foreground"
      >
        {planFootnote(locale)}
      </p>

      <div className="flex flex-col items-center gap-3 text-center text-body-sm text-muted-foreground">
        {billing.can_manage && billing.enabled && (
          <div className="flex items-center gap-2">
            {promo ? (
              <>
                <Badge tone="blue" size="sm">
                  <span className="font-code">{promo.code}</span> · {describeDiscount(promo)}
                </Badge>
                <button type="button" className={textLink} onClick={() => setPromoDialog(true)}>
                  {translate('change')}
                </button>
                <button
                  type="button"
                  className={cn(textLink, 'inline-flex items-center gap-1 text-destructive')}
                  onClick={() => setPromo(null)}
                >
                  <X className="size-3.5" aria-hidden />
                  {translate('remove')}
                </button>
              </>
            ) : (
              <button type="button" className={textLink} onClick={() => setPromoDialog(true)}>
                {translate('haveAPromotionCode')}
              </button>
            )}
          </div>
        )}
        {billing.pricing !== 'flat' && (
          <p data-slot="seat-rule" className="text-caption">
            {translate('everyMemberIsAPaidSeat', { most: most ?? 'none' })}
          </p>
        )}
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption">
          <Lock className="size-3" aria-hidden />
          {translate('securePaymentByStripe')}
          <span aria-hidden>·</span>
          {translate('prices')}
          {taxNoteLong(billing.currency)}
          <span aria-hidden>·</span>
          {translate('changeOrCancelAnytime')}
        </p>
        {!billing.can_manage && billing.enabled && (
          <p>{translate('onlyAnOwnerOrAdminCanChangeTheWorkspace')}</p>
        )}
      </div>

      {promoDialog && (
        <PromoCodeDialog
          initial={promo?.code ?? ''}
          onApplied={setPromo}
          onClose={() => setPromoDialog(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          key={confirm.id + interval}
          tone="default"
          title={translate('to', {
            value1: isUpgrade(billing.plan, confirm.id)
              ? translate('upgrade')
              : translate('switch'),
            name: confirm.name,
            value3:
              confirm.id === billing.plan
                ? ` ${interval === 'year' ? translate('yearly') : translate('monthly')}`
                : '',
          })}
          body={confirmBody(billing, confirm, interval)}
          confirmLabel={
            isUpgrade(billing.plan, confirm.id) ? translate('upgrade') : translate('switchPlan')
          }
          onDecide={(approved) => {
            const plan = confirm
            setConfirm(null)
            if (approved) choose(plan)
          }}
        />
      )}
    </div>
  )
}
