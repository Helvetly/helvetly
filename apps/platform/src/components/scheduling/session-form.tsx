'use client'
import { Button } from '@helvetly/ui/components/button'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlignLeft,
  Building2,
  ChevronsUpDown,
  Clock,
  LayoutTemplate,
  Link2,
  Mail,
  MapPin,
  Plus,
  Repeat,
  TriangleAlert,
  UserRound,
  Users,
  Video,
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
  dayLabel,
  recurrenceSummary,
  timeLabel,
  useCalendars,
  useConflicts,
  useEventTypes,
  WEEKDAYS,
  weekdayName,
  zoneName,
  type Conflict,
  type Weekday,
} from '@/lib/scheduling'

import { AddressInput } from './address-input'
import { Choices, TimeLock } from './bits'
import {
  asksDuration,
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

const DURATIONS = ['30', '45', '60', '90', '120']
const fieldId = (name: keyof Values) => `session-${name}`
/** The duration picks' box, focused when "Change" reveals them. */
const DURATION_CHOICES = 'session-duration-choices'
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
  /** The event type sets the length; "Change" asks for it anyway. */
  const [override, setOverride] = useState(false)
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

  const chosenType = types.find((entry) => entry.id === values.event_type_id)
  const durationAsked = asksDuration(values, chosenType, override)

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
          <Field id={fieldId('client')} label={translate('client')} error={errors.client}>
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
                setOverride(false)
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
          <Field id={fieldId('host_id')} error={errors.host_id} className="sm:max-w-[50%]">
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
        <When
          values={values}
          errors={errors}
          set={set}
          describe={describe}
          durationAsked={durationAsked && !timeLocked}
          locked={timeLocked}
        />
        <div className="mt-1.5 flex h-5 min-w-0 items-center gap-2 text-body-sm">
          <span
            className="flex shrink-0 items-center gap-1 text-muted-foreground"
            aria-live="polite"
          >
            {slot && (
              <span>
                {dayLabel(values.date)} · {timeLabel(slot.starts_at, zone)} –{' '}
                {timeLabel(slot.ends_at, zone)} ({zoneName(zone)})
              </span>
            )}
            {(!durationAsked || timeLocked) && (
              <>
                <span>
                  {slot && '· '}
                  {shortDuration(Number(values.duration))}
                </span>
              </>
            )}
            {!durationAsked && !timeLocked && (
              <>
                <button
                  type="button"
                  aria-label={translate('schedChangeDuration')}
                  onClick={() => {
                    setOverride(true)
                    focusSoon(DURATION_CHOICES)
                  }}
                  className="rounded-sm text-link underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {translate('change')}
                </button>
              </>
            )}
          </span>
          {/* On the summary's line, so a warning appearing never moves the fields below. */}
          <ConflictLine
            conflicts={slot && values.host_id ? (conflicts.data ?? []) : []}
            zone={zone}
          />
        </div>
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

/**
 * Date, start and duration on one row (wrapping on a phone); the duration as quick picks or minutes, left out while
 * the event type's length holds (the summary below names it).
 */
function When({
  values,
  errors,
  set,
  describe,
  durationAsked,
  locked,
}: Part & { durationAsked: boolean; locked: boolean }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-start gap-2">
        <label htmlFor={fieldId('date')} className="sr-only">
          {translate('date')}
        </label>
        <input
          {...describe('date')}
          type="date"
          value={values.date}
          readOnly={locked}
          onChange={(event) => set(dateChange(values, event.target.value))}
          className={cn(inputClass, 'w-auto', locked && 'text-muted-foreground')}
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
          className={cn(inputClass, 'w-auto', locked && 'text-muted-foreground')}
        />
        {locked && (
          <span className="flex h-9 items-center">
            <TimeLock />
          </span>
        )}
        {durationAsked && (
          <Duration values={values} errors={errors} set={set} describe={describe} />
        )}
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

/** The duration as quick picks or minutes; mounted when shown, so it starts from the length the form has then. */
function Duration({ values, set, describe }: Part) {
  const [custom, setCustom] = useState(!DURATIONS.includes(values.duration))
  return (
    <>
      <div id={DURATION_CHOICES} tabIndex={-1} className="outline-none">
        <Choices
          label={translate('schedDuration')}
          value={custom ? 'custom' : values.duration}
          options={[
            ...DURATIONS.map((minutes) => ({
              value: minutes,
              label: shortDuration(Number(minutes)),
            })),
            { value: 'custom', label: translate('schedDurationCustom') },
          ]}
          onChange={(choice) => {
            setCustom(choice === 'custom')
            if (choice === 'custom') focusSoon(fieldId('duration'))
            else set({ duration: choice })
          }}
        />
      </div>
      {custom && (
        <InputGroup className="w-24">
          <InputGroupInput
            {...describe('duration')}
            aria-label={translate('schedDurationMinutes')}
            inputMode="numeric"
            value={values.duration}
            onChange={(event) => set({ duration: event.target.value })}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{translate('schedMinutesUnit')}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      )}
    </>
  )
}

/** "1 h", "1.5 h", "45 min": short enough for a chip. */
const shortDuration = (minutes: number) =>
  minutes < 60
    ? translate('schedMinutes', { count: minutes })
    : translate('schedHoursShort', { count: minutes / 60 })

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
      <div className="sm:max-w-[50%]">
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

type Place = 'live' | 'google_meet' | 'teams' | 'manual'
const PROVIDER_OF = { google_meet: 'google', teams: 'microsoft' } as const

/**
 * Where, as tiles: in person, the meeting providers this installation offers, or one's own link. A provider
 * without keys here is left out; one the host (me) has not connected says so with a link to connect it.
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
  const place: Place = values.mode === 'live' ? 'live' : values.provider
  const tiles: { value: Place; icon: LucideIcon; label: string; connect?: string }[] = [
    { value: 'live', icon: MapPin, label: translate('schedLive') },
  ]
  for (const value of ['google_meet', 'teams'] as const) {
    const provider = PROVIDER_OF[value]
    // A session that already has it keeps its tile, whatever the installation offers now.
    if (!offered.includes(provider) && place !== value) continue
    tiles.push({
      value,
      icon: value === 'google_meet' ? Video : Users,
      label: value === 'google_meet' ? 'Google Meet' : 'Microsoft Teams',
      connect:
        values.host_id === me && !connected.has(provider) && place !== value
          ? translate(
              provider === 'google' ? 'schedConnectGoogleFirst' : 'schedConnectMicrosoftFirst',
            )
          : undefined,
    })
  }
  tiles.push({ value: 'manual', icon: Link2, label: translate('schedManualLink') })
  const choose = (value: Place) =>
    set(value === 'live' ? { mode: 'live' } : { mode: 'online', provider: value })
  const problem = errors.provider ?? (place === 'manual' ? undefined : errors.meeting_url)
  return (
    <div className="grid gap-2">
      <fieldset
        id={fieldId('provider')}
        tabIndex={-1}
        className="grid grid-cols-2 gap-2 outline-none sm:grid-cols-4"
      >
        <legend className="sr-only">{translate('schedWhere')}</legend>
        {tiles.map((tile) =>
          tile.connect ? (
            <div
              key={tile.value}
              className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground"
            >
              <tile.icon aria-hidden className="size-4 shrink-0" />
              <span className="grid min-w-0 leading-tight">
                <span className="truncate">{tile.label}</span>
                <a
                  href={CONNECT_CALENDAR}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={tile.connect}
                  className="w-fit text-xs text-link underline underline-offset-2 hover:no-underline"
                >
                  {translate('schedConnect')}
                </a>
              </span>
            </div>
          ) : (
            <button
              key={tile.value}
              type="button"
              aria-pressed={place === tile.value}
              onClick={() => choose(tile.value)}
              className={cn(
                'flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50',
                place === tile.value
                  ? 'border-primary/60 bg-primary/5 font-medium text-foreground hover:bg-primary/5'
                  : 'text-muted-foreground',
              )}
            >
              <tile.icon aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{tile.label}</span>
            </button>
          ),
        )}
      </fieldset>
      {place === 'live' ? (
        <Field id={fieldId('location')} label={translate('location')} error={errors.location}>
          <AddressInput
            {...describe('location')}
            value={values.location}
            onChange={(location) => set({ location })}
            placeholder={translate('schedLocationPlaceholder')}
            className={inputClass}
          />
        </Field>
      ) : place === 'manual' ? (
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
        <p className={cn('text-body-sm', problem ? 'text-destructive' : 'text-muted-foreground')}>
          {problem ?? translate('schedLinkMadeOnSave')}
        </p>
      )}
    </div>
  )
}

/** Overlaps with the host's other sessions or busy times, in one line; the full list in its tooltip. */
function ConflictLine({ conflicts, zone }: { conflicts: Conflict[]; zone: string }) {
  const describe = (conflict: Conflict) =>
    `${timeLabel(conflict.starts_at, zone)}–${timeLabel(conflict.ends_at, zone)} ${
      conflict.kind === 'event'
        ? (conflict.title ?? translate('schedAnotherSession'))
        : conflict.kind === 'busy'
          ? translate('schedBusyInCalendar')
          : conflict.kind === 'holiday'
            ? translate('schedHoliday')
            : translate('schedOutsideHours')
    }`
  const first = conflicts[0]
  return (
    <span className="flex min-w-0 items-center" aria-live="polite">
      {first && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 rounded-sm text-body-sm text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="truncate">
                {translate('schedConflicts', { count: conflicts.length })}: {describe(first)}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <ul className="grid gap-0.5">
              {conflicts.map((conflict) => (
                <li key={`${conflict.kind}-${conflict.starts_at}-${conflict.occurrence_id ?? ''}`}>
                  {describe(conflict)}
                </li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}
