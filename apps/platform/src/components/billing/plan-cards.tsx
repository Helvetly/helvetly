'use client'
import { locale } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import {
  BillingIntervalToggle,
  type BillingInterval,
} from '@helvetly/ui/components/billing-interval-toggle'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { useTranslate } from '@helvetly/ui/components/language-provider'
import { PlanCard, PlanPrice, type PlanPrices } from '@helvetly/ui/components/plan-card'
import { PlanComparison } from '@helvetly/ui/components/plan-comparison'
import { formatDate } from '@helvetly/ui/lib/format'
import {
  planCards,
  planComparison,
  planFootnote,
  type PlanCardData,
  type PlanCatalogue,
} from '@helvetly/ui/lib/plan-features'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, ChevronDown, Lock, Sparkles } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAI } from '@/lib/ai'
import { errorMessage } from '@/lib/api'
import {
  ANY_PEOPLE,
  billingKeys,
  describeDiscount,
  discounted,
  formatLimit,
  formatPrice,
  isPaid,
  isUpgrade,
  limitNoun,
  monthOf,
  offerNoun,
  paymentFailed,
  people,
  promoApplies,
  seatsCost,
  taxNote,
  taxNoteLong,
  useCheckout,
  yearlySaving,
  type Billing,
  type Interval,
  type LimitKey,
  type Plan,
  type Promotion,
  type PublicOffer,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { PromoCodeEntry } from './promo-code-popover'

/** The card and comparison rows that offer AI: none on an installation without it. */
const AI_LINES = new Set(['ai_import', 'ai_filing', 'heidi'])

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

/** The people a change bills: the subscription's paid seats, else the people in the workspace now (at least one). */
const billedSeats = (billing: Billing) => Math.max(1, billing.paid_seats ?? billing.seats)

/** The way to a plan from the workspace's: start the trial, choose, upgrade or switch. */
export function choiceLabel(billing: Billing, plan: Plan, interval: Interval): string {
  if (!isPaid(billing.plan))
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

/** What a change costs, for its confirmation: the plan's price for the people in the workspace now. */
export function confirmBody(billing: Billing, plan: Plan, interval: Interval): string {
  const price = plan.prices[interval]
  const seats = billedSeats(billing)
  const charge = price
    ? translate('planChargeLine', {
        price: formatPrice(seatsCost(price, seats)),
        interval,
        people: people(seats),
        tax: taxNote(billing.currency),
      })
    : ''
  if (billing.status === 'trialing')
    return translate('yourTrialEndsNowAndIsChargedToday2', { name: plan.name, charge })
  const payNow =
    isUpgrade(billing.plan, plan.id) || (interval === 'year' && billing.interval === 'month')
  if (payNow) return translate('planUpgradeCharge', { name: plan.name, charge })
  return translate('planDowngradeCredit', { name: plan.name, charge })
}

/** The offer's catalogue with the paid plans' features as the workspace gets them (a live subscription keeps its own). */
function catalogueOf(offer: PublicOffer, billing: Billing): PlanCatalogue {
  const own = (key: string, id: string) =>
    billing.plans.find((plan) => plan.id === id)?.features.includes(key)
  const features = Object.fromEntries(
    Object.entries(offer.features).map(([key, plans]) => [
      key,
      plans && {
        ...plans,
        basic: own(key, 'basic') ?? plans.basic,
        pro: own(key, 'pro') ?? plans.pro,
        business: own(key, 'business') ?? plans.business,
      },
    ]),
  )
  return { ...offer, features }
}

const withoutAILines = <T extends { key: string }>(lines: T[]) =>
  lines.filter((line) => !AI_LINES.has(line.key))

/** An installation without AI never offers it. */
function withoutAI(card: PlanCardData): PlanCardData {
  return {
    ...card,
    heroes: withoutAILines(card.heroes),
    groups: card.groups
      .map((group) => ({ ...group, lines: withoutAILines(group.lines) }))
      .filter((group) => group.lines.length > 0),
  }
}

/** A plan's prices as the shared price block reads them; null when it is not sold in the currency. */
function pricesOf(plan: Plan): PlanPrices | null {
  const { month, year } = plan.prices
  if (!month || !year) return null
  return {
    month: month.amount,
    year: year.amount,
    included_people: month.included_people,
    extra_person_month: month.extra_person,
    extra_person_year: year.extra_person,
  }
}

/**
 * The plans to choose from, the website's cards: a monthly / yearly toggle (yearly first) with what yearly saves,
 * Free as a compact strip while the workspace is on it, then Basic, Pro and Business with their tiered price, what
 * the workspace's people pay in total, one way to each plan (a live subscription confirms first) and what each
 * includes over the plan before. Every feature side by side opens in place under them.
 */
export function PlanCards({ billing, offer }: { billing: Billing; offer: PublicOffer }) {
  const ui = useTranslate()
  const [interval, setInterval] = useState<Interval>(billing.interval || 'year')
  const searchParams = useSearchParams()
  const team = billedSeats(billing)
  const [confirm, setConfirm] = useState<Plan | null>(null)
  const [promo, setPromo] = useState<Promotion | null>(null)
  const [comparing, setComparing] = useState(false)
  const { start, busy } = usePlanCheckout()
  const ai = useAI().available

  const choose = (plan: Plan) => {
    const promotion_code = promo && promoApplies(promo, plan.id) ? promo.code : undefined
    start({ plan: plan.id, interval, promotion_code })
  }
  const subscribed = isPaid(billing.plan)
  // The plan a link asked for (?plan=, e.g. "Buy more" AI), else Pro, unless the workspace already has it or more
  const asked = billing.plans.find((plan) => plan.id === searchParams?.get('plan'))?.id
  const wanted = asked ?? RECOMMENDED
  const recommended = isUpgrade(billing.plan, wanted) ? wanted : undefined

  const catalogue = catalogueOf(offer, billing)
  const cards = planCards(catalogue, locale).map((card) => (ai ? card : withoutAI(card)))
  const free = cards.find((card) => card.plan === 'free')
  // What yearly saves on the cheapest plan sold, from its own prices.
  const cheapest = billing.plans.find((plan) => yearlySaving(plan) > 0)
  const saving =
    cheapest?.prices.month && cheapest.prices.year
      ? ui('planYearlySaving', {
          percent: yearlySaving(cheapest),
          amount: formatPrice({
            amount: cheapest.prices.month.amount * 12 - cheapest.prices.year.amount,
            currency: billing.currency,
          }),
          plan: cheapest.name,
        })
      : undefined
  const groups = planComparison(catalogue, locale).map((group) => ({
    ...group,
    rows: ai ? group.rows : group.rows.filter((row) => !AI_LINES.has(row.key)),
  }))

  return (
    <div className="grid gap-8">
      <div className="flex flex-col items-center gap-3">
        <BillingIntervalToggle value={interval} onValueChange={setInterval} saving={saving} />
        {billing.can_manage && billing.enabled && (
          <PromoCodeEntry promo={promo} onChange={setPromo} />
        )}
      </div>

      {/* The page's heading is an h1 and the cards' names are h3s. */}
      <h2 className="sr-only">{translate('plans')}</h2>
      {billing.plan === 'free' && free && <FreeStrip card={free} />}

      <div className="grid items-stretch gap-4 md:grid-cols-3">
        {billing.plans.map((plan) => {
          const card = cards.find((entry) => entry.plan === plan.id)
          if (!card) return null
          return (
            <PaidPlan
              key={plan.id}
              billing={billing}
              plan={plan}
              card={
                card.plan === 'pro' && !ai
                  ? { ...card, bestFor: translate('runYourBusinessWithExpensesSignaturesAnd') }
                  : card
              }
              interval={interval}
              team={team}
              promo={promo}
              recommended={plan.id === recommended}
              busy={busy}
              onChoose={() => (subscribed ? setConfirm(plan) : choose(plan))}
              onKeep={() =>
                start({ plan: plan.id, interval }, translate('youStayOnPlan', { name: plan.name }))
              }
            />
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
        <Button
          variant="outline"
          size="sm"
          aria-expanded={comparing}
          aria-controls="plan-comparison"
          onClick={() => setComparing((open) => !open)}
        >
          {ui('planCompareTitle')}
          <ChevronDown
            data-icon="inline-end"
            aria-hidden
            className={comparing ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </Button>
      </div>

      {comparing && (
        <div id="plan-comparison">
          <PlanComparison
            groups={groups}
            featured={recommended}
            plans={offer.plans.map((plan) => ({
              id: plan.id,
              name: plan.name,
              head: (
                <span className="mt-1 block text-body-sm font-normal text-muted-foreground tabular-nums">
                  {headPrice(plan.id, billing, interval)}
                </span>
              ),
            }))}
          />
        </div>
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

/** A plan's month in the comparison's pinned head: "CHF 49 / month" (yearly: its share of the year), Free "CHF 0". */
function headPrice(id: string, billing: Billing, interval: BillingInterval): string {
  const plan = billing.plans.find((entry) => entry.id === id)
  if (!plan) return formatPrice({ amount: 0, currency: billing.currency })
  const price = plan.prices[interval]
  if (!price) return '—'
  return `${formatPrice(interval === 'year' ? monthOf(price) : price)} / ${translate('dynamicMonth')}`
}

/** Free while the workspace is on it: one compact row with what it includes, no way to choose it. */
function FreeStrip({ card }: { card: PlanCardData }) {
  const ui = useTranslate()
  return (
    <section
      aria-labelledby="plan-free-current"
      data-slot="free-plan"
      data-current
      className="grid gap-4 rounded-2xl border bg-card px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8"
    >
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span id="plan-free-current" className="text-title-sm font-semibold">
            {card.name}
          </span>
          <Badge tone="blue" size="sm">
            <Check className="size-3" aria-hidden />
            {translate('yourCurrentPlan')}
          </Badge>
        </p>
        <p className="text-body-sm text-pretty text-muted-foreground">
          {ui('planFreeForever', { count: 1 })} · {translate('upgradeAnyTimeNothingIsLost')}
        </p>
      </div>
      <dl
        aria-label={ui('planLimitsTitle')}
        className="grid grid-cols-2 gap-x-5 gap-y-1 text-body-sm sm:grid-cols-4"
      >
        {card.limits.map((limit) => (
          <div key={limit.key} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{limit.label}</dt>
            <dd className="font-medium tabular-nums">{limit.amount}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** One paid plan as the shared card: its tiered price, the team's total, the way to it and a note under it. */
function PaidPlan({
  billing,
  plan,
  card,
  interval,
  team,
  promo,
  recommended,
  busy,
  onChoose,
  onKeep,
}: {
  billing: Billing
  plan: Plan
  card: PlanCardData
  interval: Interval
  team: number
  promo: Promotion | null
  recommended: boolean
  busy: boolean
  onChoose: () => void
  onKeep: () => void
}) {
  const subscribed = isPaid(billing.plan)
  const trialing = subscribed && billing.status === 'trialing'
  const pastDue = subscribed && billing.status === 'past_due'
  const onPlan = billing.plan === plan.id
  const current = onPlan && billing.interval === interval
  const scheduled = billing.pending_plan === plan.id && billing.pending_interval === interval
  // choosing the current plan again cancels the scheduled change
  const keep = current && billing.pending_plan !== null
  const price = plan.prices[interval]
  const prices = pricesOf(plan)
  const total = price ? seatsCost(price, team) : null
  const promoted = promo && promoApplies(promo, plan.id) && total ? discounted(total, promo) : null
  const trial = !subscribed && billing.trial_available && plan.id === billing.trial_plan
  const per = interval === 'year' ? translate('aYear2') : translate('aMonth')

  let note = ''
  if (keep) note = translate('cancelsTheScheduledChange')
  else if (scheduled && billing.pending_at)
    note = translate('startsOnDate', { date: formatDate(billing.pending_at) })
  else if (pastDue && !current) note = translate('updateThePaymentMethodFirst')
  else if (trialing && !current)
    note = translate('yourTrialEndsNowAndIsChargedToday', { name: plan.name })
  else if (trial && total)
    note = translate('trialNote', {
      plan: plan.name,
      trial_days: billing.trial_days,
      trial_seats: billing.trial_seats,
      value2: formatPrice(promoted ?? total),
      per,
      people: people(team),
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

  const badge = onPlan ? (
    <Badge tone="blue" size="sm">
      <Check className="size-3" aria-hidden />
      {translate('current')}
    </Badge>
  ) : scheduled ? (
    <Badge size="sm">
      <CalendarClock className="size-3" aria-hidden />
      {translate('scheduled')}
    </Badge>
  ) : recommended ? (
    <Badge tone="violet" size="sm">
      <Sparkles className="size-3" aria-hidden />
      {translate('recommended')}
    </Badge>
  ) : undefined

  return (
    <PlanCard
      data={card}
      featured={recommended}
      className="rounded-2xl"
      badge={badge}
      price={
        prices ? (
          <>
            <PlanPrice prices={prices} interval={interval} currency={billing.currency} />
            {total && (
              <div
                data-slot="team-total"
                className="mt-3 flex items-baseline justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5 text-body-sm"
              >
                <span className="text-muted-foreground">
                  {translate('for')}
                  {people(team)}
                </span>
                <span className="tabular-nums">
                  {promoted && <s className="mr-1.5 text-muted-foreground">{formatPrice(total)}</s>}
                  <span className="font-semibold">{formatPrice(promoted ?? total)}</span>
                  <span className="text-muted-foreground"> / {interval}</span>
                </span>
              </div>
            )}
            {promoted && promo && (
              <p className="mt-1.5 text-caption text-success">{describeDiscount(promo)}</p>
            )}
          </>
        ) : (
          <p className="text-display font-semibold">—</p>
        )
      }
      cta={
        <>
          <Button
            size="xl"
            className="w-full"
            variant={!current && (recommended || trial) && !pastDue ? 'default' : 'outline'}
            disabled={disabled}
            onClick={keep ? onKeep : onChoose}
          >
            {keep
              ? translate('keepPlan', { name: plan.name })
              : scheduled
                ? translate('scheduled')
                : current
                  ? translate('currentPlan')
                  : choiceLabel(billing, plan, interval)}
          </Button>
          <p className="mt-2 min-h-[2lh] text-center text-caption text-pretty text-muted-foreground">
            {note}
          </p>
        </>
      }
    />
  )
}
