'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CircleDot, Lock, LockOpen, MoreHorizontal, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { errorMessage } from '@/lib/api'
import { booksApi, type ActivitySource, type MonthActivity, type Period } from '@/lib/books'
import { formatAmount, today } from '@/lib/invoices'
import { useSession } from '@/lib/queries'

import { SettingsPage } from './layout'
import { isManager, SettingsHeader } from './settings-tabs'

const PERIODS_KEY = ['books', 'periods'] as const
const ACTIVITY_KEY = ['books', 'activity'] as const
const MAX_ACTIVITY_MONTHS = 36

const utc = (month: string) => new Date(`${month}-01T00:00:00Z`)
const monthName = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
export const monthLabel = (month: string) => monthName.format(utc(month))
const longName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
const shortName = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
const closedOn = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** The open, ended months up to and including `through`, oldest first: what "Close through" closes. */
export function openThrough(open: string[], through: string): string[] {
  return open.filter((month) => month <= through).toSorted()
}

/** The `count` months that have ended before `todayIso`, newest first: "2026-10", "2026-09", … */
export function endedMonths(todayIso: string, count: number): string[] {
  const [year = 0, month = 1] = todayIso.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 2 - i, 1))
    return date.toISOString().slice(0, 7)
  })
}

/** The month `count - 1` months before `month`: the start of a window of `count` months ending there. */
export function monthsBefore(month: string, count: number): string {
  const date = utc(month)
  date.setUTCMonth(date.getUTCMonth() - (count - 1))
  return date.toISOString().slice(0, 7)
}

/** The newest closed month: the books are locked through it (earlier months may still be open). */
export function closedThrough(closed: Iterable<string>): string | null {
  return [...closed].toSorted().at(-1) ?? null
}

/** "2 draft invoices and 1 draft expense", or null when there are none (or they can't be read). */
export function draftsOf(activity: MonthActivity | undefined): string | null {
  const parts = [
    count(activity?.invoices?.drafts ?? 0, 'draft invoice'),
    count(activity?.expenses?.drafts ?? 0, 'draft expense'),
  ].filter(Boolean)
  return parts.length ? parts.join(' and ') : null
}

const count = (n: number, noun: string) => (n === 0 ? '' : `${n} ${noun}${n === 1 ? '' : 's'}`)

/** "CHF 1’200.00 · EUR 300.00": each currency on its own, never converted. */
const totalsOf = (source: ActivitySource) =>
  source.totals.map((total) => `${total.currency} ${formatAmount(total.amount)}`).join(' · ')

type State = 'closed' | 'open' | 'current'

export function PeriodsSettings() {
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title="Month-end close"
        description="Close a month once its books are done: nothing dated in it can then be issued, paid, voided or booked. Reopen it, with a reason, to make a correction."
      >
        <PeriodsCard />
      </SettingsPage>
    </>
  )
}

