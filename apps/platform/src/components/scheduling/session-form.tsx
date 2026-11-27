'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Combobox } from '@helvetly/ui/components/combobox'
import { FormField } from '@helvetly/ui/components/form-field'
import { FieldError } from '@helvetly/ui/components/inline-error'
import { inputClass } from '@helvetly/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@helvetly/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Switch } from '@helvetly/ui/components/switch'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlignLeft,
  Building2,
  ChevronsUpDown,
  Clock,
  LayoutTemplate,
  Mail,
  MapPin,
  Plus,
  Repeat,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { ClientSearch } from '@/components/invoices/client-search'
import { TextareaBox } from '@/components/textarea-box'
import { peopleWith, useClient } from '@/lib/clients'
import { useClientEngagements } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { useMembers } from '@/lib/members'
import { useSession } from '@/lib/queries'
import {
  clock,
  dayLabel,
  minutesOf,
  recurrenceSummary,
  timeLabel,
  useCalendars,
  useConflicts,
  useEventTypes,
  WEEKDAYS,
  weekdayName,
  zoned,
  zoneName,
  type Conflict,
  type MeetingProvider,
  type Weekday,
} from '@/lib/scheduling'

import { AddressInput } from './address-input'
import { TimeLock } from './bits'
import {
  autoTitle,
  dateChange,
  eventTypeValues,
  presetOf,
  presetValues,
  recurrenceOf,
  setPosOf,
  slotOf,
  typedTitle,
  weekdayOfDate,
  type Errors,
  type RepeatPreset,
  type Values,
} from './session-model'

const DURATIONS = [15, 30, 45, 60, 90, 120]
const fieldId = (name: keyof Values) => `session-${name}`
/** Focuses a field a click has just revealed, once it is rendered. */
const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())
/** Where a person connects their own calendar; a new tab, so the form in the drawer stays as it is. */
const CONNECT_CALENDAR = '/settings/scheduling#calendars'

