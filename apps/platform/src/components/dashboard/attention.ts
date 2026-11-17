'use client'
import { useQuery } from '@tanstack/react-query'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { ACTIVITY_KEY, PERIODS_KEY, endedMonths } from '@/components/settings/periods-settings'
import { dueBy } from '@/components/settings/vat-return'
import { booksApi, type MonthActivity } from '@/lib/books'
import { today, useInvoiceSettings } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { endedPeriods, vatReturnApi } from '@/lib/vat-return'

/** How many of the latest ended months are looked at: older open months are history, not a to-do. */
const LOOKBACK = 3

const hasActivity = (a: MonthActivity | undefined) =>
  [a?.invoices, a?.expenses].some((source) => (source?.recorded ?? 0) + (source?.drafts ?? 0) > 0)

/** The ended months that are still open and have records, oldest first. */
export function monthsToClose(
  ended: string[],
  closed: ReadonlySet<string>,
  activity: MonthActivity[],
): string[] {
  const byMonth = new Map(activity.map((a) => [a.month, a]))
  return ended.filter((month) => !closed.has(month) && hasActivity(byMonth.get(month))).toSorted()
}

/** One source of the to-do list: its result once loaded, or the error that kept it from loading. */
type Source<T> = { value: T | null; pending: boolean; error: Error | null; retry: () => void }

/** The latest finished months that are ready to close (none without permission). */
export function useMonthsToClose(): Source<string[]> {
  const canRead = useCan('read:periods')
  const ended = endedMonths(today(), LOOKBACK)
  const oldest = ended.at(-1) ?? ''
  const newest = ended[0] ?? ''
  const periods = useQuery({
    queryKey: PERIODS_KEY,
    queryFn: async () => (await booksApi.periods()).data,
    enabled: canRead,
  })
  const activity = useQuery({
    queryKey: [...ACTIVITY_KEY, oldest, newest],
    queryFn: async () => (await booksApi.activity(oldest, newest)).data,
    enabled: canRead,
  })
  const error = periods.error ?? activity.error
  const ready = periods.data && activity.data
  return {
    value: ready
      ? monthsToClose(ended, new Set(periods.data.map((p) => p.month)), activity.data)
      : null,
    pending: canRead && !ready && !error,
    error,
    retry: () => void Promise.all([periods.refetch(), activity.refetch()]),
  }
}

/**
 * The return of the latest ended VAT period while its filing window is open, with the same keys
 * and deadline as the VAT return page. Helvetly does not record a filing, so after the deadline
 * the period drops off instead of staying "overdue" for a return that was most likely filed.
 */
export function useVatReturnDue(): Source<{ period: string; due: string }> {
  const canRead = useCan('read:vat-return')
  const registered = useInvoiceSettings().data?.vat_registered === true
  const lock = useFeatureLock('vat_returns')
  const enabled = canRead && registered && !lock
  const settings = useQuery({
    queryKey: ['vat-return', 'settings'],
    queryFn: async () => (await vatReturnApi.settings()).data,
    enabled,
  })
  const [period = ''] = settings.data ? endedPeriods(settings.data.period, today(), 1) : []
  const report = useQuery({
    queryKey: ['vat-return', 'report', period],
    queryFn: async () => (await vatReturnApi.report(period)).data,
    enabled: enabled && period !== '',
  })
  const error = settings.error ?? report.error
  const due = report.data ? dueBy(report.data.to) : ''
  return {
    value: report.data && due >= today() ? { period: report.data.period, due } : null,
    pending: enabled && !report.data && !error,
    error,
    retry: () => void (settings.error ? settings.refetch() : report.refetch()),
  }
}
