import { billingFixture, flatBillingFixture } from '@/components/billing/billing-fixture'
import { ApiError } from '@/lib/api'

import {
  billingPeriod,
  formatLimit,
  formatPrice,
  describeDiscount,
  discounted,
  isUpgrade,
  limitReached,
  lockedFeature,
  paymentFailed,
  planRequired,
  promoApplies,
  meterState,
  freeForever,
  nextCharge,
  nextPlan,
  people,
  planHighlights,
  planTotal,
  seatCostLabel,
  seatPrice,
  seatsCost,
  seatTotal,
  taxNote,
  taxNoteLong,
  withZone,
  trialDaysLeft,
  yearlySaving,
  type Billing,
  type Plan,
} from './billing'

const limitError = (details: Record<string, unknown>) =>
  new ApiError(402, 'limit_reached', 'The Basic plan includes 250 clients.', details)

test('limitReached reads a 402 limit_reached and nothing else', () => {
  expect(limitReached(limitError({ limit: 'clients', used: 10, max: 10, plan: 'basic' }))).toEqual({
    limit: 'clients',
    used: 10,
    max: 10,
    plan: 'basic',
  })
  expect(limitReached(limitError({ limit: 'seats', used: 1, max: 1, plan: 'basic' }))).toBeNull()
  expect(
    limitReached(limitError({ limit: 'clients', used: '10', max: 10, plan: 'basic' })),
  ).toBeNull()
  expect(limitReached(new ApiError(409, 'conflict', 'x'))).toBeNull()
  expect(limitReached(new Error('x'))).toBeNull()
})

test.each([
  ['clients', 250, '250'],
  ['clients', null, 'Unlimited'],
  ['storage_bytes', 512 * 2 ** 20, '512 MB'],
  ['storage_bytes', 10 * 2 ** 30, '10 GB'],
  ['storage_bytes', 2 ** 40, '1 TB'],
] as const)('formatLimit(%s, %s) = %s', (limit, value, text) => {
  expect(formatLimit(limit, value)).toBe(text)
})

test('formatPrice shows whole francs without decimals', () => {
  expect(formatPrice({ amount: 1900, currency: 'chf' })).toBe('CHF 19')
  expect(formatPrice({ amount: 1850, currency: 'chf' })).toBe('CHF 18.50')
})

test('meterState warns from 75 % and is full at the limit', () => {
  expect(meterState({ limit: 'clients', used: 7, max: 10 })).toBe('ok')
  expect(meterState({ limit: 'clients', used: 3, max: 4 })).toBe('near')
  expect(meterState({ limit: 'clients', used: 8, max: 10 })).toBe('near')
  expect(meterState({ limit: 'clients', used: 9, max: 10 })).toBe('near')
  expect(meterState({ limit: 'clients', used: 10, max: 10 })).toBe('full')
  expect(meterState({ limit: 'clients', used: 900, max: null })).toBe('ok')
})

const plan = (month: number, year: number): Plan => ({
  id: 'basic',
  name: 'Basic',
  limits: {
    members: 3,
    clients: 250,
    invoices_per_month: 100,
    expenses_per_month: 250,
    products: 25,
    engagements: 3,
    signatures_per_month: 5,
    storage_bytes: 1,
    ai_tokens_per_month: 1_000_000,
    employees: null,
  },
  features: [],
  prices: { month: { amount: month, currency: 'chf' }, year: { amount: year, currency: 'chf' } },
})

test('yearlySaving compares a year with twelve months', () => {
  expect(yearlySaving(plan(1900, 18300))).toBe(20)
  expect(yearlySaving({ ...plan(1900, 18300), prices: { month: null, year: null } })).toBe(0)
})

test('planRequired reads only a 402 plan_required', () => {
  expect(planRequired(new ApiError(402, 'plan_required', 'No plan.'))).toBe(true)
  expect(planRequired(new ApiError(402, 'limit_reached', 'Full.'))).toBe(false)
  expect(planRequired(new ApiError(403, 'plan_required', 'x'))).toBe(false)
})

const unpaid = (payUrl: unknown) =>
  new ApiError(402, 'payment_failed', 'The card was declined.', {
    reason: 'card_declined',
    pay_url: payUrl,
  })

test('paymentFailed reads a 402 payment_failed and keeps only a Stripe pay link', () => {
  expect(paymentFailed(unpaid('https://invoice.stripe.com/i/1'))).toEqual({
    message: 'The card was declined.',
    payUrl: 'https://invoice.stripe.com/i/1',
  })
  expect(paymentFailed(unpaid('https://stripe.com.evil.test/i/1'))?.payUrl).toBeNull()
  expect(paymentFailed(unpaid('http://invoice.stripe.com/i/1'))?.payUrl).toBeNull()
  expect(paymentFailed(unpaid(undefined))?.payUrl).toBeNull()
  expect(paymentFailed(new ApiError(402, 'plan_required', 'No plan.'))).toBeNull()
})

