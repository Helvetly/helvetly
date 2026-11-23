'use client'
import { languageTag, localizedHref } from '@helvetly/i18n'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import type { Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { errorMessage } from '@helvetly/ui/lib/http'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChevronDown,
  Download,
  Ellipsis,
  LoaderCircle,
  MapPin,
  Plus,
  Repeat,
  Video,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import { getPortalSession, portalKeys } from '@/lib/portal'
import {
  answerProposal,
  cancelRuleText,
  deadlineText,
  formatClock,
  formatDay,
  formatSpan,
  getBooking,
  groupSessions,
  isLateNow,
  isOpen,
  lateCounts,
  listSessions,
  localToInstant,
  relativeDay,
  requestCancel,
  requestReschedule,
  ruleText,
  seriesIcsUrl,
  sessionIcsUrl,
  sessionKeys,
  withdrawRequest,
  zoneName,
  type ClientSeries,
  type ClientSession,
  type SessionStatus,
} from '@/lib/scheduling'
import { scoped } from '@/lib/scope'
import { shorten } from '@/lib/text'

import {
  cardClass,
  DownloadLink,
  EmptyState,
  PageHeader,
  RetryAlert,
  SectionTitle,
  ViewAll,
} from './portal-bits'
import { PreviewLock, useIsPreview } from './portal-shell'

/** The API's limit on a request's note. */
const NOTE_MAX = 500

const STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  requested: { label: translate('sessionsStatusRequested'), tone: 'amber' },
  scheduled: { label: translate('sessionsStatusScheduled'), tone: 'green' },
  rescheduled: { label: translate('sessionsStatusRescheduled'), tone: 'blue' },
  attended: { label: translate('sessionsStatusAttended'), tone: 'green' },
  no_show: { label: translate('sessionsStatusNoShow'), tone: 'red' },
  cancelled_on_time: { label: translate('sessionsStatusCancelledOnTime'), tone: 'neutral' },
  cancelled_late: { label: translate('sessionsStatusCancelledLate'), tone: 'amber' },
  declined: { label: translate('sessionsStatusDeclined'), tone: 'neutral' },
}

export const SessionStatusBadge = ({ status }: { status: SessionStatus }) => (
  <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
)

const when = (session: ClientSession) =>
  formatSpan(session.starts_at, session.ends_at, session.time_zone)

function useSupplier() {
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  // A long legal name would fill every line it is in; the full one stays in the shell.
  return shorten(session.data?.workspace.name ?? translate('yourSupplier'), 40)
}

/** After any request or answer: the lists (and the tab's visibility) as the API has them now. */
function useRefreshSessions() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: sessionKeys.all })
}

type Asking = { session: ClientSession; kind: 'cancel' | 'reschedule' }