/** The session's fields; `excludeId` keeps the session itself out of its conflicts. */
export function SessionFields({
  values,
  errors,
  zone,
  excludeId,
  editing,
  timeLocked = false,
  set,
}: {
  values: Values
  errors: Errors
  zone: string
  excludeId?: string
  /** Changing an existing session: the client stays. */
  editing: boolean
  /** The session has started: date, start and length are read-only. */
  timeLocked?: boolean
  set: (change: Partial<Values>) => void
}) {
  const me = useSession().data?.user.id
  const members = useMembers()
  const engagements = useClientEngagements(values.client?.id ?? '')
  const clientRecord = useClient(values.client?.id ?? null)
  const eventTypes = useEventTypes()
  const slot = slotOf(values, zone)
  const conflicts = useConflicts(
    slot && values.host_id ? { host_id: values.host_id, ...slot, exclude: excludeId } : null,
  )
  const [clientOpen, setClientOpen] = useState(false)
  const [notes, setNotes] = useState({
    client: values.client_note !== '',
    internal: values.description !== '',
  })

  const describe = (name: keyof Values) => ({
    id: fieldId(name),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${fieldId(name)}-error` : undefined,
  })
  const running = (engagements.data ?? []).filter(
    (entry) => entry.status === 'active' || entry.status === 'scheduled',
  )
  const types = (eventTypes.data ?? []).filter((entry) => !entry.archived_at)
  // A company's participants: the one who takes the session gets its mail.
  const participants = clientRecord.data?.is_company
    ? peopleWith(clientRecord.data, 'participant')
    : []
  const hosts =
    members.data?.map((member) => ({
      value: member.user_id,
      label: member.name || member.email,
    })) ?? []

  return (
    <div className="grid gap-4">
      <Line>
        <input
          {...describe('title')}
          aria-label={translate('title')}
          value={values.title}
          maxLength={200}
          onChange={(event) => set(typedTitle(event.target.value))}
          placeholder={translate('schedAddTitle')}
          // The drawer is its box, as the invoice paper is (`field-quiet`): a heading one types into, always underlined so it reads as a field, darker on hover and focus.
          className="field-quiet h-10 w-full border-b border-border bg-transparent text-xl leading-7 font-semibold transition-colors outline-none placeholder:font-normal placeholder:text-muted-foreground hover:border-foreground/30 focus-visible:border-ring aria-invalid:border-destructive"
        />
        {errors.title && <FieldError id={`${fieldId('title')}-error`}>{errors.title}</FieldError>}
      </Line>

      <Line icon={Building2}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            id={fieldId('client')}
            label={translate('client')}
            error={errors.client}
            className="sm:col-span-2"
          >
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button
                  {...describe('client')}
                  type="button"
                  variant="ghost"
                  disabled={editing}
                  className={cn(
                    inputClass,
                    'justify-between gap-1.5 bg-clip-border text-left font-normal hover:bg-card aria-expanded:border-ring aria-expanded:bg-card dark:hover:bg-input/30 dark:aria-expanded:bg-input/30',
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      !values.client && 'text-muted-foreground',
                    )}
                  >
                    {values.client?.name ?? translate('schedChooseClientPlaceholder')}
                  </span>
                  <ChevronsUpDown className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <ClientSearch
                  selectedId={values.client?.id ?? null}
                  onSelect={(client) => {
                    setClientOpen(false)
                    set({
                      client: { id: client.id, name: client.name },
                      engagement_id: '',
                      participant_id: '',
                    })
                  }}
                />
              </PopoverContent>
            </Popover>
          </Field>
          {values.client && (running.length > 0 || values.engagement_id) && (
            <Field id={fieldId('engagement_id')} error={errors.engagement_id}>
              <Combobox
                id={fieldId('engagement_id')}
                label={translate('schedEngagement')}
                value={values.engagement_id}
                options={running.map((entry) => ({
                  value: entry.id,
                  label: `#${entry.number} ${entry.title}`,
                  hint: entry.current_period
                    ? translate('schedRemaining', {
                        count: Number(entry.current_period.remaining),
                      })
                    : undefined,
                }))}
                onChange={(engagement_id) => {
                  const engagement = running.find((entry) => entry.id === engagement_id)
                  set({ engagement_id, ...autoTitle(values, engagement?.title ?? '') })
                }}
                onClear={() => set({ engagement_id: '' })}
                clearLabel={translate('schedClearEngagement')}
                placeholder={translate('schedNoEngagement')}
              />
            </Field>
          )}
          {values.client && (participants.length > 0 || values.participant_id) && (
            <Field id={fieldId('participant_id')} error={errors.participant_id}>
              <Combobox
                id={fieldId('participant_id')}
                label={translate('schedParticipant')}
                value={values.participant_id}
                options={participants.map((person) => ({
                  value: person.id,
                  label: person.name,
                  hint: person.email ?? undefined,
                }))}
                onChange={(participant_id) => set({ participant_id })}
                onClear={() => set({ participant_id: '' })}
                clearLabel={translate('schedClearParticipant')}
                placeholder={translate('schedNoParticipant')}
              />
            </Field>
          )}
        </div>
      </Line>

      {(types.length > 0 || values.event_type_id) && (
        <Line icon={LayoutTemplate}>
          <Field id={fieldId('event_type_id')} error={errors.event_type_id}>
            <Combobox
              id={fieldId('event_type_id')}
              label={translate('schedEventType')}
              value={values.event_type_id}
              options={types.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(id) => {
                const type = types.find((entry) => entry.id === id)
                if (!type) return
                set(eventTypeValues(values, type))
              }}
              onClear={() => set({ event_type_id: '' })}
              clearLabel={translate('schedClearEventType')}
              placeholder={translate('schedPickEventType')}
            />
          </Field>
        </Line>
      )}

      {/* One member hosts everything: nothing to choose. */}
      {hosts.length > 1 && (
        <Line icon={UserRound}>
          <Field id={fieldId('host_id')} error={errors.host_id}>
            <Combobox
              id={fieldId('host_id')}
              label={translate('schedHost')}
              value={values.host_id}
              options={hosts.map((host) =>
                host.value === me ? { ...host, hint: translate('schedYou') } : host,
              )}
              onChange={(host_id) => set({ host_id })}
              placeholder={translate('schedChooseHost')}
              invalid={Boolean(errors.host_id)}
            />
          </Field>
        </Line>
      )}

      <Line icon={Clock}>
        <When values={values} errors={errors} set={set} describe={describe} locked={timeLocked} />
        <p
          className="mt-1.5 flex h-5 min-w-0 items-center gap-1.5 text-body-sm text-muted-foreground"
          aria-live="polite"
        >
          {slot && (
            <span className="truncate">
              {dayLabel(values.date)} · {timeLabel(slot.starts_at, zone)} –{' '}
              {timeLabel(slot.ends_at, zone)} ({zoneName(zone)})
            </span>
          )}
          {timeLocked && <TimeLock />}
        </p>
        <Overlaps
          conflicts={slot && values.host_id ? (conflicts.data ?? []) : []}
          values={values}
          zone={zone}
          set={set}
        />
      </Line>

      <Line icon={Repeat}>
        <RepeatFields values={values} errors={errors} set={set} describe={describe} />
      </Line>

      <Line icon={MapPin}>
        <Where values={values} errors={errors} set={set} describe={describe} me={me} />
      </Line>

      {/* The first line is a note's label once one is open, else the buttons that open them. */}
      <Line icon={AlignLeft} lead={notes.client || notes.internal ? 'label' : 'button'}>
        <div className="grid gap-2">
          {(notes.client || notes.internal) && (
            <div className="grid gap-4">
              {notes.client && (
                <FormField
                  id={fieldId('client_note')}
                  label={translate('schedClientNote')}
                  error={errors.client_note}
                  tip={translate('schedClientNoteTip')}
                >
                  <TextareaBox
                    {...describe('client_note')}
                    rows={2}
                    max={2000}
                    value={values.client_note}
                    onChange={(event) => set({ client_note: event.target.value })}
                  />
                </FormField>
              )}
              {notes.internal && (
                <FormField
                  id={fieldId('description')}
                  label={translate('schedInternalNotes')}
                  error={errors.description}
                  tip={translate('schedInternalNotesTip')}
                >
                  <TextareaBox
                    {...describe('description')}
                    rows={2}
                    max={4000}
                    value={values.description}
                    onChange={(event) => set({ description: event.target.value })}
                  />
                </FormField>
              )}
            </div>
          )}
          {!(notes.client && notes.internal) && (
            <div className="-ml-2 flex flex-wrap gap-1">
              {!notes.client && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    setNotes((open) => ({ ...open, client: true }))
                    focusSoon(fieldId('client_note'))
                  }}
                >
                  <Plus />
                  {translate('schedAddClientNote')}
                </Button>
              )}
              {!notes.internal && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    setNotes((open) => ({ ...open, internal: true }))
                    focusSoon(fieldId('description'))
                  }}
                >
                  <Plus />
                  {translate('schedAddInternalNote')}
                </Button>
              )}
            </div>
          )}
        </div>
      </Line>

      <Line icon={Mail} lead="label">
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <label
              htmlFor="session-notify"
              className="w-fit cursor-pointer text-body-sm font-medium"
            >
              {translate('schedEmailClient')}
            </label>
            <p id="session-notify-description" className="text-body-sm text-muted-foreground">
              {translate('schedEmailClientText')}
            </p>
          </div>
          <Switch
            id="session-notify"
            aria-describedby="session-notify-description"
            checked={values.notify}
            onCheckedChange={(notify) => set({ notify })}
          />
        </div>
      </Line>
    </div>
  )
}

