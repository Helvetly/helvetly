import { formatDate } from '@helvetly/ui/lib/format'

import { translate } from '@/lib/i18n'

// Civil dates ("2026-11-10") as the API sends them. "today" is passed in so screens and tests agree.

const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

/** The browser's calendar day as a civil date. */
export const civilToday = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** Whole days from `from` to `to`; negative when `to` is earlier. Both parse as UTC: no DST drift. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY)

/** "Due in 5 days", "Due tomorrow", "Due today", "12 days overdue". */
export function dueText(due: string, today: string) {
  const left = daysBetween(today, due)
  if (left === 0) return translate('dueToday')
  if (left === 1) return translate('dueTomorrow')
  return left > 0
    ? translate('dueInDays', { count: left })
    : translate('daysOverdue', { count: -left })
}

/** "12 days left", "Last day", "Ended" for a period ending on `endsOn`. */
export function daysLeftText(endsOn: string, today: string) {
  const left = daysBetween(today, endsOn)
  if (left < 0) return translate('ended')
  return left === 0 ? translate('lastDay') : translate('daysRemaining', { count: left })
}

/** "Good morning" before noon, "Good afternoon" until 18:00, then "Good evening". */
export const greeting = (hour: number) =>
  hour < 12
    ? translate('goodMorning')
    : hour < 18
      ? translate('goodAfternoon')
      : translate('goodEvening')

/** "Shared today", "Shared yesterday", "Shared 3 days ago", then the date. */
export function sharedText(sharedAt: string, today: string) {
  const ago = daysBetween(sharedAt.slice(0, 10), today)
  if (ago <= 0) return translate('sharedToday')
  if (ago === 1) return translate('sharedYesterday')
  return ago < 7
    ? translate('sharedDaysAgo', { ago: ago })
    : translate('shared', { value1: formatDate(sharedAt) })
}
