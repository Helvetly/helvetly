import { type Locale, localeDetails } from '@helvetly/i18n'
import { formatPrice, savingOf, yearOf } from '@helvetly/ui/lib/price'

import { type Interval, type Plan, SELF_SERVICE_SEATS } from '@/lib/plans'
import { monthlyFor, TIERED_PLANS } from '@/lib/team-pricing'

/** The team sizes the comparisons' cost section offers. */
export const TEAM_SIZE = { min: 1, max: 10, start: 3 }

export type TeamCost =
  | { fits: false; seats: number }
  | { fits: true; total: string; extraPerson: string; saving: string | null }

/** The team's cost including extra people, what one more costs a month, and the saving against twelve monthly payments. */
export function teamCost(
  plan: Plan,
  people: number,
  interval: Interval,
  language: Locale,
): TeamCost {
  const seats = SELF_SERVICE_SEATS[plan.id]
  if (plan.id === 'free' || (seats !== null && people > seats))
    return { fits: false, seats: seats ?? 1 }
  const locale = localeDetails(language).numberLocale
  const month = { amount: monthlyFor(plan.id, people) * 100, currency: 'chf' }
  const total = interval === 'year' ? yearOf(month) : month
  return {
    fits: true,
    total: formatPrice(total, locale),
    extraPerson: formatPrice(
      { amount: TIERED_PLANS[plan.id].extraPerson * 100, currency: 'chf' },
      locale,
    ),
    saving: interval === 'year' ? formatPrice(savingOf(month), locale) : null,
  }
}