test('discounted prices, descriptions and which plans a code covers', () => {
  const price = { amount: 1900, currency: 'chf' }
  const percent = {
    percent_off: 20,
    amount_off: null,
    currency: null,
    duration: 'repeating',
    duration_in_months: 3,
  } as const
  expect(discounted(price, percent)).toEqual({ amount: 1520, currency: 'chf' })
  expect(
    discounted(price, { ...percent, percent_off: null, amount_off: 2500, currency: 'chf' }).amount,
  ).toBe(0)
  expect(
    discounted(price, { ...percent, percent_off: null, amount_off: 500, currency: 'eur' }),
  ).toEqual(price)
  expect(describeDiscount(percent)).toBe('−20 % for 3 months')
  expect(describeDiscount({ ...percent, duration: 'forever' })).toBe('−20 % forever')
  expect(promoApplies({ ...percent, code: 'X', plans: ['basic'], expires_at: null }, 'pro')).toBe(
    false,
  )
  expect(promoApplies({ ...percent, code: 'X', plans: null, expires_at: null }, 'pro')).toBe(true)
  expect(isUpgrade('', 'basic')).toBe(true)
  expect(isUpgrade('pro', 'basic')).toBe(false)
})

test('nextPlan is the plan one step up, none on the top plan or without a plan', () => {
  expect(nextPlan(billingFixture({ plan: 'basic' }))?.id).toBe('pro')
  expect(nextPlan(billingFixture({ plan: 'pro' }))?.id).toBe('business')
  expect(nextPlan(billingFixture({ plan: 'business' }))).toBeUndefined()
  expect(nextPlan(billingFixture({ plan: '' }))).toBeUndefined()
})

test('trialDaysLeft rounds up to whole days and stops at 0', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  expect(trialDaysLeft('2026-11-14T10:00:00Z', now)).toBe(4)
  expect(trialDaysLeft('2026-11-10T13:00:00Z', now)).toBe(1)
  expect(trialDaysLeft('2026-11-09T13:00:00Z', now)).toBe(0)
})

test('planHighlights lists the main limits as short lines', () => {
  const [basic, , business] = flatBillingFixture().plans
  if (!basic || !business) throw new Error('fixture plans missing')
  expect(planHighlights(basic)).toEqual([
    '2 members',
    '50 clients',
    '30 invoices a month',
    '5 signature requests a month',
  ])
  expect(planHighlights(business, 2)).toEqual(['Any number of people', 'Unlimited clients'])
  const [perSeat] = billingFixture().plans
  expect(perSeat && planHighlights(perSeat, 1)).toEqual(['Any number of people'])
})

const live = (over: Partial<Billing> = {}) =>
  billingFixture({ plan: 'pro', interval: 'month', pricing: 'per_seat', seats: 3, ...over })

test('seatPrice and seatTotal are the live plan price per person and for everyone', () => {
  expect(seatPrice(live())).toEqual({ amount: 4900, currency: 'chf' })
  expect(seatTotal(live())).toEqual({ amount: 14700, currency: 'chf' })
  expect(seatTotal(live({ interval: 'year', seats: 2 }))).toEqual({
    amount: 94200,
    currency: 'chf',
  })
  expect(seatsCost({ amount: 1900, currency: 'chf' }, 0).amount).toBe(0)
})

test('there is no seat price without a per-seat live subscription', () => {
  expect(seatPrice(live({ pricing: 'flat' }))).toBeNull()
  expect(seatPrice(live({ pricing: '' }))).toBeNull()
  expect(seatPrice(live({ plan: '', interval: '' }))).toBeNull()
  expect(seatTotal(flatBillingFixture({ plan: 'pro', interval: 'month' }))).toBeNull()
})

test('seatCostLabel names one person with the interval, only when billing is on', () => {
  expect(seatCostLabel(live())).toBe('CHF 49 / month incl. VAT')
  expect(seatCostLabel(live({ interval: 'year' }))).toBe('CHF 471 / year incl. VAT')
  expect(seatCostLabel(live({ enabled: false }))).toBeNull()
  expect(seatCostLabel(live({ pricing: 'flat' }))).toBeNull()
})

test('the tax note follows the currency: Swiss VAT in francs, VAT in euros, tax in dollars', () => {
  expect([taxNote('chf'), taxNote('eur'), taxNote('usd')]).toEqual([
    'incl. VAT',
    'incl. VAT',
    'incl. tax',
  ])
  expect([taxNoteLong('chf'), taxNoteLong('eur'), taxNoteLong('usd')]).toEqual([
    'incl. Swiss VAT',
    'incl. VAT',
    'incl. tax',
  ])
  expect(seatCostLabel(live({ currency: 'usd' }))).toBe('USD 49 / month incl. tax')
})

test('people counts in words', () => {
  expect(people(1)).toBe('1 person')
  expect(people(3)).toBe('3 people')
})

