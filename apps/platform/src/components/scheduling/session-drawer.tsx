'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { cn } from '@helvetly/ui/lib/utils'
import {
  CalendarDays,
  ClipboardCheck,
  Download,
  Ellipsis,
  MapPin,
  Pencil,
  Repeat,
  TriangleAlert,
  User,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadProblem } from '@/components/data/load-problem'
import { RecordLink, useDrawers } from '@/components/record-link'
import { apiFieldErrors } from '@/components/section-form'
import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import {
  icsUrl,
  isOpen,
  longDayLabel,
  recurrenceSummary,
  schedulingApi,
  timeLabel,
  useOccurrence,
  useSchedEvent,
  useSchedulingWrite,
  zoned,
  zoneName,
  type Occurrence,
  type SchedEvent,
} from '@/lib/scheduling'

import { MapLink } from './address-input'
import { HostDot, StatusBadge, useSessionChange } from './bits'
import { DayOffWarning, useDaysOff } from './day-off'
import { whenLabel, RequestCard } from './requests'
import { SessionFields } from './session-form'
import {
  blankValues,
  changesOf,
  toInput,
  validate,
  valuesFrom,
  type Errors,
  type Values,
} from './session-model'
import { StatusActions } from './status-actions'

export type NewSession = Parameters<typeof blankValues>[0]
export type DrawerTarget = { kind: 'view'; id: string } | { kind: 'create'; start: NewSession }

