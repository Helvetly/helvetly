'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Segmented } from '@helvetly/ui/components/segmented'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Lock, Sparkles, X } from 'lucide-react'
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
  nextPlan,
  people,
  seatsCost,
  promoApplies,
  taxNote,
  taxNoteLong,
  useCheckout,
  yearlySaving,
  type Billing,
  LIMIT_LABELS,
  type Interval,
  type LimitKey,
  type Plan,
  type PlanPrice,
  type Promotion,
} from '@/lib/billing'

import { PromoCodeDialog } from './promo-code-dialog'

const TAGLINES: Record<Plan['id'], string> = {
  basic: 'For a small business that invoices every week.',
  pro: 'For teams with many clients and few ceilings.',
  business: 'For larger teams with no ceilings.',
}

const fail = (error: unknown) => toast.error(errorMessage(error))

const textLink = 'underline underline-offset-2 hover:no-underline'

const isLimitKey = (key: string): key is LimitKey => key in LIMIT_LABELS

/** Every limit the app knows, in the order the app lists them. */
export const LIMIT_ORDER: LimitKey[] = Object.keys(LIMIT_LABELS).filter(isLimitKey)

/** A limit as a plan line: "15 members", "100 invoices a month", "Unlimited clients". */
export function limitLine(key: LimitKey, value: number | null): string {
  if (key === 'storage_bytes') return `${formatLimit(key, value)} for documents and receipts`
  if (key === 'ai_tokens_per_month')
    return `${formatLimit(key, value)} AI tokens a month for Heidi and imports`
  if (key === 'members' && value === null) return ANY_PEOPLE
  if (key === 'members')
    return `${formatLimit(key, value)} ${value === 1 ? 'member' : 'members'} besides the owner`
  const monthly = key.endsWith('_per_month')
  let noun = LIMIT_LABELS[key].replace(/ this month$/, '').toLowerCase()
  if (value === null) return `Unlimited ${noun}`
  if (value === 1) noun = noun.replace(/s$/, '')
  return `${formatLimit(key, value)} ${noun}${monthly ? ' a month' : ''}`
}

/** What a plan includes, from its limits; with `previous`, only what grows over that plan. */
export function planFeatures(plan: Plan, previous?: Plan): string[] {
  return LIMIT_ORDER.filter((key) => key in plan.limits)
    .filter((key) => !previous || plan.limits[key] !== previous.limits[key])
    .map((key) => limitLine(key, plan.limits[key]))
}

