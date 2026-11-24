import { type Locale, localeDetails } from '@helvetly/i18n'
import { formatPrice, monthOf, savingOf } from '@helvetly/ui/lib/price'

import { type Interval, type Plan, priceOf, SELF_SERVICE_SEATS } from '@/lib/plans'

/** The team sizes the comparisons' cost section offers. */
export const TEAM_SIZE = { min: 1, max: 10, start: 3 }

export type TeamCost =
  | { fits: false; seats: number }
  | { fits: true; total: string; perPersonMonth: string; saving: string | null }

/** What a team pays for a plan in an interval, as the API charges it: every person in the workspace pays the price. */
export function teamCost(
  plan: Plan,
  people: number,
  interval: Interval,
  language: Locale,
  currency = 'chf',
): TeamCost {
  const seats = SELF_SERVICE_SEATS[plan.id]
  if (seats !== null && people > seats) return { fits: false, seats }
  const locale = localeDetails(language).numberLocale
  const each = priceOf(plan, interval, currency)
  const saving = savingOf(priceOf(plan, 'month', currency))
  return {
    fits: true,
    total: formatPrice({ ...each, amount: each.amount * people }, locale),
    perPersonMonth: formatPrice(interval === 'year' ? monthOf(each) : each, locale),
    saving:
      interval === 'year'
        ? formatPrice({ ...saving, amount: saving.amount * people }, locale)
        : null,
  }
}
