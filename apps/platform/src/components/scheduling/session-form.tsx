'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Combobox } from '@helvetly/ui/components/combobox'
import { FormField } from '@helvetly/ui/components/form-field'
import { inputClass } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown, Mail, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { ClientSearch } from '@/components/invoices/client-search'
import { TextareaBox } from '@/components/textarea-box'
import { useClientEngagements } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { useMembers } from '@/lib/members'
import { useSession } from '@/lib/queries'
import {
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

import { Choices } from './bits'
import {
  recurrenceOf,
  setPosOf,
  slotOf,
  weekdayOfDate,
  type Errors,
  type Values,
} from './session-model'

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 180, 240]
const fieldId = (name: keyof Values) => `session-${name}`

/** The session's fields; `excludeId` keeps the session itself out of its conflicts. */
export function SessionFields({
  values,
  errors,
  zone,
  excludeId,
  editing,
  set,
}: {
  values: Values
  errors: Errors
  zone: string
  excludeId?: string
  /** Changing an existing session: the client stays. */
  editing: boolean
  set: (change: Partial<Values>) => void
}) {
  const me = useSession().data?.user.id
  const members = useMembers()
  const engagements = useClientEngagements(values.client?.id ?? '')
  const eventTypes = useEventTypes()
  const calendars = useCalendars()
  const slot = slotOf(values, zone)
  const conflicts = useConflicts(
    slot && values.host_id ? { host_id: values.host_id, ...slot, exclude: excludeId } : null,
  )
  const [clientOpen, setClientOpen] = useState(false)

  const describe = (name: keyof Values) => ({
    id: fieldId(name),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${fieldId(name)}-error` : undefined,
  })
  const running = (engagements.data ?? []).filter(
    (entry) => entry.status === 'active' || entry.status === 'scheduled',
  )
  const types = (eventTypes.data ?? []).filter((entry) => !entry.archived_at)
  const hosts =
    members.data?.map((member) => ({
      value: member.user_id,
      label: member.name || member.email,
    })) ?? []
  const connected = new Set(
    (calendars.data?.data ?? [])
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.provider),
  )
  // Only the host's own connections are known here; for another host the API checks (422 meeting_provider).
  const reason = (provider: 'google' | 'microsoft') =>
    values.host_id !== me
      ? undefined
      : !calendars.data?.providers.includes(provider)
        ? translate('schedProviderNotSetUp')
        : connected.has(provider)
          ? undefined
          : provider === 'google'
            ? translate('schedConnectGoogleFirst')
            : translate('schedConnectMicrosoftFirst')
  const rule = recurrenceOf(values)
  const durations = DURATIONS.includes(Number(values.duration))
    ? DURATIONS
    : [...DURATIONS, Number(values.duration)].filter(Number.isFinite).toSorted((a, b) => a - b)

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={fieldId('client')}
          label={translate('client')}
          error={errors.client}
          required
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
                  set({ client: { id: client.id, name: client.name }, engagement_id: '' })
                }}
              />
            </PopoverContent>
          </Popover>
        </FormField>
        <FormField
          id={fieldId('engagement_id')}
          label={translate('schedEngagement')}
          error={errors.engagement_id}
          tip={translate('schedEngagementTip')}
        >
          <Combobox
            id={fieldId('engagement_id')}
            value={values.engagement_id}
            options={running.map((entry) => ({
              value: entry.id,
              label: `#${entry.number} ${entry.title}`,
              hint: entry.current_period
                ? translate('schedRemaining', { count: Number(entry.current_period.remaining) })
                : undefined,
            }))}
            onChange={(engagement_id) => set({ engagement_id })}
            onClear={() => set({ engagement_id: '' })}
            clearLabel={translate('schedClearEngagement')}
            placeholder={
              running.length
                ? translate('schedNoEngagement')
                : translate('schedNoRunningEngagement')
            }
            disabled={running.length === 0}
          />
        </FormField>
        <FormField
          id={fieldId('event_type_id')}
          label={translate('schedEventType')}
          error={errors.event_type_id}
        >
          <Combobox
            id={fieldId('event_type_id')}
            value={values.event_type_id}
            options={types.map((entry) => ({ value: entry.id, label: entry.name }))}
            onChange={(id) => {
              const type = types.find((entry) => entry.id === id)
              if (!type) return
              set({
                event_type_id: id,
                duration: String(type.duration_minutes),
                mode: type.mode,
                provider: type.meeting_provider ?? values.provider,
                location: type.location ?? values.location,
                title: values.title || type.name,
              })
            }}
            onClear={() => set({ event_type_id: '' })}
            clearLabel={translate('schedClearEventType')}
            placeholder={
              types.length ? translate('schedNoEventType') : translate('schedNoEventTypes')
            }
            disabled={types.length === 0}
          />
        </FormField>
        <FormField
          id={fieldId('host_id')}
          label={translate('schedHost')}
          error={errors.host_id}
          required
        >
          <Combobox
            id={fieldId('host_id')}
            value={values.host_id}
            options={hosts}
            onChange={(host_id) => set({ host_id })}
            placeholder={translate('schedChooseHost')}
            disabled={hosts.length === 0}
          />
        </FormField>
      </div>

      <FormField id={fieldId('title')} label={translate('title')} error={errors.title} required>
        <input
          {...describe('title')}
          value={values.title}
          maxLength={200}
          onChange={(event) => set({ title: event.target.value })}
          placeholder={translate('schedTitlePlaceholder')}
          className={inputClass}
        />
      </FormField>

      <div className="grid gap-1.5">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_9rem]">
          <FormField id={fieldId('date')} label={translate('date')} error={errors.date} required>
            <input
              {...describe('date')}
              type="date"
              value={values.date}
              onChange={(event) => set({ date: event.target.value })}
              className={inputClass}
            />
          </FormField>
          <FormField
            id={fieldId('time')}
            label={translate('schedStart')}
            error={errors.time}
            required
            tip={translate('schedTimeIn', { zone: zoneName(zone) })}
          >
            <input
              {...describe('time')}
              type="time"
              step={300}
              value={values.time}
              onChange={(event) => set({ time: event.target.value })}
              className={inputClass}
            />
          </FormField>
          <FormField
            id={fieldId('duration')}
            label={translate('schedDuration')}
            error={errors.duration}
            required
          >
            <Combobox
              id={fieldId('duration')}
              value={values.duration}
              options={durations.map((minutes) => ({
                value: String(minutes),
                label: durationLabel(minutes),
              }))}
              onChange={(duration) => set({ duration })}
              placeholder={translate('schedDuration')}
              invalid={Boolean(errors.duration)}
            />
          </FormField>
        </div>
        {/* One line kept for the conflicts, so a warning appearing never moves the fields below. */}
        <ConflictLine
          conflicts={slot && values.host_id ? (conflicts.data ?? []) : []}
          zone={zone}
        />
      </div>

      <div className="grid gap-3">
        <span className="text-body-sm font-medium">{translate('schedRepeat')}</span>
        <Segmented
          label={translate('schedRepeat')}
          value={values.repeat}
          options={[
            { value: 'none', label: translate('schedRepeatNone') },
            { value: 'weekly', label: translate('schedRepeatWeekly') },
            { value: 'monthly', label: translate('schedRepeatMonthly') },
          ]}
          onChange={(repeat) => set({ repeat })}
        />
        {values.repeat !== 'none' && (
          <div className="grid gap-4 rounded-lg bg-muted/50 p-3">
            <div className="flex flex-wrap items-end gap-4">
              <FormField
                id={fieldId('interval')}
                label={translate('schedEvery')}
                error={errors.interval}
                width="sm"
              >
                <Combobox
                  id={fieldId('interval')}
                  value={values.interval}
                  options={Array.from({ length: 12 }, (_, i) => ({
                    value: String(i + 1),
                    label:
                      values.repeat === 'weekly'
                        ? translate('schedWeeks', { count: i + 1 })
                        : translate('schedMonths', { count: i + 1 }),
                  }))}
                  onChange={(interval) => set({ interval })}
                  placeholder={translate('schedEvery')}
                />
              </FormField>
              {values.repeat === 'weekly' ? (
                <FormField
                  id={fieldId('by_day')}
                  label={translate('schedOnDays')}
                  error={errors.by_day}
                  group
                >
                  <DayToggles value={values.by_day} onChange={(by_day) => set({ by_day })} />
                </FormField>
              ) : (
                <FormField id={fieldId('monthly')} label={translate('schedOn')} group>
                  <Segmented
                    label={translate('schedOn')}
                    value={values.monthly}
                    options={[
                      {
                        value: 'day',
                        label: translate('schedOnDayN', {
                          day: Number(values.date.slice(8, 10)) || 1,
                        }),
                      },
                      {
                        value: 'weekday',
                        label: translate('schedOnNthWeekday', {
                          ordinal: ordinalLabel(setPosOf(values.date || '2026-01-01')),
                          day: weekdayName(weekdayOfDate(values.date || '2026-01-01'), 'long'),
                        }),
                      },
                    ]}
                    onChange={(monthly) => set({ monthly })}
                  />
                </FormField>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <FormField id={fieldId('ends')} label={translate('schedEnds')} group>
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
              </FormField>
              {values.ends === 'until' && (
                <FormField
                  id={fieldId('until')}
                  label={translate('schedLastDate')}
                  error={errors.until}
                  width="sm"
                >
                  <input
                    {...describe('until')}
                    type="date"
                    min={values.date}
                    value={values.until}
                    onChange={(event) => set({ until: event.target.value })}
                    className={inputClass}
                  />
                </FormField>
              )}
              {values.ends === 'count' && (
                <FormField
                  id={fieldId('count')}
                  label={translate('schedSessions')}
                  error={errors.count}
                  width="xs"
                >
                  <input
                    {...describe('count')}
                    inputMode="numeric"
                    value={values.count}
                    onChange={(event) => set({ count: event.target.value })}
                    className={inputClass}
                  />
                </FormField>
              )}
            </div>
            <label className="flex items-center gap-2 text-body-sm">
              <Checkbox
                checked={values.skip_holidays}
                onCheckedChange={(checked) => set({ skip_holidays: checked === true })}
              />
              {translate('schedSkipHolidays')}
            </label>
            {rule &&
              Object.keys(errors).every(
                (key) => !['interval', 'by_day', 'until', 'count', 'date'].includes(key),
              ) && (
                <p className="text-body-sm text-muted-foreground" aria-live="polite">
                  {recurrenceSummary({ ...rule }, values.date)}
                </p>
              )}
          </div>
        )}
      </div>

      <div className="grid gap-3">
        <span className="text-body-sm font-medium">{translate('schedWhere')}</span>
        <Segmented
          label={translate('schedWhere')}
          value={values.mode}
          options={[
            { value: 'live', label: translate('schedLive') },
            { value: 'online', label: translate('schedOnline') },
          ]}
          onChange={(mode) => set({ mode })}
        />
        {values.mode === 'online' ? (
          <div className="grid gap-3">
            <Choices
              label={translate('schedMeetingLink')}
              value={values.provider}
              onChange={(provider) => set({ provider })}
              options={[
                { value: 'manual', label: translate('schedManualLink') },
                { value: 'google_meet', label: 'Google Meet', disabledReason: reason('google') },
                { value: 'teams', label: 'Microsoft Teams', disabledReason: reason('microsoft') },
              ]}
            />
            {values.provider === 'manual' ? (
              <FormField
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
              </FormField>
            ) : (
              <p
                className={cn(
                  'text-body-sm',
                  errors.meeting_url ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {errors.meeting_url ?? translate('schedLinkMadeOnSave')}
              </p>
            )}
          </div>
        ) : (
          <FormField id={fieldId('location')} label={translate('location')} error={errors.location}>
            <input
              {...describe('location')}
              value={values.location}
              onChange={(event) => set({ location: event.target.value })}
              placeholder={translate('schedLocationPlaceholder')}
              className={inputClass}
            />
          </FormField>
        )}
      </div>

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
      <SwitchRow
        icon={Mail}
        label={translate('schedEmailClient')}
        description={translate('schedEmailClientText')}
        checked={values.notify}
        onCheckedChange={(notify) => set({ notify })}
      />
    </div>
  )
}

export const durationLabel = (minutes: number) =>
  minutes < 60 || minutes % 60 !== 0
    ? minutes > 60
      ? translate('schedHoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
      : translate('schedMinutes', { count: minutes })
    : translate('schedHours', { count: minutes / 60 })

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
    <div className="flex h-5 items-center" aria-live="polite">
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
    </div>
  )
}