type Describe = (name: keyof Values) => {
  id: string
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
}
type Part = {
  values: Values
  errors: Errors
  set: (change: Partial<Values>) => void
  describe: Describe
}

/** The height of a row's first line, which its icon is centred on: a field, a small button or a label. */
const LEAD = { control: 'h-9', button: 'h-7', label: 'h-[18px]' } as const

/**
 * A row of the form: its icon in a fixed gutter (as a calendar's event editor), the fields beside it. The icon's box
 * is as high as the row's first line, so the icon sits on it whatever comes below.
 */
function Line({
  icon: Icon,
  lead = 'control',
  children,
}: {
  icon?: LucideIcon
  lead?: keyof typeof LEAD
  children: ReactNode
}) {
  return (
    <div data-row className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3">
      <span data-row-icon className={cn('flex items-center', LEAD[lead])}>
        {Icon && <Icon aria-hidden className="size-4 stroke-[1.75] text-muted-foreground" />}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** One control with its label for screen readers only (the row's icon and placeholder show it) and its error. */
function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string
  /** For a control that has no `label` prop of its own. */
  label?: string
  error?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1', className)}>
      {label && (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      )}
      {children}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}

/** Date, start and length side by side, as wide as the fields above; the date takes its own line on a phone. */
function When({ values, errors, set, describe, locked }: Part & { locked: boolean }) {
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label htmlFor={fieldId('date')} className="sr-only">
          {translate('date')}
        </label>
        <input
          {...describe('date')}
          type="date"
          value={values.date}
          readOnly={locked}
          onChange={(event) => set(dateChange(values, event.target.value))}
          className={cn(inputClass, 'col-span-2 sm:col-span-1', locked && 'text-muted-foreground')}
        />
        <label htmlFor={fieldId('time')} className="sr-only">
          {translate('schedStart')}
        </label>
        <input
          {...describe('time')}
          type="time"
          step={300}
          value={values.time}
          readOnly={locked}
          onChange={(event) => set({ time: event.target.value })}
          className={cn(inputClass, locked && 'text-muted-foreground')}
        />
        <Duration values={values} errors={errors} set={set} describe={describe} locked={locked} />
      </div>
      {(['date', 'time', 'duration'] as const).map(
        (name) =>
          errors[name] && (
            <FieldError key={name} id={`${fieldId(name)}-error`}>
              {errors[name]}
            </FieldError>
          ),
      )}
    </div>
  )
}

/**
 * The length as a select of common ones, each naming the end time it gives; the form's own length (an event type's
 * 50 min) is one of them. Custom… turns it into minutes, with a way back to the list.
 */
function Duration({ values, errors, set, describe, locked }: Part & { locked: boolean }) {
  const [custom, setCustom] = useState(false)
  if (custom) {
    return (
      <InputGroup>
        <InputGroupInput
          {...describe('duration')}
          aria-label={translate('schedDurationMinutes')}
          inputMode="numeric"
          value={values.duration}
          onChange={(event) => set({ duration: event.target.value })}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{translate('schedMinutesUnit')}</InputGroupText>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('schedDurationPresets')}
            title={translate('schedDurationPresets')}
            onClick={() => {
              setCustom(false)
              focusSoon(fieldId('duration'))
            }}
          >
            <ChevronsUpDown />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    )
  }
  const minutes = Number(values.duration)
  const valid = Number.isInteger(minutes) && minutes > 0
  const lengths = [...new Set([...DURATIONS, ...(valid ? [minutes] : [])])].toSorted(
    (a, b) => a - b,
  )
  const start = /^\d{2}:\d{2}$/.test(values.time) ? minutesOf(values.time) : null
  return (
    <Combobox
      id={fieldId('duration')}
      label={translate('schedDuration')}
      value={valid ? String(minutes) : ''}
      options={[
        ...lengths.map((length) => ({
          value: String(length),
          label: durationLabel(length),
          hint:
            start === null
              ? undefined
              : translate('schedEndsAt', { time: clock((start + length) % 1440) }),
        })),
        { value: 'custom', label: translate('schedDurationCustom') },
      ]}
      onChange={(choice) => {
        if (choice !== 'custom') return set({ duration: choice })
        setCustom(true)
        focusSoon(fieldId('duration'))
      }}
      placeholder={translate('schedDuration')}
      invalid={Boolean(errors.duration)}
      disabled={locked}
    />
  )
}

