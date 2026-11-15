import { languageTag, numberLocale } from '@helvetly/i18n'
import { translate } from '@helvetly/ui/lib/i18n'
const chf = new Intl.NumberFormat(numberLocale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const whole = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 })
const day = new Intl.DateTimeFormat(languageTag, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const civilDay = new Intl.DateTimeFormat(languageTag, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "CHF 4’850.00" */
export const formatChf = (amount: number) => `CHF ${chf.format(amount)}`
/** "48’250", for headline figures where the rappen are noise. */
export const formatWhole = (amount: number) => whole.format(amount)
/** "12 Nov 2026" */
export const formatDate = (iso: string) =>
  (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? civilDay : day).format(new Date(iso))
export const formatPercent = (share: number) => `${Math.round(share * 100)}%`
export const formatFileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
export const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

const relative = new Intl.RelativeTimeFormat(languageTag, { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
]

/** "just now", "5 minutes ago", "yesterday", "2 weeks ago" */
export function formatRelative(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit)
  }
  return translate('justNow')
}

/** Exact decimal strings ("1234.5") as "1’234.50"; minus as "−". */
export function formatAmount(value: string) {
  // "-0.00" is zero: no sign.
  const negative = value.trim().startsWith('-') && /[1-9]/.test(value)
  const [integer = '0', fraction = ''] = value.trim().replace(/^-/, '').split('.')
  const grouped = whole.format(BigInt(integer || '0')).replaceAll("'", '’')
  const decimal =
    new Intl.NumberFormat(numberLocale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  return `${negative ? '−' : ''}${grouped}${decimal}${fraction.padEnd(2, '0').slice(0, Math.max(2, fraction.length))}`
}

/** "CHF 1’234.50" */
export const formatMoney = (value: string, currency: string) => {
  const amount = formatAmount(value)
  return amount.startsWith('−') ? `−${currency} ${amount.slice(1)}` : `${currency} ${amount}`
}

/** "12 KB", "3.4 MB" in powers of 1000. */
export function formatSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
