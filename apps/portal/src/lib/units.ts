import { translate } from '@/lib/i18n'

/** "1 hour", "10 hours", "2.5 days": the engagement's unit code with its plural; an unknown unit as it is. */
export const amountOf = (quantity: number | string, unit: string | null) =>
  translate('unitAmount', { count: Number(quantity), unit: unit ?? '' }).trim()

const SHORT: Record<string, string> = {
  hour: 'h',
  day: 'd',
  piece: 'pcs',
  month: 'mo',
  km: 'km',
  flat: 'flat',
}

/** "2 h", "1.5 d": the compact form for numbers lined up in a column. */
export const shortAmount = (quantity: number | string, unit: string | null) =>
  [String(Number(quantity)), unit ? (SHORT[unit] ?? unit) : ''].filter(Boolean).join(' ')