/** "45 min", "1 h", "1.5 h", "1 h 10 min". */
const durationLabel = (minutes: number) =>
  minutes < 60
    ? translate('schedMinutes', { count: minutes })
    : minutes % 30 === 0
      ? translate('schedHoursShort', { count: minutes / 60 })
      : `${translate('schedHoursShort', { count: Math.floor(minutes / 60) })} ${translate('schedMinutes', { count: minutes % 60 })}`

const ordinalLabel = (pos: 1 | 2 | 3 | 4 | -1) =>
  translate(
    pos === -1
      ? 'schedOrdinalLast'
      : pos === 1
        ? 'schedOrdinal1'
        : pos === 2
          ? 'schedOrdinal2'
          : pos === 3
            ? 'schedOrdinal3'
            : 'schedOrdinal4',
  )

/** One menu of the common rules for the start date (as a calendar offers them); Custom… opens the whole rule. */
function RepeatFields({ values, errors, set, describe }: Part) {
  const [custom, setCustom] = useState(presetOf(values) === 'custom')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(values.date) ? values.date : '2026-01-01'
  const day = weekdayName(weekdayOfDate(date), 'long')
  const rule = recurrenceOf(values)
  const presets: { value: RepeatPreset; label: string }[] = [
    { value: 'none', label: translate('schedRepeatNever') },
    { value: 'weekly', label: translate('schedRepeatWeeklyOn', { day }) },
    { value: 'biweekly', label: translate('schedRepeatBiweeklyOn', { day }) },
    {
      value: 'monthly',
      label: translate('schedRepeatMonthlyOn', { ordinal: ordinalLabel(setPosOf(date)), day }),
    },
    { value: 'custom', label: translate('schedRepeatCustom') },
  ]
  const preset = custom && values.repeat !== 'none' ? 'custom' : presetOf(values)
  return (
    <div className="grid gap-2">
      <div>
        <Combobox
          id={fieldId('repeat')}
          label={translate('schedRepeat')}
          value={preset}
          options={presets}
          onChange={(choice) => {
            const next = presets.find((entry) => entry.value === choice)?.value
            if (!next) return
            setCustom(next === 'custom')
            set(presetValues(next, values))
          }}
          placeholder={translate('schedRepeat')}
        />
      </div>
      {values.repeat !== 'none' && (
        <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-muted-foreground">{translate('schedEvery')}</span>
            <Combobox
              id={fieldId('interval')}
              label={translate('schedEvery')}
              value={values.interval}
              options={Array.from({ length: 12 }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1),
              }))}
              onChange={(interval) => set({ interval })}
              placeholder="1"
              invalid={Boolean(errors.interval)}
              className="w-18"
            />
            <Combobox
              id={fieldId('repeat') + '-unit'}
              label={translate('schedRepeatUnit')}
              value={values.repeat}
              options={[
                {
                  value: 'weekly',
                  label: translate('schedUnitWeeks', { count: Number(values.interval) || 1 }),
                },
                {
                  value: 'monthly',
                  label: translate('schedUnitMonths', { count: Number(values.interval) || 1 }),
                },
              ]}
              onChange={(unit) => set({ repeat: unit === 'monthly' ? 'monthly' : 'weekly' })}
              placeholder={translate('schedRepeatUnit')}
              className="w-32"
            />
            {values.repeat === 'weekly' ? (
              <fieldset id={fieldId('by_day')} tabIndex={-1} className="outline-none">
                <legend className="sr-only">{translate('schedOnDays')}</legend>
                <DayToggles value={values.by_day} onChange={(by_day) => set({ by_day })} />
              </fieldset>
            ) : (
              <Combobox
                id={fieldId('monthly')}
                label={translate('schedOn')}
                value={values.monthly}
                options={[
                  {
                    value: 'day',
                    label: translate('schedOnDayN', { day: Number(date.slice(8, 10)) }),
                  },
                  {
                    value: 'weekday',
                    label: translate('schedOnNthWeekday', {
                      ordinal: ordinalLabel(setPosOf(date)),
                      day,
                    }),
                  },
                ]}
                onChange={(monthly) => set({ monthly: monthly === 'weekday' ? 'weekday' : 'day' })}
                placeholder={translate('schedOn')}
                className="w-auto"
              />
            )}
          </div>
          {(errors.interval || errors.by_day) && (
            <FieldError id={`${fieldId(errors.interval ? 'interval' : 'by_day')}-error`}>
              {errors.interval ?? errors.by_day}
            </FieldError>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-muted-foreground">{translate('schedEnds')}</span>
            <Segmented
              label={translate('schedEnds')}
              value={values.ends}
              options={[
                { value: 'never', label: translate('schedEndsNever') },
                { value: 'until', label: translate('schedEndsOn') },
                { value: 'count', label: translate('schedEndsAfter') },
              ]}
              onChange={(ends) => set({ ends })}
            />
            {values.ends === 'until' && (
              <input
                {...describe('until')}
                aria-label={translate('schedLastDate')}
                type="date"
                min={values.date}
                value={values.until}
                onChange={(event) => set({ until: event.target.value })}
                className={cn(inputClass, 'w-40')}
              />
            )}
            {values.ends === 'count' && (
              <span className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
                <input
                  {...describe('count')}
                  aria-label={translate('schedSessions')}
                  inputMode="numeric"
                  value={values.count}
                  onChange={(event) => set({ count: event.target.value })}
                  className={cn(inputClass, 'w-20')}
                />
                {translate('schedSessionsUnit')}
              </span>
            )}
          </div>
          {(errors.until || errors.count) && (
            <FieldError id={`${fieldId(errors.until ? 'until' : 'count')}-error`}>
              {errors.until ?? errors.count}
            </FieldError>
          )}
          <label className="flex w-fit items-center gap-2 text-body-sm">
            <Checkbox
              checked={values.skip_holidays}
              onCheckedChange={(checked) => set({ skip_holidays: checked === true })}
            />
            {translate('schedSkipHolidays')}
          </label>
        </div>
      )}
      {rule &&
        Object.keys(errors).every(
          (key) => !['interval', 'by_day', 'until', 'count', 'date'].includes(key),
        ) && (
          <p className="text-body-sm text-muted-foreground" aria-live="polite">
            {recurrenceSummary({ ...rule }, values.date)}
          </p>
        )}
    </div>
  )
}