/** The way to a plan from the workspace's: start the trial, choose, upgrade or switch. */
export function choiceLabel(billing: Billing, plan: Plan, interval: Interval): string {
  if (billing.plan === '')
    return billing.trial_available && plan.id === billing.trial_plan
      ? `Start ${billing.trial_days}-day free trial`
      : `Choose ${plan.name}`
  if (billing.plan === plan.id) return `Switch ${interval === 'year' ? 'yearly' : 'monthly'}`
  return isUpgrade(billing.plan, plan.id) ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`
}

/** Starts Checkout, or changes the live subscription in place and refreshes Plan & billing. */
export function usePlanCheckout() {
  const queryClient = useQueryClient()
  const checkout = useCheckout()
  const go = (url: string) => {
    // A plan change answers with this page: refresh in place instead of reloading.
    if (url.startsWith(window.location.origin)) {
      void queryClient.invalidateQueries({ queryKey: billingKeys.overview })
      toast.success('Plan changed. The difference is prorated on your next invoice.')
      return
    }
    window.location.assign(url)
  }
  const start = (input: { plan: Plan['id']; interval: Interval; promotion_code?: string }) =>
    checkout.mutate(input, { onSuccess: ({ url }) => go(url), onError: fail })
  return { start, busy: checkout.isPending }
}

/** What a change costs, for its confirmation: per person, and for the people in the workspace now. */
export function confirmBody(billing: Billing, plan: Plan, interval: Interval): string {
  const price = plan.prices[interval]
  const total =
    price && billing.seats > 0
      ? ` (${formatPrice(seatsCost(price, billing.seats))} for ${people(billing.seats)})`
      : ''
  const charge = price
    ? `${formatPrice(price)} per person a ${interval}, ${taxNote(billing.currency)}${total}`
    : ''
  if (billing.status === 'trialing')
    return `Your trial ends now and ${plan.name} is charged today: ${charge}.`
  return `${plan.name} applies now at ${charge}. The difference for the rest of this period is prorated on your next invoice.`
}

/** A limit as a short fact with its key number first: "50" clients, "Unlimited" invoices / month. */
export function planFact(key: LimitKey, value: number | null): { value: string; label: string } {
  const monthly = key.endsWith('_per_month')
  const noun = LIMIT_LABELS[key].replace(/ this month$/, '').toLowerCase()
  const label = `${key === 'storage_bytes' ? 'storage' : key === 'ai_tokens_per_month' ? 'AI tokens' : noun}${monthly ? ' / month' : ''}`
  if (key === 'members')
    return { value: value === null ? 'Any number' : formatLimit(key, value), label: 'of people' }
  if (value === null) return { value: 'Unlimited', label }
  if (key === 'ai_tokens_per_month' && value >= 1_000_000)
    return { value: `${+(value / 1_000_000).toFixed(1)}M`, label }
  return { value: formatLimit(key, value), label }
}

/** What a year saves against twelve months, per person. */
const yearSaving = (plan: Plan): PlanPrice | null => {
  const { month, year } = plan.prices
  if (!month || !year) return null
  const amount = month.amount * 12 - year.amount
  return amount > 0 ? { ...year, amount } : null
}

/**
 * Basic, Pro and Business side by side, with a monthly / yearly switch: the recommended plan
 * lifted, the current one marked, a big price per person, what the workspace's people pay in
 * total (seats follow the members, nobody picks them), the yearly saving, one way to each plan (a live subscription
 * confirms first) and the limits as short facts with the number first.
 */
export function PlanCards({ billing }: { billing: Billing }) {
  const [interval, setPeriod] = useState<Interval>(billing.interval || 'month')
  // the subscription bills the workspace's people, kept in step by the API as members join or leave
  const team = Math.max(1, billing.seats)
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
  const recommended = subscribed ? nextPlan(billing)?.id : 'pro'
  const keys = LIMIT_ORDER.filter((key) => billing.plans.some((plan) => key in plan.limits))

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Segmented
          label="Billing period"
          value={interval}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Yearly' },
          ]}
          onChange={setPeriod}
        />
        {saving > 0 && <StatusBadge tone="green">Save {saving} % yearly</StatusBadge>}
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-3 lg:gap-5">
        {billing.plans.map((plan) => {
          const onPlan = billing.plan === plan.id
          const current = onPlan && billing.interval === interval
          const price = plan.prices[interval]
          const offer =
            promo && promoApplies(promo, plan.id) && price ? discounted(price, promo) : null
          const highlight = plan.id === recommended
          const trial = !subscribed && billing.trial_available && plan.id === billing.trial_plan
          const label = choiceLabel(billing, plan, interval)
          const shown = offer ?? price
          const per = interval === 'year' ? 'a year' : 'a month'
          const yearly = yearSaving(plan)
          let note = ''
          if (pastDue && !current) note = 'Update the payment method first.'
          else if (trialing && !current)
            note = `Your trial ends now and ${plan.name} is charged today.`
          else if (trial && shown)
            note = `Free for ${billing.trial_days} days, card required. Then ${formatPrice(shown)} per person ${per}.`
          else if (!subscribed) note = 'Charged today.'
          const disabled =
            current || busy || pastDue || !billing.enabled || !billing.can_manage || !price
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
                  Recommended
                </p>
              )}
              <div className={cn('flex flex-1 flex-col p-6 lg:p-7', highlight && 'md:pb-10')}>
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <h2 className="text-title font-semibold tracking-[-0.01em]">{plan.name}</h2>
                  {onPlan && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-surface px-2 text-caption leading-5 font-medium text-brand">
                      <Check className="size-3" aria-hidden />
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-1 min-h-[2lh] text-body-sm text-pretty text-muted-foreground">
                  {TAGLINES[plan.id]}
                </p>

                <div data-slot="plan-price" className="mt-5 grid gap-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                    <span className="text-display font-semibold tracking-[-0.035em]">
                      {shown ? formatPrice(shown) : '—'}
                    </span>
                    {offer && price && (
                      <s className="text-body text-muted-foreground">{formatPrice(price)}</s>
                    )}
                  </p>
                  <p className="text-body-sm text-muted-foreground">
                    per person / {interval} · {taxNote(billing.currency)}
                  </p>
                </div>
                <p className="mt-3 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                  {interval === 'year' && shown ? (
                    <>
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {formatPrice(monthOf(shown))} a month, billed yearly
                      </span>
                      {yearly && (
                        <StatusBadge tone="green">Save {formatPrice(yearly)} a year</StatusBadge>
                      )}
                    </>
                  ) : interval === 'month' && plan.prices.year && yearlySaving(plan) > 0 ? (
                    <span className="text-caption text-muted-foreground tabular-nums">
                      or {formatPrice(plan.prices.year)} a year, save {yearlySaving(plan)} %
                    </span>
                  ) : null}
                </p>

                <div
                  data-slot="team-total"
                  className="mt-4 flex items-baseline justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3 text-body-sm"
                >
                  <span className="text-muted-foreground">For {people(team)}</span>
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
                  onClick={() => (subscribed ? setConfirm(plan) : choose(plan))}
                >
                  {current ? 'Current plan' : label}
                </Button>
                <p className="mt-2.5 min-h-[2lh] text-center text-caption text-pretty text-muted-foreground">
                  {note}
                </p>

                <ul
                  aria-label={`${plan.name} includes`}
                  className="mt-4 grid gap-2.5 border-t pt-5 text-body-sm"
                >
                  {keys.map((key) => {
                    const fact = planFact(key, plan.limits[key] ?? null)
                    return (
                      <li key={key} className="flex items-baseline gap-2.5">
                        <Check
                          className="size-3.5 shrink-0 translate-y-0.5 text-brand"
                          aria-hidden
                        />
                        <span className="min-w-0 text-pretty">
                          <strong className="font-semibold tabular-nums">{fact.value}</strong>{' '}
                          <span className="text-muted-foreground">{fact.label}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          )
        })}
      </div>

      <div className="flex flex-col items-center gap-3 text-center text-body-sm text-muted-foreground">
        {billing.can_manage && billing.enabled && (
          <div className="flex items-center gap-2">
            {promo ? (
              <>
                <span className="rounded-full bg-brand-surface px-2.5 text-caption leading-[22px] font-medium text-brand">
                  {promo.code} · {describeDiscount(promo)}
                </span>
                <button type="button" className={textLink} onClick={() => setPromoDialog(true)}>
                  Change
                </button>
                <button
                  type="button"
                  className={cn(textLink, 'inline-flex items-center gap-1 text-destructive')}
                  onClick={() => setPromo(null)}
                >
                  <X className="size-3.5" aria-hidden /> Remove
                </button>
              </>
            ) : (
              <button type="button" className={textLink} onClick={() => setPromoDialog(true)}>
                Have a promotion code?
              </button>
            )}
          </div>
        )}
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption">
          <Lock className="size-3" aria-hidden />
          Secure payment by Stripe
          <span aria-hidden>·</span>
          Prices {taxNoteLong(billing.currency)}
          <span aria-hidden>·</span>
          Change or cancel anytime
        </p>
        {!billing.can_manage && billing.enabled && (
          <p>Only an owner or admin can change the workspace’s plan.</p>
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
          title={`${isUpgrade(billing.plan, confirm.id) ? 'Upgrade' : 'Switch'} to ${confirm.name}${confirm.id === billing.plan ? ` ${interval === 'year' ? 'yearly' : 'monthly'}` : ''}?`}
          body={confirmBody(billing, confirm, interval)}
          confirmLabel={isUpgrade(billing.plan, confirm.id) ? 'Upgrade' : 'Switch plan'}
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