/** One drawer for a session: its details and actions, and the same form to create or change it. */
export function SessionDrawer({
  target,
  zone,
  now,
  onClose,
  onView,
}: {
  target: DrawerTarget
  /** Where new sessions are written (the workspace's zone) and times are shown. */
  zone: string
  now: Date
  onClose: () => void
  /** Shows a session in the drawer (after it was created). */
  onView: (id: string) => void
}) {
  const [dirty, setDirty] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const requestClose = () => (dirty ? setDiscarding(true) : onClose())
  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        onOpenAutoFocus={(event) => target.kind === 'view' && event.preventDefault()}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(680px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetDescription className="sr-only">
          {translate('schedSessionDescription')}
        </SheetDescription>
        {target.kind === 'create' ? (
          <CreateSession
            key={JSON.stringify(target.start)}
            start={target.start}
            zone={zone}
            onDirty={setDirty}
            onCancel={requestClose}
            onCreated={(id) => {
              setDirty(false)
              onView(id)
            }}
          />
        ) : (
          <ViewSession
            key={target.id}
            id={target.id}
            zone={zone}
            now={now}
            onDirty={setDirty}
            onClose={requestClose}
          />
        )}
        {discarding && (
          <ConfirmDialog
            title={translate('discardYourChanges')}
            body={translate('whatYouEnteredInThisFormWillBeLost')}
            confirmLabel={translate('discard')}
            cancelLabel={translate('keepEditing')}
            tone="destructive"
            onDecide={(discard) => {
              setDiscarding(false)
              if (discard) onClose()
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function useForm(initial: Values, onDirty: (dirty: boolean) => void) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Errors>({})
  const set = (change: Partial<Values>) => {
    setValues((current) => ({ ...current, ...change }))
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !(key in change))),
    )
    onDirty(true)
  }
  /** The checks' errors, shown and the first field focused; true when there are none. */
  const check = (found: Errors = validate(values)) => {
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) document.getElementById(`session-${first}`)?.focus()
    return !first
  }
  return { values, errors, set, check }
}

const FIELD_OF: Record<string, keyof Values> = {
  client_id: 'client',
  engagement_id: 'engagement_id',
  host_id: 'host_id',
  starts_local: 'date',
  duration_minutes: 'duration',
  'meeting.url': 'meeting_url',
  meeting: 'provider',
}
const serverErrors = (error: unknown): Errors | null => {
  const fields = apiFieldErrors(error, (name) => FIELD_OF[name] ?? name.split('.')[0] ?? name)
  if (fields) return fields
  // A meeting the host's calendar cannot make is the provider choice's problem.
  const code = error instanceof ApiError ? error.code : ''
  if (
    error instanceof ApiError &&
    ['meeting_provider', 'teams_unavailable', 'meeting_unavailable'].includes(code)
  )
    return { meeting_url: error.message }
  return null
}

function CreateSession({
  start,
  zone,
  onDirty,
  onCancel,
  onCreated,
}: {
  start: NewSession
  zone: string
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const form = useForm(blankValues(start), onDirty)
  const create = useSchedulingWrite(schedulingApi.createEvent)
  // A series skips days off by its own rule; a one-off there is a special request, confirmed for that date.
  const daysOff = useDaysOff()
  const dayOff = form.values.repeat === 'none' ? daysOff.get(form.values.date) : undefined
  const [specialDate, setSpecialDate] = useState('')
  const blocked = dayOff !== undefined && specialDate !== form.values.date
  const submit = () => {
    if (create.isPending || blocked || !form.check()) return
    const input = toInput(form.values, zone)
    create.mutate(dayOff ? { ...input, allow_day_off: true } : input, {
      onSuccess: ({ occurrences, conflicts }) => {
        toast.success(
          conflicts.length
            ? translate('schedScheduledWithConflicts', { count: conflicts.length })
            : translate('schedScheduled'),
        )
        const first = occurrences[0]
        if (first) onCreated(first.id)
      },
      onError: (error) => {
        const fields = serverErrors(error)
        if (fields) form.check(fields)
        else toastError(error)
      },
    })
  }
  return (
    <FormShell
      title={translate('schedNewSession')}
      subtitle={translate('schedNewSessionText')}
      pending={create.isPending}
      submitLabel={translate('schedSchedule')}
      blocked={blocked}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {dayOff && (
        <DayOffWarning
          date={form.values.date}
          name={dayOff}
          confirmed={!blocked}
          onConfirm={(yes) => setSpecialDate(yes ? form.values.date : '')}
        />
      )}
      <SessionFields
        values={form.values}
        errors={form.errors}
        zone={zone}
        editing={false}
        set={form.set}
      />
    </FormShell>
  )
}

function FormShell({
  title,
  subtitle,
  pending,
  submitLabel,
  blocked = false,
  onSubmit,
  onCancel,
  children,
}: {
  title: string
  subtitle: string
  pending: boolean
  submitLabel: string
  /** Something above the fields still needs a yes before saving. */
  blocked?: boolean
  onSubmit: () => void
  onCancel: () => void
  children: ReactNode
}) {
  const form = useRef<HTMLFormElement>(null)
  // ⌘Enter / Ctrl+Enter saves from anywhere in the form.
  const saveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (!(event.target instanceof Node) || !form.current?.contains(event.target)) return
    event.preventDefault()
    onSubmit()
  })
  useEffect(() => {
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [])
  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-6">
        <div className="grid min-w-0 gap-0.5">
          <SheetTitle className="truncate text-lg font-semibold">{title}</SheetTitle>
          <p className="text-body-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={translate('close')}
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">{children}</div>
      <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-6">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Kbd>⌘ Enter</Kbd>
          {translate('toSave')}
        </span>
        <Button type="button" variant="ghost" className="ml-auto" onClick={onCancel}>
          {translate('cancel')}
        </Button>
        <Button type="submit" disabled={pending || blocked}>
          {pending ? translate('saving') : submitLabel}
        </Button>
      </div>
    </form>
  )
}

function ViewSession({
  id,
  zone,
  now,
  onDirty,
  onClose,
}: {
  id: string
  zone: string
  now: Date
  onDirty: (dirty: boolean) => void
  onClose: () => void
}) {
  const occurrence = useOccurrence(id)
  const event = useSchedEvent(occurrence.data?.event_id ?? null)
  const [editing, setEditing] = useState(false)
  if (occurrence.error)
    return (
      <div className="p-5">
        <SheetTitle className="sr-only">{translate('schedSession')}</SheetTitle>
        <LoadProblem
          error={occurrence.error}
          what={translate('schedSession')}
          onRetry={() => void occurrence.refetch()}
        />
      </div>
    )
  if (!occurrence.data || !event.data)
    return (
      <>
        <SheetTitle className="sr-only">{translate('schedSession')}</SheetTitle>
        <Loader />
      </>
    )
  if (editing)
    return (
      <EditSession
        occurrence={occurrence.data}
        event={event.data}
        onDirty={onDirty}
        onDone={() => {
          onDirty(false)
          setEditing(false)
        }}
      />
    )
  return (
    <SessionDetails
      occurrence={occurrence.data}
      event={event.data}
      zone={zone}
      now={now}
      onEdit={() => setEditing(true)}
      onClose={onClose}
    />
  )
}