test('billingPeriod measures the period back from its end by one interval', () => {
  const end = '2026-12-01T00:00:00Z'
  const monthly = billingPeriod(
    { current_period_end: end, interval: 'month' },
    Date.parse('2026-11-21T00:00:00Z'),
  )
  expect(monthly).toEqual({
    start: Date.parse('2026-11-01T00:00:00Z'),
    end: Date.parse(end),
    days: 30,
    left: 10,
  })
  const yearly = billingPeriod(
    { current_period_end: end, interval: 'year' },
    Date.parse('2026-11-30T12:00:00Z'),
  )
  expect(yearly?.days).toBe(365)
  expect(yearly?.left).toBe(1)
  // Past the end it is used up; before the start it is whole.
  expect(
    billingPeriod({ current_period_end: end, interval: 'month' }, Date.parse('2027-01-01'))?.left,
  ).toBe(0)
  expect(
    billingPeriod({ current_period_end: end, interval: 'month' }, Date.parse('2026-01-01'))?.left,
  ).toBe(30)
  expect(billingPeriod({ current_period_end: null, interval: 'month' })).toBeNull()
  expect(billingPeriod({ current_period_end: end, interval: '' })).toBeNull()
})

test('planTotal: per seat × people, the legacy flat price, or nothing without a plan', () => {
  const perSeat = billingFixture({ plan: 'pro', interval: 'month', pricing: 'per_seat', seats: 3 })
  expect(planTotal(perSeat)).toEqual({ amount: 14_700, currency: 'chf' })
  expect(planTotal(flatBillingFixture({ plan: 'pro', interval: 'month' }))).toEqual({
    amount: 4900,
    currency: 'chf',
  })
  expect(planTotal(billingFixture())).toBeNull()
})

test('nextCharge: the total on the trial or period end, discounted, none once cancelled', () => {
  const basic = { plan: 'basic', interval: 'month', pricing: 'per_seat', seats: 3 } as const
  expect(
    nextCharge(billingFixture({ ...basic, status: 'trialing', trial_end: '2026-11-14' })),
  ).toEqual({ kind: 'trial', amount: { amount: 5700, currency: 'chf' }, date: '2026-11-14' })
  const active = billingFixture({ ...basic, status: 'active', current_period_end: '2026-12-01' })
  expect(nextCharge(active)).toEqual({
    kind: 'renewal',
    amount: { amount: 5700, currency: 'chf' },
    date: '2026-12-01',
  })
  const discount = {
    code: 'HALF',
    percent_off: 50,
    amount_off: null,
    currency: null,
    duration: 'forever',
    duration_in_months: null,
    ends_at: null,
  } as const
  expect(nextCharge({ ...active, discount })).toMatchObject({ amount: { amount: 2850 } })
  expect(nextCharge({ ...active, cancel_at_period_end: true })).toEqual({
    kind: 'ends',
    date: '2026-12-01',
  })
  expect(nextCharge({ ...active, current_period_end: null })).toBeNull()
  expect(nextCharge(billingFixture())).toBeNull()
})

test('freeForever: only a code that leaves nothing to pay, for good', () => {
  const basic = { plan: 'basic', interval: 'month', pricing: 'per_seat', seats: 1 } as const
  const billing = billingFixture({ ...basic, status: 'trialing', trial_end: '2026-11-22' })
  const code = {
    code: 'X',
    percent_off: 100,
    amount_off: null,
    currency: null,
    duration: 'forever',
    duration_in_months: null,
    ends_at: null,
  } as const
  expect(freeForever({ ...billing, discount: code })).toBe(true)
  expect(freeForever({ ...billing, discount: { ...code, duration: 'once' } })).toBe(false)
  expect(freeForever({ ...billing, discount: { ...code, percent_off: 50 } })).toBe(false)
  const fixed = { ...code, percent_off: null, amount_off: 99_900, currency: 'chf' }
  expect(freeForever({ ...billing, discount: fixed })).toBe(true)
  expect(freeForever(billing)).toBe(false)
})

test('billing requests carry the browser time zone', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  expect(withZone('/billing')).toBe(`/billing?tz=${encodeURIComponent(zone)}`)
})

describe('lockedFeature', () => {
  it('names the cheapest plan with the feature when the workspace lacks it', () => {
    expect(lockedFeature(billingFixture({ plan: 'basic' }), 'api_access')?.plan?.id).toBe('pro')
  })
  it('is null when the plan includes it, without billing, or before billing answers', () => {
    expect(lockedFeature(billingFixture({ plan: 'pro' }), 'api_access')).toBeNull()
    expect(
      lockedFeature(billingFixture({ enabled: false, features: ['api_access'] }), 'api_access'),
    ).toBeNull()
    expect(lockedFeature(undefined, 'api_access')).toBeNull()
  })
  it('stays locked without an upgrade path when no plan has it', () => {
    const billing = billingFixture({ plan: 'basic' })
    const plans = billing.plans.map((each) => ({ ...each, features: [] }))
    expect(lockedFeature({ ...billing, plans }, 'api_access')).toEqual({ plan: null })
  })
})