function DayToggles({
  value,
  onChange,
}: {
  value: Weekday[]
  onChange: (days: Weekday[]) => void
}) {
  return (
    <div className={cn(segmentTrack, 'flex w-fit')}>
      {WEEKDAYS.map((day) => {
        const on = value.includes(day)
        const name = weekdayName(day, 'long')
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((entry) => entry !== day) : [...value, day])}
            className={cn(segmentItem, 'min-h-7 px-2')}
          >
            <span aria-hidden>{weekdayName(day, 'short').slice(0, 2)}</span>
            <span className="sr-only">{name}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The online meeting platforms, in the order offered. `calendar`: the platform makes its link in that calendar, so
 * the installation must offer it and the host must have connected it. A new platform is one more entry.
 */
const PLATFORMS: {
  value: MeetingProvider
  label: string
  calendar?: 'google' | 'microsoft'
  connectFirst?: string
}[] = [
  {
    value: 'google_meet',
    label: 'Google Meet',
    calendar: 'google',
    connectFirst: translate('schedConnectGoogleFirst'),
  },
  {
    value: 'teams',
    label: 'Microsoft Teams',
    calendar: 'microsoft',
    connectFirst: translate('schedConnectMicrosoftFirst'),
  },
  { value: 'manual', label: translate('schedManualLink') },
]

/**
 * Where: in person (an address) or online on a platform. A platform this installation has no keys for is left out
 * unless the session already uses it; one the host (me) has not connected says so and links to connect it.
 * Another host's connections are not known here: the API checks them (422 meeting_provider).
 */
function Where({ values, errors, set, describe, me }: Part & { me: string | undefined }) {
  const calendars = useCalendars()
  const offered = calendars.data?.providers ?? []
  const connected = new Set(
    (calendars.data?.data ?? [])
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.provider),
  )
  const unconnected = (calendar: 'google' | 'microsoft' | undefined) =>
    calendar !== undefined && values.host_id === me && !connected.has(calendar)
  const platforms = PLATFORMS.filter(
    (entry) =>
      !entry.calendar || offered.includes(entry.calendar) || values.provider === entry.value,
  )
  const chosen = PLATFORMS.find((entry) => entry.value === values.provider)
  const problem = errors.provider ?? (values.provider === 'manual' ? undefined : errors.meeting_url)
  return (
    <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
      <Segmented
        label={translate('schedWhere')}
        value={values.mode}
        options={[
          { value: 'live', label: translate('schedLive') },
          { value: 'online', label: translate('schedOnline') },
        ]}
        onChange={(mode) => set({ mode })}
      />
      {values.mode === 'live' ? (
        <Field id={fieldId('location')} label={translate('location')} error={errors.location}>
          <AddressInput
            {...describe('location')}
            value={values.location}
            onChange={(location) => set({ location })}
            placeholder={translate('schedLocationPlaceholder')}
            className={inputClass}
          />
        </Field>
      ) : (
        <Combobox
          id={fieldId('provider')}
          label={translate('schedMeetingPlatform')}
          value={values.provider}
          options={platforms.map((entry) => ({
            value: entry.value,
            label: entry.label,
            hint: unconnected(entry.calendar) ? translate('schedNotConnected') : undefined,
          }))}
          onChange={(provider) => {
            const next = PLATFORMS.find((entry) => entry.value === provider)
            if (next) set({ provider: next.value })
          }}
          placeholder={translate('schedMeetingPlatform')}
          invalid={Boolean(errors.provider)}
        />
      )}
      {values.mode === 'online' && (
        <div className="sm:col-span-2">
          {values.provider === 'manual' ? (
            <Field
              id={fieldId('meeting_url')}
              label={translate('schedMeetingLink')}
              error={errors.meeting_url}
            >
              <input
                {...describe('meeting_url')}
                type="url"
                value={values.meeting_url}
                onChange={(event) => set({ meeting_url: event.target.value })}
                placeholder="https://"
                className={inputClass}
              />
            </Field>
          ) : (
            <p
              className={cn('text-body-sm', problem ? 'text-destructive' : 'text-muted-foreground')}
            >
              {problem ??
                (unconnected(chosen?.calendar) ? (
                  <>
                    {chosen?.connectFirst}{' '}
                    <a
                      href={CONNECT_CALENDAR}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link underline underline-offset-2 hover:no-underline"
                    >
                      {translate('schedConnect')}
                    </a>
                  </>
                ) : (
                  translate('schedLinkMadeOnSave')
                ))}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** What a conflict is, after its time: a session's title, or why the host is not free then. */
const conflictLabel = (conflict: Conflict) =>
  conflict.kind === 'event'
    ? (conflict.title ?? translate('schedAnotherSession'))
    : conflict.kind === 'busy'
      ? translate('schedBusyInCalendar')
      : conflict.kind === 'client'
        ? translate('schedClientElsewhere')
        : conflict.kind === 'holiday'
          ? translate('schedHoliday')
          : translate('schedOutsideHours')

/**
 * The slot's overlaps as a calm notice under the time, one line each. Overlaps with sessions or busy times offer
 * the start right after the last of them, when that is still the same day; holidays and hours are not moved past.
 */
function Overlaps({
  conflicts,
  values,
  zone,
  set,
}: {
  conflicts: Conflict[]
  values: Values
  zone: string
  set: (change: Partial<Values>) => void
}) {
  const last = conflicts
    .filter((conflict) => conflict.kind !== 'holiday' && conflict.kind !== 'outside_hours')
    .map((conflict) => conflict.ends_at)
    .toSorted()
    .at(-1)
  const after = last ? zoned(last, zone) : null
  const next = after?.date === values.date ? clock(after.minutes) : null
  return (
    <div aria-live="polite">
      {conflicts.length > 0 && (
        <Callout
          tone="warning"
          className="mt-2"
          title={translate('schedOverlaps', { count: conflicts.length })}
          actions={
            next && (
              <Button type="button" variant="outline" size="sm" onClick={() => set({ time: next })}>
                {translate('schedStartAt', { time: next })}
              </Button>
            )
          }
        >
          <ul className="grid gap-0.5">
            {conflicts.map((conflict) => (
              <li key={`${conflict.kind}-${conflict.starts_at}-${conflict.occurrence_id ?? ''}`}>
                <span className="text-muted-foreground tabular-nums">
                  {timeLabel(conflict.starts_at, zone)}–{timeLabel(conflict.ends_at, zone)}
                </span>{' '}
                {conflictLabel(conflict)}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  )
}