function EditSession({
  occurrence,
  event,
  onDirty,
  onDone,
}: {
  occurrence: Occurrence
  event: SchedEvent
  onDirty: (dirty: boolean) => void
  onDone: () => void
}) {
  const [initial] = useState(() => valuesFrom(occurrence, event))
  const form = useForm(initial, onDirty)
  const { change, dialog, pending } = useSessionChange()
  const submit = () => {
    if (pending || !form.check()) return
    const { body, ruleChanged, empty } = changesOf(initial, form.values, event.time_zone)
    if (empty) return onDone()
    void change(occurrence, body, { onlySeries: ruleChanged, done: onDone })
  }
  return (
    <>
      <FormShell
        title={translate('schedEditSession')}
        subtitle={
          event.recurrence ? translate('schedEditSeriesText') : translate('schedEditSessionText')
        }
        pending={pending}
        submitLabel={translate('saveChanges')}
        onSubmit={submit}
        onCancel={onDone}
      >
        <SessionFields
          values={form.values}
          errors={form.errors}
          zone={event.time_zone}
          excludeId={occurrence.id}
          editing
          set={form.set}
        />
      </FormShell>
      {dialog}
    </>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 border-t border-border/60 py-1.5 first:border-t-0">
      <Icon className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
      <span className="w-28 shrink-0 text-body-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-body-sm break-words">{children}</span>
    </div>
  )
}

