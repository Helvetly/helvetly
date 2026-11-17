'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import Link from 'next/link'

import {
  ACTIVITY_KEY,
  PERIODS_KEY,
  endedMonths,
  monthLabel,
} from '@/components/settings/periods-settings'
import { booksApi, type MonthActivity } from '@/lib/books'
import { translate } from '@/lib/i18n'
import { today } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

/** How many of the latest ended months are looked at: older open months are history, not a reminder. */
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

/** A quiet reminder to close the latest finished months; nothing renders until the data is in. */
export function ClosingReminder() {
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
  if (!canRead || !periods.data || !activity.data) return null
  const open = monthsToClose(ended, new Set(periods.data.map((p) => p.month)), activity.data)
  const [first = ''] = open
  if (!first) return null
  return (
    <div className="px-4 pt-4 md:px-5 md:pt-5">
      <Callout
        tone="neutral"
        icon={Lock}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/periods">
              {translate('closeTheMonth', { length: open.length })}
            </Link>
          </Button>
        }
      >
        {open.length === 1
          ? translate('monthIsNotClosedYet', { value1: monthLabel(first) })
          : translate('monthsAreNotClosedYet', {
              length: open.length,
              value1: monthLabel(first),
              value2: monthLabel(open.at(-1) ?? ''),
            })}
      </Callout>
    </div>
  )
}
