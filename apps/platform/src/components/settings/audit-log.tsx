'use client'
import { languageTag, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { TONES, type Tone } from '@helvetly/ui/components/status-badge'
import { cn } from '@helvetly/ui/lib/utils'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  BadgeCheck,
  Banknote,
  CalendarRange,
  Download,
  FileMinus,
  FileText,
  History,
  ListOrdered,
  Lock,
  LockOpen,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Undo2,
  User,
  type LucideIcon,
} from 'lucide-react'

import { errorMessage } from '@/lib/api'
import { booksApi, EVENT_LABELS, exportUrl, type FinancialEvent } from '@/lib/books'
import { translate } from '@/lib/i18n'

import { HelpTip } from './help-tip'
import { SettingsEmpty, SettingsPage, SettingsSection } from './layout'
import { SettingsHeader } from './settings-tabs'

const day = new Intl.DateTimeFormat(languageTag, {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const time = new Intl.DateTimeFormat(languageTag, { timeStyle: 'short' })

const ICONS: Record<string, LucideIcon> = {
  invoice: FileText,
  credit: FileMinus,
  payment: Banknote,
  refund: Undo2,
  expense: Receipt,
  plan: CalendarRange,
  approval: BadgeCheck,
  approvals: BadgeCheck,
}
const TONE_BY_AREA: Record<string, Tone> = {
  invoice: 'blue',
  credit: 'blue',
  plan: 'blue',
  payment: 'green',
  refund: 'green',
  expense: 'amber',
}

/** The icon and tint of an event: by area, red for anything undone. */
export function eventLook(kind: string): { Icon: LucideIcon; tone: Tone } {
  const area = kind.split('.')[0] ?? ''
  if (kind === 'period.closed') return { Icon: Lock, tone: 'gray' }
  if (kind === 'period.reopened') return { Icon: LockOpen, tone: 'gray' }
  const undone = /\.(voided|deleted|cancelled)$/.test(kind)
  return {
    Icon: ICONS[area] ?? History,
    tone: undone ? 'red' : (TONE_BY_AREA[area] ?? 'gray'),
  }
}

// The payload's document number reads better than an internal id ("2026-031", not "inv_…").
const reference = (event: FinancialEvent) => {
  const number = event.payload.number
  if (typeof number === 'number') return translate('no3', { number: number })
  if (typeof number === 'string') return number
  // An approver group's name; a policy's document type.
  const { name, doc_type } = event.payload
  if (typeof name === 'string') return name
  return typeof doc_type === 'string' ? doc_type : event.subject_id
}

export function AuditLogSettings() {
  return (
    <>
      <SettingsHeader
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={localizedHref(exportUrl())} download>
              <Download />
              {translate('exportCSV2')}
            </a>
          </Button>
        }
      />
      <SettingsPage
        title={translate('auditLog')}
        description={translate('everyFinancialEventInOrderEntriesCanNeverBe')}
      >
        <AuditLog />
      </SettingsPage>
    </>
  )
}

export function AuditLog() {
  const verify = useQuery({
    queryKey: ['books', 'audit-log', 'verify'],
    queryFn: async () => (await booksApi.verify()).data,
  })
  const events = useInfiniteQuery({
    queryKey: ['books', 'audit-log'],
    queryFn: ({ pageParam }) => booksApi.events(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor,
  })

  if (events.error)
    return <p className="text-body text-muted-foreground">{errorMessage(events.error)}</p>
  if (!events.data) return <Loader className="min-h-64" />

  const rows = events.data.pages.flatMap((page) => page.data)
  const days = Map.groupBy(rows, (event) => day.format(new Date(event.at)))
  return (
    <div className="grid gap-5">
      <ChainStatus check={verify.data} failed={verify.isError} />
      {rows.length === 0 ? (
        // Nothing to list yet: only the placeholder, a little lower, without an "Entries" band and its rule.
        <div className="pt-10">
          <SettingsEmpty icon={<History />} title={translate('nothingRecordedYet')}>
            {translate('issuedInvoicesPaymentsBookedExpensesAndClosedMonthsAppear')}
          </SettingsEmpty>
        </div>
      ) : (
        <SettingsSection
          id="audit-log-entries"
          icon={ListOrdered}
          title={translate('entries')}
          action={
            <span className="text-body-sm text-muted-foreground tabular-nums">
              {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
              {events.hasNextPage ? ' so far' : ''}
            </span>
          }
        >
          <div data-wide className="grid gap-5 border-t pt-4 pb-4">
            {[...days].map(([date, dayEvents]) => (
              <div key={date} className="grid gap-1">
                <h3 className="flex items-baseline justify-between gap-3 text-caption font-medium text-muted-foreground">
                  <span>{date}</span>
                  <span className="tabular-nums">
                    {dayEvents.length} {dayEvents.length === 1 ? 'entry' : 'entries'}
                  </span>
                </h3>
                {/* One rail through the day's icons. */}
                <ol
                  aria-label={date}
                  className="relative before:absolute before:inset-y-4 before:left-[15px] before:w-px before:bg-border"
                >
                  {dayEvents.map((event) => (
                    <EventRow key={event.seq} event={event} />
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
      {events.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {events.isFetchingNextPage ? translate('loading') : translate('loadMore')}
        </Button>
      )}
    </div>
  )
}

function EventRow({ event }: { event: FinancialEvent }) {
  const { Icon, tone } = eventLook(event.kind)
  const label = EVENT_LABELS[event.kind] ?? event.kind
  return (
    <li
      aria-label={`#${event.seq} ${label}`}
      className="relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg py-2 sm:grid-cols-[2rem_minmax(0,1fr)_12rem_3.5rem]"
    >
      <span
        aria-hidden
        className={cn('grid size-8 place-items-center rounded-full ring-4 ring-card', TONES[tone])}
      >
        <Icon className="size-4" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-body font-medium">{label}</span>
        <span className="flex gap-2 text-body-sm text-muted-foreground">
          <span className="truncate">{reference(event)}</span>
          <span className="tabular-nums">#{event.seq}</span>
        </span>
      </span>
      <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-body-sm text-muted-foreground sm:col-start-3">
        <User className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate text-foreground/80">
          {event.actor?.name ?? translate('system')}
        </span>
        <time
          dateTime={event.at}
          className="ml-auto text-body-sm text-muted-foreground tabular-nums sm:hidden"
        >
          {time.format(new Date(event.at))}
        </time>
      </span>
      <time
        dateTime={event.at}
        className="hidden text-right text-body-sm text-muted-foreground tabular-nums sm:block"
      >
        {time.format(new Date(event.at))}
      </time>
    </li>
  )
}

function ChainStatus({
  check,
  failed,
}: {
  check: { ok: boolean; broken_at: number | null } | undefined
  failed: boolean
}) {
  const help = (
    <HelpTip label={translate('aboutTheChainCheck')}>
      {translate('eachEntryIsSealedWithTheHashOfThe')}
    </HelpTip>
  )
  if (!check)
    return (
      <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
        {failed ? translate('theChainCouldNotBeCheckedRightNow') : translate('checkingTheChain')}{' '}
        {help}
      </p>
    )
  return (
    <output
      className={cn(
        'flex items-center gap-3 rounded-xl border px-4 py-3',
        check.ok ? 'bg-card' : 'border-destructive/25 bg-destructive-surface/50',
      )}
    >
      {check.ok ? (
        <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden />
      ) : (
        <ShieldAlert className="size-5 shrink-0 text-destructive" aria-hidden />
      )}
      <span className="grid flex-1 gap-0.5">
        <span className="text-body font-medium">
          {check.ok
            ? translate('chainVerified')
            : translate('chainBrokenAtEntry', { broken_at: check.broken_at })}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {check.ok
            ? translate('everyEntryIsIntactAndInItsOriginalOrder')
            : translate('entriesFromThisOneOnMayHaveBeenChanged')}
        </span>
      </span>
      {help}
    </output>
  )
}