function SessionDetails({
  occurrence,
  event,
  zone,
  now,
  onEdit,
  onClose,
}: {
  occurrence: Occurrence
  event: SchedEvent
  zone: string
  now: Date
  onEdit: () => void
  onClose: () => void
}) {
  const canWrite = useCan('write:scheduling')
  const drawers = useDrawers()
  const { engagement } = occurrence
  const start = zoned(occurrence.starts_at, zone)
  const eventZone = event.time_zone !== zone ? event.time_zone : null
  const closed = occurrence.status.startsWith('cancelled') || occurrence.status === 'declined'
  const meeting = occurrence.meeting ?? event.meeting
  const conflicts = occurrence.conflicts ?? []
  const notLogged =
    occurrence.counts &&
    occurrence.engagement &&
    occurrence.entry_ids.length === 0 &&
    !occurrence.waived

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="grid shrink-0 gap-3 border-b px-5 py-4 md:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <SheetTitle
                className={cn('truncate text-lg font-semibold', closed && 'line-through')}
              >
                {occurrence.title}
              </SheetTitle>
              <StatusBadge status={occurrence.status} />
              {occurrence.is_exception && (
                <Badge tone="neutral">{translate('schedChangedOnItsOwn')}</Badge>
              )}
            </span>
            <p className="text-body-sm text-muted-foreground">
              {longDayLabel(start.date)} · {timeLabel(occurrence.starts_at, zone)}–
              {timeLabel(occurrence.ends_at, zone)} ({zoneName(zone)})
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('moreActions')}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <ActionMenuContent
                kind="dropdown"
                menu={{
                  header: occurrence.title,
                  actions: [
                    {
                      id: 'ics',
                      group: 'view',
                      icon: <Download />,
                      label: translate('schedDownloadIcs'),
                      href: icsUrl(occurrence.id),
                      download: true,
                    },
                    engagement && {
                      id: 'engagement',
                      group: 'view',
                      icon: <ClipboardCheck />,
                      label: translate('schedOpenEngagement'),
                      // Stacked over this drawer: closing it comes back to the session.
                      onSelect: () => drawers.open({ kind: 'engagement', id: engagement.id }),
                    },
                    canWrite &&
                      isOpen(occurrence.status) && {
                        id: 'edit',
                        group: 'edit',
                        icon: <Pencil />,
                        label: translate('schedEditSession'),
                        onSelect: onEdit,
                      },
                  ],
                }}
              />
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={translate('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        <StatusActions occurrence={occurrence} recurring={Boolean(event.recurrence)} now={now} />
      </header>

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4 sm:p-5">
        {conflicts.length > 0 && isOpen(occurrence.status) && (
          <div className="flex gap-2 rounded-xl bg-warning-surface px-4 py-3 text-body-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="grid gap-0.5">
              <span className="font-medium">
                {translate('schedConflicts', { count: conflicts.length })}
              </span>
              {conflicts.map((conflict) => (
                <span key={`${conflict.kind}-${conflict.starts_at}`}>
                  {timeLabel(conflict.starts_at, zone)}–{timeLabel(conflict.ends_at, zone)}{' '}
                  {conflict.kind === 'busy'
                    ? translate('schedBusyInCalendar')
                    : (conflict.title ?? translate('schedAnotherSession'))}
                </span>
              ))}
            </div>
          </div>
        )}

        {occurrence.request && <RequestCard request={occurrence.request} zone={zone} />}

        <Panel>
          <Row icon={CalendarDays} label={translate('schedWhen')}>
            {whenLabel(occurrence.starts_at, zone)}–{timeLabel(occurrence.ends_at, zone)}
            {eventZone && (
              <span className="text-muted-foreground">
                {' '}
                · {timeLabel(occurrence.starts_at, eventZone)} {zoneName(eventZone)}
              </span>
            )}
          </Row>
          <Row icon={User} label={translate('client')}>
            <RecordLink href={`/clients?id=${encodeURIComponent(occurrence.client.id)}`}>
              {occurrence.client.name}
            </RecordLink>
          </Row>
          <Row icon={User} label={translate('schedHost')}>
            {occurrence.host ? (
              <span className="flex items-center gap-1.5">
                <HostDot id={occurrence.host.id} />
                {occurrence.host.name}
              </span>
            ) : (
              <span className="text-muted-foreground">{translate('schedHostLeft')}</span>
            )}
          </Row>
          {occurrence.engagement && (
            <Row icon={ClipboardCheck} label={translate('schedEngagement')}>
              <RecordLink href={`/engagements?id=${encodeURIComponent(occurrence.engagement.id)}`}>
                #{occurrence.engagement.number} {occurrence.engagement.title}
              </RecordLink>
            </Row>
          )}
          {meeting ? (
            <Row icon={Video} label={translate('schedOnline')}>
              {meeting.url ? (
                <a
                  href={meeting.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link underline underline-offset-2 hover:no-underline"
                >
                  {meeting.url}
                </a>
              ) : (
                <span className="text-muted-foreground">{translate('schedLinkPending')}</span>
              )}
            </Row>
          ) : (
            <Row icon={MapPin} label={translate('location')}>
              {occurrence.location ? (
                <span className="inline-flex items-start gap-1.5">
                  {occurrence.location}
                  <MapLink location={occurrence.location} className="size-5 shrink-0" />
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
          )}
          {event.recurrence && (
            <Row icon={Repeat} label={translate('schedRepeats')}>
              {recurrenceSummary(event.recurrence, event.starts_local.slice(0, 10))}
            </Row>
          )}
        </Panel>

        {(event.client_note || event.description) && (
          <Panel title={translate('notes')}>
            {event.client_note && (
              <p className="text-body-sm">
                <span className="text-muted-foreground">{translate('schedClientNote')}: </span>
                {event.client_note}
              </p>
            )}
            {event.description && (
              <p className="mt-1.5 text-body-sm">
                <span className="text-muted-foreground">{translate('schedInternalNotes')}: </span>
                {event.description}
              </p>
            )}
          </Panel>
        )}

        <Panel title={translate('schedHistory')}>
          <ul className="grid gap-1.5 text-body-sm">
            <li>
              {translate('schedLastChanged', { when: whenLabel(occurrence.updated_at, zone) })}
              {occurrence.sequence > 0 &&
                ` · ${translate('schedVersion', { count: occurrence.sequence })}`}
            </li>
            {occurrence.counts && !occurrence.waived && (
              <li>
                {occurrence.engagement
                  ? translate('schedCountsOnEngagement')
                  : translate('schedCountsBillable')}
              </li>
            )}
            {notLogged && (
              <li className="flex items-center gap-1.5 text-warning">
                <TriangleAlert className="size-3.5" />
                {translate('schedNotLogged')}
              </li>
            )}
            {occurrence.waived && (
              <li>
                {translate('schedWaivedBy', {
                  name: occurrence.waived.by.name,
                  when: whenLabel(occurrence.waived.at, zone),
                })}
                {occurrence.waived.reason && ` · “${occurrence.waived.reason}”`}
              </li>
            )}
            {occurrence.invoice && (
              <li>
                <RecordLink href={`/invoices?id=${encodeURIComponent(occurrence.invoice.id)}`}>
                  {translate('schedInvoiced', {
                    number: occurrence.invoice.number ?? translate('schedDraft'),
                  })}
                </RecordLink>
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