export function PeriodsCard() {
  const queryClient = useQueryClient()
  const manager = isManager(useSession().data?.role)
  const periods = useQuery({
    queryKey: PERIODS_KEY,
    queryFn: async () => (await booksApi.periods()).data,
  })
  const now = today()
  const current = now.slice(0, 7)
  const ended = endedMonths(now, 12)
  const closed = new Map<string, Period>((periods.data ?? []).map((p) => [p.month, p]))
  const months = [...new Set([current, ...ended, ...closed.keys()])].toSorted((a, b) =>
    b.localeCompare(a),
  )
  const oldest = months.at(-1) ?? current
  const from = [oldest, monthsBefore(current, MAX_ACTIVITY_MONTHS)].toSorted().at(-1) ?? current
  const activity = useQuery({
    queryKey: [...ACTIVITY_KEY, from, current],
    queryFn: async () => (await booksApi.activity(from, current)).data,
    enabled: periods.data !== undefined,
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: PERIODS_KEY }),
      queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY }),
    ])

  // Oldest first, one at a time: a refusal stops the rest, and what closed stays closed.
  const close = useMutation({
    mutationFn: (batch: string[]) =>
      batch.reduce<Promise<unknown>>(
        (previous, month) => previous.then(() => booksApi.close(month)),
        Promise.resolve(),
      ),
    onSuccess: (_, batch) => {
      toast.success(
        batch.length === 1
          ? `${monthLabel(batch[0] ?? '')} closed.`
          : `${batch.length} months closed, through ${monthLabel(batch.at(-1) ?? '')}.`,
      )
    },
    onError: toastError,
    onSettled: refresh,
  })
  const reopen = useMutation({
    mutationFn: ({ month, reason }: { month: string; reason: string }) =>
      booksApi.reopen(month, reason),
    onSuccess: (_, { month }) => {
      toast.success(`${monthLabel(month)} reopened.`)
      setReopening(null)
    },
    onError: toastError,
    onSettled: refresh,
  })
  const [confirming, setConfirming] = useState<string[] | null>(null)
  const [reopening, setReopening] = useState<string | null>(null)

  if (periods.error)
    return <p className="text-body text-muted-foreground">{errorMessage(periods.error)}</p>
  if (!periods.data) return <Loader className="min-h-64" />

  const byMonth = new Map((activity.data ?? []).map((a) => [a.month, a]))
  const closedSet = new Set(closed.keys())
  const open = ended.filter((month) => !closedSet.has(month))
  const through = closedThrough(closedSet)
  const busy = close.isPending || reopen.isPending
  const stateOf = (month: string): State =>
    closedSet.has(month) ? 'closed' : month === current ? 'current' : 'open'
  const years = Map.groupBy(months, (month) => month.slice(0, 4))

  return (
    <>
      <CloseStatus
        through={through}
        open={open}
        withDrafts={open.filter((month) => draftsOf(byMonth.get(month)) !== null)}
        manager={manager}
        busy={busy}
        onClose={setConfirming}
      />
      {[...years].map(([year, yearMonths]) => (
        <YearCard
          key={year}
          year={year}
          months={yearMonths}
          stateOf={stateOf}
          closed={closed}
          activity={activity.data ? byMonth : null}
          actions={
            manager
              ? {
                  disabled: busy,
                  close: (month) => setConfirming([month]),
                  reopen: setReopening,
                }
              : null
          }
        />
      ))}
      {confirming && confirming.length > 0 && (
        <ConfirmDialog
          key={confirming.join()}
          tone="default"
          title={
            confirming.length === 1
              ? `Close ${monthLabel(confirming[0] ?? '')}?`
              : `Close ${confirming.length} months?`
          }
          body={
            confirming.length === 1
              ? 'Nothing dated in it can then be issued, paid, voided or booked until it is reopened.'
              : `${monthLabel(confirming[0] ?? '')} through ${monthLabel(confirming.at(-1) ?? '')}: nothing dated in them can then be issued, paid, voided or booked until they are reopened.`
          }
          confirmLabel={confirming.length === 1 ? 'Close month' : 'Close months'}
          cancelLabel="Not now"
          onDecide={(approved) => {
            const batch = confirming
            setConfirming(null)
            if (approved) close.mutate(batch)
          }}
        >
          <DraftWarnings months={confirming} byMonth={byMonth} />
        </ConfirmDialog>
      )}
      {reopening && (
        <ReopenDialog
          key={reopening}
          month={reopening}
          pending={reopen.isPending}
          onCancel={() => setReopening(null)}
          onReopen={(reason) => reopen.mutate({ month: reopening, reason })}
        />
      )}
    </>
  )
}