function CancelDialog({ session, onClose }: { session: ClientSession; onClose: () => void }) {
  const supplier = useSupplier()
  const refresh = useRefreshSessions()
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const late = isLateNow(session)
  const send = useMutation({
    mutationFn: () => requestCancel(session.id, note),
    onSuccess: (request) => {
      toast.success(
        request.status === 'approved'
          ? translate('sessionsCancelled', { title: session.title })
          : translate('sessionsRequestSent', { supplier }),
      )
      refresh()
      onClose()
    },
    onError: (failure) => setError(errorMessage(failure)),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !send.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            send.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{translate('sessionsCancelTitle', { title: session.title })}</DialogTitle>
            <DialogDescription>{when(session)}</DialogDescription>
          </DialogHeader>
          <p className="text-body-sm text-pretty">
            {late
              ? translate('sessionsCancelLate', { supplier })
              : translate('sessionsCancelOnTime')}{' '}
            {late && lateCounts(session, 'cancel') && (
              <strong className="font-medium">{translate('sessionsCountsWarning')}</strong>
            )}
          </p>
          <NoteField id="cancel-note" value={note} onChange={setNote} disabled={send.isPending} />
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={send.isPending}>
              {translate('sessionsKeep')}
            </Button>
            <Button type="submit" variant="destructive" disabled={send.isPending}>
              {send.isPending ? <Spinner /> : <CalendarX aria-hidden />}
              {send.isPending ? translate('sessionsSending') : translate('sessionsCancelSession')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const Spinner = () => (
  <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
)

function NoteField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <FormField id={id} label={translate('note')} hint={translate('upToCharacters', { NOTE_MAX })}>
      <Textarea
        id={id}
        value={value}
        maxLength={NOTE_MAX}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  )
}

function RescheduleDialog({ session, onClose }: { session: ClientSession; onClose: () => void }) {
  const supplier = useSupplier()
  const refresh = useRefreshSessions()
  const nextKey = useRef(1)
  const [times, setTimes] = useState([{ key: 0, value: '' }])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const late = isLateNow(session)
  const filled = times.map((t) => t.value).filter(Boolean)
  const send = useMutation({
    mutationFn: () => requestReschedule(session.id, filled.map(localToInstant), note),
    onSuccess: () => {
      toast.success(translate('sessionsRequestSent', { supplier }))
      refresh()
      onClose()
    },
    onError: (failure) => setError(errorMessage(failure)),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !send.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            send.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {translate('sessionsRescheduleTitle', { title: session.title })}
            </DialogTitle>
            <DialogDescription>
              {translate('sessionsRescheduleText', { supplier })}
            </DialogDescription>
          </DialogHeader>
          {late && (
            <p className="text-body-sm text-pretty">
              {translate('sessionsFreeCancellationOver')}.{' '}
              {lateCounts(session, 'reschedule') && (
                <strong className="font-medium">{translate('sessionsCountsWarning')}</strong>
              )}
            </p>
          )}
          <div className="grid gap-3">
            {times.map((time, i) => (
              <div key={time.key} className="flex items-end gap-2">
                <FormField
                  id={`time-${i}`}
                  label={translate('sessionsTimeN', { n: i + 1 })}
                  className="flex-1"
                >
                  <Input
                    id={`time-${i}`}
                    type="datetime-local"
                    required={i === 0}
                    value={time.value}
                    disabled={send.isPending}
                    onChange={(event) =>
                      setTimes(
                        times.map((t, j) => (j === i ? { ...t, value: event.target.value } : t)),
                      )
                    }
                  />
                </FormField>
                {i > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-9 px-0"
                    aria-label={translate('sessionsRemoveTime', { n: i + 1 })}
                    onClick={() => setTimes(times.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {times.length < 3 && (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => setTimes([...times, { key: nextKey.current++, value: '' }])}
              >
                <Plus aria-hidden />
                {translate('sessionsAddTime')}
              </Button>
            )}
          </div>
          <NoteField
            id="reschedule-note"
            value={note}
            onChange={setNote}
            disabled={send.isPending}
          />
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={send.isPending}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending || filled.length === 0}>
              {send.isPending ? <Spinner /> : <CalendarClock aria-hidden />}
              {send.isPending ? translate('sessionsSending') : translate('sessionsSendRequest')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** An open request: what the client asked and, for a proposal of the business, Accept and Decline. */
function RequestBanner({ session }: { session: ClientSession }) {
  const supplier = useSupplier()
  const refresh = useRefreshSessions()
  const request = session.request!
  const act = useMutation({
    mutationFn: async (action: 'accept' | 'decline' | 'withdraw') => {
      if (action === 'withdraw') await withdrawRequest(request.id)
      else await answerProposal(request.id, action)
    },
    onSuccess: (_, action) => {
      toast.success(
        action === 'withdraw'
          ? translate('sessionsWithdrawn')
          : action === 'accept'
            ? translate('sessionsProposalAccepted')
            : translate('sessionsProposalDeclined'),
      )
      refresh()
    },
    onError: (failure) => {
      toast.error(errorMessage(failure))
      refresh()
    },
  })
  const proposal = request.status === 'proposed' && request.staff_proposal
  const text = proposal
    ? translate('sessionsProposal', {
        supplier,
        when: `${formatDay(proposal, session.time_zone)}, ${formatClock(proposal, session.time_zone)}`,
      })
    : request.kind === 'booking'
      ? translate('sessionsRequestPendingBooking', { supplier })
      : request.kind === 'cancel'
        ? translate('sessionsRequestPendingCancel', { supplier })
        : translate('sessionsRequestPendingReschedule', { supplier })
  return (
    <output className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-warning-surface px-3 py-2 text-body-sm">
      <p className="flex-1 text-pretty">{text}</p>
      {proposal ? (
        <div className="flex gap-2">
          <PreviewLock>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('accept')}>
              {translate('sessionsAcceptProposal')}
            </Button>
          </PreviewLock>
          <PreviewLock>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate('decline')}
            >
              {translate('sessionsDeclineProposal')}
            </Button>
          </PreviewLock>
        </div>
      ) : (
        request.status === 'pending' && (
          <PreviewLock>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate('withdraw')}
            >
              {translate('sessionsWithdraw')}
            </Button>
          </PreviewLock>
        )
      )}
    </output>
  )
}

/** A month and day tile ("NOV / 24") in the session's zone: the card's date at a glance. */
export function DateTile({ iso, zone, muted }: { iso: string; zone: string; muted?: boolean }) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(languageTag, { timeZone: zone, ...options }).format(new Date(iso))
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-12 shrink-0 flex-col items-center justify-center rounded-lg leading-none',
        muted ? 'bg-muted text-muted-foreground' : 'bg-brand-surface text-brand',
      )}
    >
      <span className="text-caption font-medium uppercase">{part({ month: 'short' })}</span>
      <span className="text-title-sm font-semibold tabular-nums">{part({ day: 'numeric' })}</span>
    </span>
  )
}

const mapsUrl = (location: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`

/** Where it happens: the address as a maps link, or online. */
function Place({ session }: { session: ClientSession }) {
  if (session.mode === 'online')
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Video aria-hidden className="size-4 shrink-0" />
        {translate('sessionsOnline')}
      </span>
    )
  if (!session.location) return null
  return (
    <a
      className="inline-flex min-w-0 items-center gap-1.5 underline underline-offset-2"
      href={mapsUrl(session.location)}
      target="_blank"
      rel="noreferrer"
    >
      <MapPin aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{session.location}</span>
    </a>
  )
}

const zoneTime = (session: ClientSession) =>
  translate('sessionsZoneTime', { zone: zoneName(session.time_zone) })

function JoinButton({ session }: { session: ClientSession }) {
  if (!session.meeting_url) return null
  return (
    <Button asChild>
      <a
        href={session.meeting_url}
        target="_blank"
        rel="noreferrer"
        aria-label={translate('sessionsJoinLabel', { title: session.title, when: when(session) })}
      >
        <Video aria-hidden />
        {translate('sessionsJoin')}
      </a>
    </Button>
  )
}

const cardBody = 'grid min-w-0 flex-1 gap-3'

/** A one-off session: its date tile, time, place, deadline and note, its request, and what the client can do. */
function SessionCard({
  session,
  onAsk,
}: {
  session: ClientSession
  onAsk?: (asking: Asking) => void
}) {
  const label = { title: session.title, when: when(session) }
  const deadline = deadlineText(session)
  return (
    <li className={cn(cardClass, 'flex gap-3 p-4 sm:gap-4 sm:p-5')}>
      <DateTile iso={session.starts_at} zone={session.time_zone} muted={!onAsk} />
      <div className={cardBody}>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="grid min-w-0 flex-1 gap-0.5 leading-tight">
            <span className="text-body font-medium">{session.title}</span>
            <span className="text-body-sm text-muted-foreground tabular-nums">
              {when(session)} · {zoneTime(session)}
            </span>
            {session.host_name && (
              <span className="text-body-sm text-muted-foreground">
                {translate('sessionsWith', { host: session.host_name })}
              </span>
            )}
          </div>
          <SessionStatusBadge status={session.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
          <Place session={session} />
          {deadline && <span className="text-muted-foreground">{deadline}</span>}
        </div>
        {session.client_note && (
          <p className="text-body-sm text-pretty break-words text-muted-foreground">
            {session.client_note}
          </p>
        )}
        {session.request && <RequestBanner session={session} />}
        {onAsk && (
          <div className="flex flex-wrap gap-2">
            <JoinButton session={session} />
            <DownloadLink
              href={sessionIcsUrl(session.id)}
              label={translate('sessionsAddToCalendarLabel', label)}
              text={translate('sessionsAddToCalendar')}
            />
            {session.can_reschedule && (
              <PreviewLock>
                <Button
                  variant="outline"
                  aria-label={translate('sessionsRescheduleLabel', label)}
                  onClick={() => onAsk({ session, kind: 'reschedule' })}
                >
                  <CalendarClock aria-hidden />
                  {translate('sessionsReschedule')}
                </Button>
              </PreviewLock>
            )}
            {session.can_cancel && (
              <PreviewLock>
                <Button
                  variant="outline"
                  aria-label={translate('sessionsCancelLabel', label)}
                  onClick={() => onAsk({ session, kind: 'cancel' })}
                >
                  <CalendarX aria-hidden />
                  {translate('sessionsCancelSession')}
                </Button>
              </PreviewLock>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

const isCancelled = (session: ClientSession) =>
  session.status === 'cancelled_on_time' ||
  session.status === 'cancelled_late' ||
  session.status === 'declined'

/** One date of a series: its day and time, what is special about it, and its own actions in a "…" menu. */
function DateRow({ session, onAsk }: { session: ClientSession; onAsk?: (asking: Asking) => void }) {
  const preview = useIsPreview()
  const label = { title: session.title, when: when(session) }
  const cancelled = isCancelled(session)
  const moved = session.original_starts_at
  const locked = preview ? translate('readOnlyPreview') : undefined
  return (
    <li
      data-exception={cancelled ? 'cancelled' : moved ? 'moved' : undefined}
      className={cn(
        'grid gap-2 rounded-lg px-3 py-2.5',
        moved && !cancelled && 'bg-warning-surface/60',
        cancelled && 'bg-muted/50',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="grid min-w-0 flex-1 leading-tight">
          <span
            className={cn(
              'text-body-sm font-medium tabular-nums',
              cancelled && 'text-muted-foreground line-through',
            )}
          >
            {when(session)}
          </span>
          {moved && (
            <span className="text-caption text-muted-foreground tabular-nums">
              {translate('sessionsMovedFrom', {
                when: `${formatDay(moved, session.time_zone)}, ${formatClock(moved, session.time_zone)}`,
              })}
            </span>
          )}
        </span>
        {session.status !== 'scheduled' && <SessionStatusBadge status={session.status} />}
        {onAsk && !cancelled && (
          <span className="flex shrink-0 items-center gap-1.5">
            {session.meeting_url && (
              <Button asChild size="sm">
                <a
                  href={session.meeting_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={translate('sessionsJoinLabel', label)}
                >
                  <Video aria-hidden />
                  {translate('sessionsJoin')}
                </a>
              </Button>
            )}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={translate('sessionsMoreFor', { when: when(session) })}
                    >
                      <Ellipsis aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {translate('sessionsMoreFor', { when: when(session) })}
                </TooltipContent>
              </Tooltip>
              <ActionMenuContent
                kind="dropdown"
                menu={{
                  header: when(session),
                  actions: [
                    {
                      id: 'ics',
                      group: 'view',
                      label: translate('sessionsAddThisDate'),
                      icon: <Download aria-hidden />,
                      href: localizedHref(sessionIcsUrl(session.id)),
                      download: true,
                    },
                    session.can_reschedule && {
                      id: 'reschedule',
                      group: 'edit',
                      label: translate('sessionsReschedule'),
                      icon: <CalendarClock aria-hidden />,
                      onSelect: () => onAsk({ session, kind: 'reschedule' }),
                      disabled: preview,
                      disabledReason: locked,
                    },
                    session.can_cancel && {
                      id: 'cancel',
                      group: 'status',
                      tone: 'destructive',
                      label: translate('sessionsCancelThis'),
                      icon: <CalendarX aria-hidden />,
                      onSelect: () => onAsk({ session, kind: 'cancel' }),
                      disabled: preview,
                      disabledReason: locked,
                    },
                  ],
                }}
              />
            </DropdownMenu>
          </span>
        )}
      </div>
      {session.request && <RequestBanner session={session} />}
    </li>
  )
}

/** How many dates a series card lists before "Show all". */
const DATES_SHOWN = 5

/**
 * A series as one card: the rule in words, its span and counts, host, place and cancellation rule, the whole series
 * for the calendar, and its dates (closed until asked) with each date's own state and actions.
 */
function SeriesCard({
  series,
  sessions,
  onAsk,
}: {
  series: ClientSeries
  sessions: ClientSession[]
  onAsk?: (asking: Asking) => void
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const id = useId()
  const next = sessions.find(isOpen)
  const first = next ?? sessions[0]!
  const cancelRule = next ? cancelRuleText(next) : ''
  const shown = all ? sessions : sessions.slice(0, DATES_SHOWN)
  return (
    <li data-series-card={series.id} className={cn(cardClass, 'flex gap-3 p-4 sm:gap-4 sm:p-5')}>
      <span
        aria-hidden
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-lg',
          onAsk ? 'bg-brand-surface text-brand' : 'bg-muted text-muted-foreground',
        )}
      >
        <Repeat className="size-5" />
      </span>
      <div className={cardBody}>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="grid min-w-0 flex-1 gap-0.5 leading-tight">
            <span className="text-body font-medium">{first.title}</span>
            <span className="text-body-sm tabular-nums">
              {ruleText(series, first)} · {zoneTime(first)}
            </span>
            <span className="text-body-sm text-muted-foreground tabular-nums">
              {translate('sessionsSeriesSummary', {
                date: formatDay(series.starts_at, first.time_zone),
                total: series.total,
                left: series.left,
              })}
            </span>
            {first.host_name && (
              <span className="text-body-sm text-muted-foreground">
                {translate('sessionsWith', { host: first.host_name })}
              </span>
            )}
          </div>
          <Badge tone="blue">{translate('sessionsSeries')}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
          <Place session={first} />
          {cancelRule && <span className="text-muted-foreground">{cancelRule}</span>}
        </div>
        {first.client_note && (
          <p className="text-body-sm text-pretty break-words text-muted-foreground">
            {first.client_note}
          </p>
        )}
        {onAsk && (
          <div className="flex flex-wrap items-center gap-2">
            {next && <JoinButton session={next} />}
            <DownloadLink
              href={seriesIcsUrl(series.id)}
              label={translate('sessionsAddSeriesLabel', { title: first.title })}
              text={translate('sessionsAddSeries')}
            />
            {next && (
              <span className="text-body-sm text-muted-foreground tabular-nums">
                {translate('sessionsNextDate', {
                  when: `${relativeDay(next.starts_at, next.time_zone)}, ${formatClock(next.starts_at, next.time_zone)}`,
                })}
              </span>
            )}
          </div>
        )}
        <div className="grid gap-1 border-t border-border/60 pt-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
            className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                !open && '-rotate-90',
              )}
            />
            {onAsk ? translate('sessionsUpcomingDates') : translate('sessionsDates')}
            <span className="text-muted-foreground tabular-nums">{sessions.length}</span>
          </button>
          {open && (
            <div id={id} className="grid gap-1">
              <ul aria-label={first.title} className="-mx-3 grid gap-1">
                {shown.map((session) => (
                  <DateRow key={session.id} session={session} onAsk={onAsk} />
                ))}
              </ul>
              {sessions.length > DATES_SHOWN && (
                <Button variant="ghost" size="sm" className="w-fit" onClick={() => setAll(!all)}>
                  {all
                    ? translate('sessionsShowFewer')
                    : translate('sessionsShowAll', { count: sessions.length })}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function SessionList({
  when: which,
  onAsk,
}: {
  when: 'upcoming' | 'past'
  onAsk?: (asking: Asking) => void
}) {
  const query = useQuery({ queryKey: sessionKeys.list(which), queryFn: () => listSessions(which) })
  if (query.isPending) return <Loader label={translate('sessionsLoading')} className="min-h-40" />
  if (query.error)
    return (
      <div className={cn(cardClass, 'p-4 sm:p-6')}>
        <RetryAlert what={translate('sessionsYour')} onRetry={() => void query.refetch()} />
      </div>
    )
  if (query.data.length === 0)
    return (
      <div className={cardClass}>
        {which === 'upcoming' ? (
          <EmptyState icon={CalendarDays} title={translate('sessionsNoneUpcoming')}>
            {translate('sessionsNoneUpcomingText')}
          </EmptyState>
        ) : (
          <p className="p-4 text-body-sm text-muted-foreground sm:p-6">
            {translate('sessionsNonePast')}
          </p>
        )}
      </div>
    )
  return (
    <ul className="grid gap-3">
      {groupSessions(query.data).map((group) =>
        group.kind === 'series' ? (
          <SeriesCard
            key={group.series.id}
            series={group.series}
            sessions={group.sessions}
            onAsk={onAsk}
          />
        ) : (
          <SessionCard key={group.session.id} session={group.session} onAsk={onAsk} />
        ),
      )}
    </ul>
  )
}

export function PortalSessions() {
  const supplier = useSupplier()
  const [asking, setAsking] = useState<Asking | null>(null)
  const booking = useQuery({ queryKey: sessionKeys.booking, queryFn: getBooking, retry: false })
  return (
    <div className="grid gap-6 sm:gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={translate('sessions')}>
          {translate('sessionsIntro', { supplier })}
        </PageHeader>
        {booking.data?.mode === 'clients' && (
          <Button asChild>
            <Link href={scoped('/book')}>
              <Plus aria-hidden />
              {translate('sessionsBook')}
            </Link>
          </Button>
        )}
      </div>
      <section aria-labelledby="sessions-upcoming" className="grid gap-3">
        <h2 id="sessions-upcoming" className="text-title-sm font-medium">
          {translate('sessionsUpcoming')}
        </h2>
        <SessionList when="upcoming" onAsk={setAsking} />
      </section>
      <section aria-labelledby="sessions-past" className="grid gap-3">
        <h2 id="sessions-past" className="text-title-sm font-medium">
          {translate('sessionsPast')}
        </h2>
        <SessionList when="past" />
      </section>
      {asking?.kind === 'cancel' && (
        <CancelDialog session={asking.session} onClose={() => setAsking(null)} />
      )}
      {asking?.kind === 'reschedule' && (
        <RescheduleDialog session={asking.session} onClose={() => setAsking(null)} />
      )}
    </div>
  )
}

/** The upcoming list, shared by the overview's cards (one request). */
export const useUpcomingSessions = () =>
  useQuery({
    queryKey: sessionKeys.list('upcoming'),
    queryFn: () => listSessions('upcoming'),
    retry: false,
  })

/** The overview's "Next session" card: the first session still to come, or nothing. */
export function NextSessionCard() {
  const query = useUpcomingSessions()
  const next = query.data?.find(isOpen)
  if (!next) return null
  const day = relativeDay(next.starts_at, next.time_zone)
  return (
    <section aria-labelledby="next-session" className={cn(cardClass, 'grid gap-4 p-4 sm:p-6')}>
      <SectionTitle
        id="next-session"
        action={<ViewAll href="/sessions" label={translate('sessionsSeeAll')} />}
      >
        {translate('sessionsNext')}
      </SectionTitle>
      <div className="flex gap-3">
        <DateTile iso={next.starts_at} zone={next.time_zone} />
        <div className="grid min-w-0 flex-1 content-start gap-0.5 leading-tight">
          <span className="truncate text-body font-medium">{next.title}</span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {day}, {formatClock(next.starts_at, next.time_zone)}–
            {formatClock(next.ends_at, next.time_zone)} · {zoneName(next.time_zone)}
          </span>
          {next.host_name && (
            <span className="truncate text-body-sm text-muted-foreground">
              {translate('sessionsWith', { host: next.host_name })}
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-3 text-body-sm">
        <Place session={next} />
        <div className="flex flex-wrap gap-2">
          <JoinButton session={next} />
          <DownloadLink
            href={sessionIcsUrl(next.id)}
            label={translate('sessionsAddToCalendarLabel', { title: next.title, when: when(next) })}
            text={translate('sessionsAddToCalendar')}
          />
        </div>
      </div>
    </section>
  )
}
