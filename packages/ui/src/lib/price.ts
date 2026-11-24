import { numberLocale } from '@helvetly/i18n'
// Plan prices as the app and the website show them, so the two never round differently.

/** An amount in minor units (rappen) of its currency. */
export type Price = { amount: number; currency: string }

/** What paying a year at once saves against twelve monthly payments (yearlyDiscountPercent in billing/plans.go). */
export const YEARLY_DISCOUNT_PERCENT = 20

/** A year of a monthly price: twelve months less the discount, up to a whole franc (PlanAmount in plans.go). */
export function yearOf(month: Price): Price {
  const discounted = (month.amount * 12 * (100 - YEARLY_DISCOUNT_PERCENT)) / 100
  return { ...month, amount: Math.ceil(discounted / 100) * 100 }
}

/** What a yearly price comes to a month, to the rappen: twelve of it make the year's price, never a franc off. */
export function monthOf(year: Price): Price {
  return { ...year, amount: Math.round(year.amount / 12) }
}

/** What paying a year at once saves against twelve monthly payments, e.g. CHF 45 on Basic. */
export function savingOf(month: Price): Price {
  return { ...month, amount: month.amount * 12 - yearOf(month).amount }
}

/** The number alone, Swiss style: "19", "18.50", "1'140"; `locale` for a page in another language. */
export function formatAmount({ amount }: Price, locale = numberLocale): string {
  const value = amount / 100
  return value.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** A price with its currency, e.g. "CHF 19" or "CHF 18.50". */
export function formatPrice(price: Price, locale = numberLocale): string {
  return `${price.currency.toUpperCase()} ${formatAmount(price, locale)}`
}
