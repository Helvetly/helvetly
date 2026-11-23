'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Textarea } from '@helvetly/ui/components/textarea'
import { formatMoney } from '@helvetly/ui/lib/format'
import { ApiError, errorMessage } from '@helvetly/ui/lib/http'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  LoaderCircle,
  MapPin,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { getPortalSession, portalKeys } from '@/lib/portal'
import {
  book,
  bookWithLink,
  browserZone,
  formatClock,
  formatDay,
  formatSpan,
  getBooking,
  getLink,
  isSlotTaken,
  listLinkSlots,
  listSlots,
  sessionKeys,
  slotsByDay,
  uniqueStarts,
  weekRange,
  zoneName,
  type BookableType,
  type Booked,
  type BookInput,
  type Slot,
} from '@/lib/scheduling'
import { scoped } from '@/lib/scope'

import { cardClass, EmptyState, PageHeader, RetryAlert } from './portal-bits'
import { PreviewLock } from './portal-shell'

/** Where the flow books: the signed-in client's portal, or a public booking link (name and email asked). */
export type BookingTarget = { kind: 'client' } | { kind: 'link'; token: string }

const NOTE_MAX = 500
const ANY = 'any'

function TypeCard({ type, onPick }: { type: BookableType; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={cn(
          cardClass,
          'grid w-full gap-1.5 p-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5',
        )}
      >
        <span className="text-body font-medium">{type.name}</span>
        {type.description && (
          <span className="text-body-sm text-pretty text-muted-foreground">{type.description}</span>
        )}
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock aria-hidden className="size-4" />
            {translate('bookMinutes', { count: type.duration_minutes })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {type.mode === 'online' ? (
              <Video aria-hidden className="size-4" />
            ) : (
              <MapPin aria-hidden className="size-4" />
            )}
            {type.mode === 'online' ? translate('bookOnline') : translate('bookLive')}
          </span>
          {type.price && type.currency && (
            <span className="tabular-nums">{formatMoney(type.price, type.currency)}</span>
          )}
        </span>
      </button>
    </li>
  )
}

function WeekSlots({
  target,
  type,
  hostId,
  zone,
  onPick,
}: {
  target: BookingTarget
  type: BookableType
  hostId: string
  zone: string
  onPick: (slot: Slot) => void
}) {
  const [week, setWeek] = useState(0)
  const { from, to } = weekRange(week)
  const host = hostId === ANY ? '' : hostId
  const query = useQuery({
    queryKey: [
      ...sessionKeys.slots(type.id, host, from.toISOString()),
      target.kind === 'link' ? target.token : '',
    ],
    queryFn: () =>
      target.kind === 'link'
        ? listLinkSlots(target.token, type.id, host, from, to)
        : listSlots(type.id, host, from, to),
  })
  const days = slotsByDay(uniqueStarts(query.data ?? []), zone)
  return (
    <section aria-labelledby="book-times" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 id="book-times" className="text-title-sm font-medium">
            {translate('bookPickTime')}
          </h2>
          <p className="text-body-sm text-muted-foreground">
            {translate('bookTimesShownIn', { zone: zoneName(zone) })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="w-9 px-0"
            aria-label={translate('bookPrevWeek')}
            disabled={week === 0}
            onClick={() => setWeek(week - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            className="w-9 px-0"
            aria-label={translate('bookNextWeek')}
            onClick={() => setWeek(week + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <Loader label={translate('bookLoadingSlots')} className="min-h-40" />
      ) : query.error ? (
        <InlineError>{errorMessage(query.error)}</InlineError>
      ) : days.length === 0 ? (
        <p className={cn(cardClass, 'p-4 text-body-sm text-muted-foreground sm:p-6')}>
          {translate('bookNoSlots')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {days.map(({ day, slots }) => (
            <li key={day} className={cn(cardClass, 'grid gap-2 p-4')}>
              <h3 className="text-body-sm font-medium">{formatDay(slots[0]!.starts_at, zone)}</h3>
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <Button
                    key={slot.starts_at}
                    variant="outline"
                    size="sm"
                    className="tabular-nums"
                    aria-label={translate('bookSlotLabel', {
                      when: `${formatDay(slot.starts_at, zone)}, ${formatClock(slot.starts_at, zone)}`,
                    })}
                    onClick={() => onPick(slot)}
                  >
                    {formatClock(slot.starts_at, zone)}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Confirm({
  target,
  type,
  hostId,
  slot,
  zone,
  onBack,
  onTaken,
  onBooked,
}: {
  target: BookingTarget
  type: BookableType
  hostId: string
  slot: Slot
  zone: string
  onBack: () => void
  onTaken: () => void
  onBooked: (booked: Booked) => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [engagement, setEngagement] = useState(type.engagements[0]?.id ?? '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const end = new Date(Date.parse(slot.starts_at) + type.duration_minutes * 60_000).toISOString()
  const send = useMutation({
    mutationFn: () => {
      const input: BookInput = {
        event_type_id: type.id,
        starts_at: slot.starts_at,
        ...(hostId !== ANY && { host_id: hostId }),
        ...(engagement && type.engagements.length > 1 && { engagement_id: engagement }),
        ...(note.trim() && { note: note.trim() }),
      }
      return target.kind === 'link'
        ? bookWithLink(target.token, { ...input, name, email })
        : book(input)
    },
    onSuccess: (booked) => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all })
      onBooked(booked)
    },
    onError: (failure) => {
      if (isSlotTaken(failure)) {
        void queryClient.invalidateQueries({ queryKey: ['portal', 'sessions', 'slots'] })
        onTaken()
        return
      }
      setError(errorMessage(failure))
    },
  })
  return (
    <form
      className={cn(cardClass, 'grid max-w-xl gap-4 p-4 sm:p-6')}
      aria-labelledby="book-confirm"
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        send.mutate()
      }}
    >
      <div className="grid gap-1">
        <h2 id="book-confirm" className="text-title-sm font-medium">
          {translate('bookConfirmTitle')}
        </h2>
        <p className="text-body-sm text-muted-foreground tabular-nums">
          {type.name} · {formatSpan(slot.starts_at, end, zone)} · {zoneName(zone)}
        </p>
      </div>
      {target.kind === 'link' && (
        <>
          <FormField id="book-name" label={translate('bookName')}>
            <Input
              id="book-name"
              required
              autoComplete="name"
              maxLength={200}
              value={name}
              disabled={send.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField id="book-email" label={translate('bookEmail')}>
            <Input
              id="book-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              disabled={send.isPending}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
        </>
      )}
      {type.engagements.length > 1 && (
        <Segmented
          label={translate('bookPackage')}
          value={engagement}
          options={type.engagements.map((e) => ({ value: e.id, label: e.name }))}
          onChange={setEngagement}
        />
      )}
      <FormField
        id="book-note"
        label={translate('note')}
        hint={translate('upToCharacters', { NOTE_MAX })}
      >
        <Textarea
          id="book-note"
          value={note}
          maxLength={NOTE_MAX}
          disabled={send.isPending}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      {error && <InlineError>{error}</InlineError>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={send.isPending}>
          <ArrowLeft aria-hidden />
          {translate('bookBack')}
        </Button>
        <PreviewLock>
          <Button type="submit" disabled={send.isPending}>
            {send.isPending ? (
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <CalendarCheck aria-hidden />
            )}
            {send.isPending ? translate('bookBooking') : translate('bookConfirm')}
          </Button>
        </PreviewLock>
      </div>
    </form>
  )
}

function Done({
  booked,
  supplier,
  zone,
  target,
  onAgain,
}: {
  booked: Booked
  supplier: string
  zone: string
  target: BookingTarget
  onAgain: () => void
}) {
  const waiting = booked.status === 'requested'
  const params = {
    title: booked.title,
    when: `${formatSpan(booked.starts_at, booked.ends_at, zone)} (${zoneName(zone)})`,
    supplier,
  }
  return (
    <output className={cn(cardClass, 'grid max-w-xl gap-3 p-4 sm:p-6')}>
      <h2 className="text-title-sm font-medium">
        {waiting ? translate('bookWaiting') : translate('bookDone')}
      </h2>
      <p className="text-body-sm text-pretty">
        {waiting ? translate('bookWaitingText', params) : translate('bookDoneText', params)}
      </p>
      <div className="flex flex-wrap gap-2">
        {target.kind === 'client' && (
          <Button asChild>
            <Link href={scoped('/sessions')}>{translate('bookToSessions')}</Link>
          </Button>
        )}
        <Button variant="outline" onClick={onAgain}>
          {translate('bookAnother')}
        </Button>
      </div>
    </output>
  )
}

/**
 * Event type → host (or anyone) → a week of free slots in the browser's zone → confirm → done. A time someone
 * else takes meanwhile sends the client back to the slots with a note.
 */
export function BookingFlow({
  target,
  types,
  supplier,
  manual,
  intro,
}: {
  target: BookingTarget
  types: BookableType[]
  supplier: string
  manual: boolean
  intro?: ReactNode
}) {
  const zone = browserZone()
  const [typeId, setTypeId] = useState(types.length === 1 ? types[0]!.id : '')
  const [hostId, setHostId] = useState(ANY)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [taken, setTaken] = useState(false)
  const [booked, setBooked] = useState<Booked | null>(null)
  const type = types.find((t) => t.id === typeId)
  const restart = () => {
    setTypeId(types.length === 1 ? types[0]!.id : '')
    setHostId(ANY)
    setSlot(null)
    setBooked(null)
  }

  if (types.length === 0)
    return (
      <div className={cardClass}>
        <EmptyState icon={CalendarDays} title={translate('bookNoTypes')} />
      </div>
    )
  if (booked)
    return (
      <Done booked={booked} supplier={supplier} zone={zone} target={target} onAgain={restart} />
    )
  if (!type)
    return (
      <section aria-labelledby="book-types" className="grid gap-3">
        <h2 id="book-types" className="text-title-sm font-medium">
          {translate('bookStepType')}
        </h2>
        {intro}
        <ul className="grid gap-3 sm:grid-cols-2">
          {types.map((t) => (
            <TypeCard key={t.id} type={t} onPick={() => setTypeId(t.id)} />
          ))}
        </ul>
      </section>
    )
  if (slot)
    return (
      <Confirm
        target={target}
        type={type}
        hostId={hostId}
        slot={slot}
        zone={zone}
        onBack={() => setSlot(null)}
        onTaken={() => {
          setTaken(true)
          setSlot(null)
        }}
        onBooked={setBooked}
      />
    )
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {types.length > 1 && (
          <Button variant="outline" onClick={() => setTypeId('')}>
            <ArrowLeft aria-hidden />
            {translate('bookBack')}
          </Button>
        )}
        <span className="text-body font-medium">{type.name}</span>
        {manual && (
          <span className="text-body-sm text-muted-foreground">
            {translate('bookManualHint', { supplier })}
          </span>
        )}
      </div>
      {type.hosts.length > 1 && (
        <div className="grid gap-1.5">
          <span className="text-body-sm font-medium" aria-hidden>
            {translate('bookHost')}
          </span>
          <Segmented
            label={translate('bookHost')}
            value={hostId}
            options={[
              { value: ANY, label: translate('bookAnyHost') },
              ...type.hosts.map((h) => ({ value: h.id, label: h.name })),
            ]}
            onChange={setHostId}
          />
        </div>
      )}
      {taken && <InlineError>{translate('bookTaken')}</InlineError>}
      <WeekSlots
        target={target}
        type={type}
        hostId={hostId}
        zone={zone}
        onPick={(picked) => {
          setTaken(false)
          setSlot(picked)
        }}
      />
    </div>
  )
}

/** The signed-in client's Book page: the flow when clients may book, else why not. */
export function PortalBook() {
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  const supplier = session.data?.workspace.name ?? translate('yourSupplier')
  const query = useQuery({ queryKey: sessionKeys.booking, queryFn: getBooking, retry: false })
  const body = () => {
    if (query.isPending) return <Loader label={translate('bookLoading')} className="min-h-72" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('bookWhat')} onRetry={() => void query.refetch()} />
        </div>
      )
    if (!query.data || query.data.mode !== 'clients')
      return (
        <div className={cardClass}>
          <EmptyState icon={CalendarDays} title={translate('bookOff')}>
            {translate('bookOffText', { supplier })}
          </EmptyState>
        </div>
      )
    return (
      <BookingFlow
        target={{ kind: 'client' }}
        types={query.data.event_types}
        supplier={supplier}
        manual={query.data.confirmation === 'manual'}
      />
    )
  }
  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader title={translate('bookTitle')}>
        {query.data?.policy_text || translate('bookIntro')}
      </PageHeader>
      {body()}
    </div>
  )
}

/** A public booking link's page (no session): whose link it is, then the flow with name and email. */
export function LinkBooking({ token }: { token: string }) {
  const query = useQuery({
    queryKey: sessionKeys.link(token),
    queryFn: () => getLink(token),
    retry: false,
    enabled: token !== '',
  })
  const gone = token === '' || (query.error instanceof ApiError && query.error.status === 404)
  const body = () => {
    if (gone)
      return (
        <div className={cardClass}>
          <EmptyState icon={CalendarDays} title={translate('bookLinkGone')}>
            {translate('bookLinkGoneText')}
          </EmptyState>
        </div>
      )
    if (query.isPending) return <Loader label={translate('bookLoading')} className="min-h-72" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('bookWhat')} onRetry={() => void query.refetch()} />
        </div>
      )
    return (
      <BookingFlow
        target={{ kind: 'link', token }}
        types={query.data.event_types}
        supplier={query.data.workspace}
        manual={query.data.confirmation === 'manual'}
      />
    )
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <PageHeader
        title={
          query.data
            ? translate('bookWith', { supplier: query.data.workspace })
            : translate('bookTitle')
        }
      >
        {query.data?.policy_text}
      </PageHeader>
      {body()}
    </div>
  )
}
