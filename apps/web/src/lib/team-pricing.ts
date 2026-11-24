import { yearOf } from '@helvetly/ui/lib/price'

// Helvetly's prices by team size, as the offer helvetly-v1 sells them (CHF, VAT included): each plan includes some
// people and charges a fixed amount for every person beyond them. The comparisons read Helvetly's prices only from
// here; the yearly figures come from yearOf, so they round up to the franc exactly as the API charges.

export type TieredPlanId = 'basic' | 'pro' | 'business'

export type TieredPlan = {
  /** CHF a month, VAT included, for the people included. */
  monthly: number
  includedPeople: number
  /** CHF a month for each person beyond the included ones. */
  extraPerson: number
}

export const TIERED_PLANS: Record<TieredPlanId, TieredPlan> = {
  basic: { monthly: 19, includedPeople: 1, extraPerson: 10 },
  pro: { monthly: 49, includedPeople: 2, extraPerson: 15 },
  business: { monthly: 149, includedPeople: 5, extraPerson: 20 },
}

/** The Free plan: one person, these allowances a month, no card. */
export const FREE_PLAN = {
  people: 1,
  invoices: 3,
  quotes: 3,
  clients: 5,
  expenses: 1,
  sessions: 3,
}

export const PRO_TRIAL_DAYS = 14

/** The team sizes the comparisons price. */
export const TEAM_SIZES = [1, 3, 5] as const

/** CHF a month for a team of `people`. */
export function monthlyFor(plan: TieredPlanId, people: number): number {
  const { monthly, includedPeople, extraPerson } = TIERED_PLANS[plan]
  return monthly + Math.max(0, people - includedPeople) * extraPerson
}

/** CHF a year for a team of `people`, billed yearly. */
export function yearlyFor(plan: TieredPlanId, people: number): number {
  return yearOf({ amount: monthlyFor(plan, people) * 100, currency: 'chf' }).amount / 100
}
