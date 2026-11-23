'use client'
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
import { FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Textarea } from '@helvetly/ui/components/textarea'
import { errorMessage } from '@helvetly/ui/lib/http'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarDays,
  CalendarX,
  LoaderCircle,
  MapPin,
  Plus,
  Video,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import { getPortalSession, portalKeys } from '@/lib/portal'
import {
  answerProposal,
  deadlineText,
  formatClock,
  formatDay,
  formatSpan,
  getBooking,
  isLateNow,
  lateCounts,
  listSessions,
  localToInstant,
  requestCancel,
  requestReschedule,
  sessionIcsUrl,
  sessionKeys,
  withdrawRequest,
  zoneName,
  type ClientSession,
  type SessionStatus,
} from '@/lib/scheduling'
import { scoped } from '@/lib/scope'

import { cardClass, DownloadLink, EmptyState, PageHeader, RetryAlert } from './portal-bits'
import { PreviewLock } from './portal-shell'

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
  return session.data?.workspace.name ?? translate('yourSupplier')
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
    <li className="grid gap-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="grid min-w-0 flex-1 gap-0.5 leading-tight">
          <span className="text-body font-medium">{session.title}</span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {when(session)} · {zoneName(session.time_zone)}
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
        {session.mode === 'online' ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Video aria-hidden className="size-4" />
            {translate('sessionsOnline')}
          </span>
        ) : (
          session.location && (
            <a
              className="inline-flex items-center gap-1.5 underline underline-offset-2"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(session.location)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin aria-hidden className="size-4" />
              {session.location}
            </a>
          )
        )}
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
          {session.meeting_url && (
            <Button asChild>
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
    <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
      {query.data.map((session) => (
        <SessionCard key={session.id} session={session} onAsk={onAsk} />
      ))}
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

/** The overview's "Next session" card: the first upcoming session, or nothing. */
export function NextSessionCard() {
  const query = useQuery({
    queryKey: sessionKeys.list('upcoming'),
    queryFn: () => listSessions('upcoming'),
    retry: false,
  })
  const next = query.data?.[0]
  if (!next) return null
  return (
    <section aria-labelledby="next-session" className={cn(cardClass, 'grid gap-2 p-4 sm:p-6')}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="next-session" className="text-title-sm font-medium">
          {translate('sessionsNext')}
        </h2>
        <Link
          href={scoped('/sessions')}
          className="text-body-sm underline underline-offset-2 hover:text-foreground"
        >
          {translate('sessionsSeeAll')}
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="grid gap-0.5 leading-tight">
          <span className="text-body font-medium">{next.title}</span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {when(next)} · {zoneName(next.time_zone)}
          </span>
        </span>
        {next.meeting_url ? (
          <Button asChild>
            <a href={next.meeting_url} target="_blank" rel="noreferrer">
              <Video aria-hidden />
              {translate('sessionsJoin')}
            </a>
          </Button>
        ) : (
          <SessionStatusBadge status={next.status} />
        )}
      </div>
    </section>
  )
}