/** Where the books stand, and the page's one primary action: close every open month through the latest. */
function CloseStatus({
  through,
  open,
  withDrafts,
  manager,
  busy,
  onClose,
}: {
  through: string | null
  open: string[]
  withDrafts: string[]
  manager: boolean
  busy: boolean
  onClose: (batch: string[]) => void
}) {
  const latest = open[0]
  const done = open.length === 0
  const Icon = done ? Lock : LockOpen
  return (
    <section
      aria-label="Close status"
      className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border bg-card px-5 py-4"
    >
      <div className="flex min-w-0 flex-1 basis-80 items-center gap-4">
        <span
          aria-hidden
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5 [&_svg]:stroke-[1.75]',
            done ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-body font-semibold">
            {done
              ? through
                ? `Books closed through ${monthLabel(through)}`
                : 'Nothing to close yet'
              : open.length === 1
                ? '1 month to close'
                : `${open.length} months to close`}
          </h2>
          <p className="text-body-sm text-pretty text-muted-foreground">
            {done
              ? 'Every month that has ended is closed.'
              : `${open.length === 1 ? `${monthLabel(latest ?? '')} has ended and is still open` : `${monthLabel(open.at(-1) ?? '')} to ${monthLabel(latest ?? '')} have ended and are still open`}${through ? `; the latest closed month is ${monthLabel(through)}.` : '.'}`}
            {withDrafts.length > 0 && (
              <span className="text-warning">
                {' '}
                {withDrafts.length === 1
                  ? `${monthLabel(withDrafts[0] ?? '')} has drafts dated in it.`
                  : `${withDrafts.length} of them have drafts dated in them.`}
              </span>
            )}
          </p>
        </div>
      </div>
      {manager && latest && (
        <div className="flex shrink-0 items-center">
          <Button
            disabled={busy}
            className={cn(open.length > 1 && 'rounded-r-none')}
            onClick={() => onClose(openThrough(open, latest))}
          >
            <Lock aria-hidden />
            {open.length === 1
              ? `Close ${monthLabel(latest)}`
              : `Close through ${monthLabel(latest)}`}
          </Button>
          {open.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={busy}
                  size="icon"
                  aria-label="Close through an earlier month"
                  className="rounded-l-none border-l border-primary-foreground/20"
                >
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-64">
                <DropdownMenuLabel>Close every open month through</DropdownMenuLabel>
                {open.map((month) => {
                  const batch = openThrough(open, month)
                  return (
                    <DropdownMenuItem key={month} onSelect={() => onClose(batch)}>
                      <span className="flex-1">{monthLabel(month)}</span>
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {batch.length} {batch.length === 1 ? 'month' : 'months'}
                      </span>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {!manager && (
        <p className="flex basis-full items-center gap-2 text-body-sm text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden /> Only an owner or admin can close or
          reopen a month.
        </p>
      )}
    </section>
  )
}

/** The months about to close that still have drafts dated in them: they can't be issued or booked after. */
function DraftWarnings({
  months,
  byMonth,
}: {
  months: string[]
  byMonth: Map<string, MonthActivity>
}) {
  const warnings = months.flatMap((month) => {
    const drafts = draftsOf(byMonth.get(month))
    return drafts ? [{ month, drafts }] : []
  })
  if (warnings.length === 0) return null
  return (
    <ul
      aria-label="Drafts in these months"
      className="mt-4 grid gap-1.5 rounded-lg bg-warning-surface px-3.5 py-3 text-left text-body-sm text-warning"
    >
      {warnings.map(({ month, drafts }) => (
        <li key={month} className="flex gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {monthLabel(month)}: {drafts}
          </span>
        </li>
      ))}
      <li className="pl-6 text-warning/80">They can’t be issued or booked once closed.</li>
    </ul>
  )
}

const SEGMENT = {
  closed: 'bg-success',
  open: 'bg-muted-foreground/35',
  current: 'bg-info',
  future: 'bg-muted',
} as const

/** One year: a strip of its twelve months, then a row per month with what was recorded in it. */
function YearCard({
  year,
  months,
  stateOf,
  closed,
  activity,
  actions,
}: {
  year: string
  months: string[]
  stateOf: (month: string) => State
  closed: Map<string, Period>
  activity: Map<string, MonthActivity> | null
  actions: {
    disabled: boolean
    close: (month: string) => void
    reopen: (month: string) => void
  } | null
}) {
  const endedInYear = months.filter((month) => stateOf(month) !== 'current')
  const closedInYear = endedInYear.filter((month) => stateOf(month) === 'closed').length
  const all = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  return (
    <section aria-labelledby={`year-${year}`} className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-5 py-3.5">
        <h2 id={`year-${year}`} className="text-body font-semibold tabular-nums">
          {year}
        </h2>
        <span className="text-body-sm text-muted-foreground tabular-nums">
          {endedInYear.length > 0
            ? `${closedInYear} of ${endedInYear.length} closed`
            : 'No month has ended yet'}
        </span>
        <ol aria-hidden className="ml-auto flex items-end gap-1 max-sm:w-full">
          {all.map((month) => {
            const state = months.includes(month) ? stateOf(month) : 'future'
            return (
              <li
                key={month}
                className="grid flex-1 justify-items-center gap-1 sm:w-6 sm:flex-none"
              >
                <span
                  title={`${monthLabel(month)}: ${state === 'future' ? 'not yet' : state}`}
                  className={cn('h-1.5 w-full rounded-full', SEGMENT[state])}
                />
                <span className="text-caption leading-none text-muted-foreground">
                  {shortName.format(utc(month)).slice(0, 1)}
                </span>
              </li>
            )
          })}
        </ol>
      </header>
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(10rem,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_2rem] gap-x-4 border-b border-border/60 bg-muted/30 px-5 py-2 text-caption font-medium text-muted-foreground @3xl/sections:grid"
      >
        <span>Month</span>
        <span>Invoices issued</span>
        <span>Expenses booked</span>
        <span>Status</span>
        <span />
      </div>
      <ul aria-label={year} className="divide-y divide-border/60">
        {months.map((month) => (
          <MonthRow
            key={month}
            month={month}
            state={stateOf(month)}
            period={closed.get(month)}
            activity={activity ? (activity.get(month) ?? null) : undefined}
            actions={actions}
          />
        ))}
      </ul>
    </section>
  )
}

const ICONS = { closed: Lock, open: LockOpen, current: CircleDot } as const
const ICON_TONE = {
  closed: 'text-success',
  open: 'text-muted-foreground',
  current: 'text-info',
} as const

/** One month: its state, what was recorded in it, drafts still dated in it, and its one action. */
function MonthRow({
  month,
  state,
  period,
  activity,
  actions,
}: {
  month: string
  state: State
  period: Period | undefined
  /** undefined while loading; null when the month has no activity row */
  activity: MonthActivity | null | undefined
  actions: {
    disabled: boolean
    close: (month: string) => void
    reopen: (month: string) => void
  } | null
}) {
  const label = monthLabel(month)
  const Icon = ICONS[state]
  const drafts = activity ? draftsOf(activity) : null
  return (
    <li
      aria-label={label}
      data-state={state}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 px-5 py-3 @3xl/sections:grid-cols-[minmax(10rem,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_2rem] @3xl/sections:gap-x-4"
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden className={cn('size-4 shrink-0', ICON_TONE[state])} />
        <span className="grid min-w-0 gap-0.5">
          <span className="text-body font-medium">{longName.format(utc(month))}</span>
          <span className="truncate text-caption text-muted-foreground">
            {period
              ? `Closed ${closedOn.format(new Date(period.closed_at))}${period.closed_by ? ` · ${period.closed_by.name}` : ''}`
              : state === 'current'
                ? 'Current month'
                : 'Ended, still open'}
          </span>
        </span>
      </span>
      <span className="flex items-center justify-end gap-1.5 @3xl/sections:order-4 @3xl/sections:justify-start">
        <StatusBadge tone={state === 'closed' ? 'green' : state === 'current' ? 'blue' : 'gray'}>
          {state === 'closed' ? 'Closed' : state === 'current' ? 'In progress' : 'Open'}
        </StatusBadge>
        {drafts && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${drafts} dated in ${label}`}
                className="inline-flex size-6 items-center justify-center rounded-[4px] bg-warning-surface text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <TriangleAlert className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {drafts} dated in {label}.{' '}
              {state === 'closed'
                ? 'They can’t be issued or booked while it is closed.'
                : 'Issue, book or delete them before closing it.'}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className="flex justify-end @3xl/sections:order-5">
        {actions && state !== 'current' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={actions.disabled}
                aria-label={`Actions for ${label}`}
                className="text-muted-foreground"
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {state === 'closed' ? (
                <DropdownMenuItem onSelect={() => actions.reopen(month)}>
                  <LockOpen aria-hidden /> Reopen {label}…
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => actions.close(month)}>
                  <Lock aria-hidden /> Close {label}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="size-7" />
        )}
      </span>
      <span className="col-span-3 grid grid-cols-2 gap-3 pl-7 @3xl/sections:contents">
        <Figures
          label="Invoices issued"
          noun="issued"
          source={activity?.invoices}
          loading={activity === undefined}
          className="@3xl/sections:order-2"
        />
        <Figures
          label="Expenses booked"
          noun="booked"
          source={activity?.expenses}
          loading={activity === undefined}
          className="@3xl/sections:order-3"
        />
      </span>
    </li>
  )
}

/** A count and its totals per currency; a dash when there is nothing or it may not be read. */
function Figures({
  label,
  noun,
  source,
  loading,
  className,
}: {
  label: string
  noun: string
  source: ActivitySource | null | undefined
  loading: boolean
  className?: string
}) {
  const empty = !source || source.recorded === 0
  return (
    <span
      aria-label={label}
      className={cn('grid content-start gap-0.5 @3xl/sections:pl-0', className)}
    >
      <span aria-hidden className="text-caption text-muted-foreground @3xl/sections:hidden">
        {label}
      </span>
      {loading ? (
        <span className="text-body-sm text-muted-foreground">…</span>
      ) : empty ? (
        <span className="text-body-sm text-muted-foreground">—</span>
      ) : (
        <>
          <span className="text-body-sm tabular-nums">
            {source.recorded} {noun}
          </span>
          {source.totals.length > 0 && (
            <span className="text-caption text-muted-foreground tabular-nums">
              {totalsOf(source)}
            </span>
          )}
        </>
      )}
    </span>
  )
}

/** Reopening is a correction to closed books: it says why, and the reason goes into the audit log. */
function ReopenDialog({
  month,
  pending,
  onCancel,
  onReopen,
}: {
  month: string
  pending: boolean
  onCancel: () => void
  onReopen: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const ready = reason.trim().length > 0
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) onReopen(reason.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>Reopen {monthLabel(month)}?</DialogTitle>
            <DialogDescription>
              Its records can be changed again until you close it. The reason is kept in the audit
              log.
            </DialogDescription>
          </DialogHeader>
          <FormField id="reopen-reason" required label="Reason">
            <Textarea
              id="reopen-reason"
              rows={3}
              maxLength={500}
              placeholder="e.g. A supplier invoice for this month arrived late."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || pending}>
              <LockOpen aria-hidden /> {pending ? 'Reopening…' : 'Reopen month'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
