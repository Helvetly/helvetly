'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Clock, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { SettingsSection } from '@/components/settings/layout'
import { timeZoneOptions } from '@/components/settings/workspace-settings'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import {
  daysText,
  useHostHours,
  useSaveHours,
  weekdayName,
  windowProblem,
  type HostHours,
  type Override,
  type Window,
} from '@/lib/scheduling-settings'

// A block has no id of its own; this one follows it through edits so typing never remounts its inputs.
import { WeekdayPicker } from './weekday-picker'

const windowIds = new WeakMap<object, number>()
let windowCount = 0
const windowKey = (window: object) => {
  const known = windowIds.get(window)
  if (known !== undefined) return known
  windowCount += 1
  windowIds.set(window, windowCount)
  return windowCount
}

const WEEKDAYS = [1, 2, 3, 4, 5]
const ALL_DAYS = [...WEEKDAYS, 6, 7]
const NEW_WINDOW = { start: '09:00', end: '17:00' }

const intro = () => ({
  id: 'availability',
  icon: Clock,
  title: translate('schedulingSettingsWeekly'),
  description: translate('schedulingSettingsHoursDescription'),
})

/** My weekly hours (when clients may book me), date overrides and zone. */
export function WeeklyHours({ userId }: { userId: string }) {
  const hours = useHostHours(userId)
  if (hours.data)
    return <HoursForm key={JSON.stringify(hours.data)} userId={userId} saved={hours.data} />
  return (
    <SettingsSection {...intro()}>
      {hours.error ? (
        <p className="text-body text-muted-foreground">{errorMessage(hours.error)}</p>
      ) : (
        <Loader className="min-h-24" />
      )}
    </SettingsSection>
  )
}

/** A date override: a day off, or other hours for that day. */
export function overrideProblem(overrides: readonly Override[]): string | null {
  const dates = new Set<string>()
  for (const one of overrides) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(one.date)) return translate('schedulingSettingsHolidayDate')
    if (dates.has(one.date)) return translate('schedulingSettingsOverrideTwice')
    dates.add(one.date)
    if ((one.start || one.end) && (!one.start || !one.end || one.start >= one.end))
      return translate('schedulingSettingsWindowOrder')
  }
  return null
}

const dateText = (date: string) =>
  new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )

function HoursForm({ userId, saved }: { userId: string; saved: HostHours }) {
  const save = useSaveHours(userId)
  const form = useSectionForm<HostHours, 'hours'>({
    initial: saved,
    sections: [{ id: 'hours', fields: ['time_zone', 'bookable', 'weekly', 'overrides'] }],
    validate: (values) => ({
      ...(windowProblem(values.weekly) ? { weekly: windowProblem(values.weekly) ?? '' } : {}),
      ...(overrideProblem(values.overrides)
        ? { overrides: overrideProblem(values.overrides) ?? '' }
        : {}),
    }),
    save: (values) => save.mutateAsync({ ...values, userId }),
    fieldErrors: apiFieldErrors,
    savedMessage: () => translate('schedulingSettingsHoursSaved'),
  })
  const workspaceZone = useSession().data?.workspace.timezone
  const v = form.values
  // No zone of my own follows the workspace's; it is shown until I pick one.
  const zone = v.time_zone ?? workspaceZone ?? 'UTC'
  const zones = useMemo(() => timeZoneOptions(zone), [zone])
  const [date, setDate] = useState('')
  const [bulkDays, setBulkDays] = useState(WEEKDAYS)
  const [bulkWindow, setBulkWindow] = useState(NEW_WINDOW)

  const addHours = (days: number[], window: typeof NEW_WINDOW) => {
    const weekly = [...v.weekly, ...days.map((day) => ({ day, ...window }))]
    const problem = windowProblem(weekly)
    if (problem) {
      toast.error(problem)
      return
    }
    form.set('weekly', weekly)
  }
  const setWindow = (target: Window, change: Partial<Window>) =>
    form.set(
      'weekly',
      v.weekly.map((one) => {
        if (one !== target) return one
        const next = { ...one, ...change }
        windowIds.set(next, windowKey(one))
        return next
      }),
    )
  const addOverride = () => {
    if (!date || v.overrides.some((one) => one.date === date)) return
    form.set(
      'overrides',
      [...v.overrides, { date, start: null, end: null }].toSorted((a, b) =>
        a.date.localeCompare(b.date),
      ),
    )
    setDate('')
  }
  const setOverride = (on: string, change: Partial<Override>) =>
    form.set(
      'overrides',
      v.overrides.map((one) => (one.date === on ? { ...one, ...change } : one)),
    )
  const section = form.section('hours')
  return (
    <SettingsSection {...intro()} section={section}>
      <form
        noValidate
        className="grid max-w-[var(--settings-form,44rem)] gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          section.save()
        }}
      >
        <FormField id="hours-zone" label={translate('schedulingSettingsMyZone')} width="md">
          <Combobox
            id="hours-zone"
            value={zone}
            options={zones}
            placeholder={translate('schedulingSettingsMyZone')}
            onChange={(picked) => form.set('time_zone', picked)}
          />
        </FormField>
        <SwitchRow
          label={translate('schedulingSettingsBookableMe')}
          description={translate('schedulingSettingsBookableMeDescription')}
          checked={v.bookable}
          onCheckedChange={(bookable) => form.set('bookable', bookable)}
        />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-medium">
            {translate('schedulingSettingsWeekly')}
          </legend>
          <div className="grid gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap gap-2">
              <WeekdayPicker
                label={translate('schedulingSettingsHoursDays')}
                value={bulkDays}
                onChange={setBulkDays}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setBulkDays(WEEKDAYS)}>
                {daysText(WEEKDAYS)}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setBulkDays(ALL_DAYS)}>
                {translate('schedulingSettingsEveryDay')}
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <FormField id="bulk-hours-start" label={translate('schedulingSettingsHoursStart')}>
                <Input
                  id="bulk-hours-start"
                  type="time"
                  className="w-32"
                  value={bulkWindow.start}
                  onChange={(event) => setBulkWindow({ ...bulkWindow, start: event.target.value })}
                />
              </FormField>
              <FormField id="bulk-hours-end" label={translate('schedulingSettingsHoursEnd')}>
                <Input
                  id="bulk-hours-end"
                  type="time"
                  className="w-32"
                  value={bulkWindow.end}
                  onChange={(event) => setBulkWindow({ ...bulkWindow, end: event.target.value })}
                />
              </FormField>
              <Button
                type="button"
                variant="outline"
                disabled={bulkDays.length === 0}
                onClick={() => addHours(bulkDays, bulkWindow)}
              >
                <Plus />
                {translate('schedulingSettingsAddHoursToDays')}
              </Button>
            </div>
          </div>
          <ul className="grid divide-y rounded-lg border">
            {ALL_DAYS.map((day) => {
              const windows = v.weekly.filter((one) => one.day === day)
              return (
                <li key={day} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5">
                  <span className="w-12 pt-1.5 text-body-sm font-medium">{weekdayName(day)}</span>
                  <div className="grid flex-1 gap-2">
                    {windows.length === 0 && (
                      <span className="pt-1.5 text-body-sm text-muted-foreground">
                        {translate('schedulingSettingsUnavailable')}
                      </span>
                    )}
                    {windows.map((window) => (
                      <div key={windowKey(window)} className="flex flex-wrap items-center gap-2">
                        <Input
                          type="time"
                          className="w-32"
                          aria-label={translate('schedulingSettingsFrom', {
                            day: weekdayName(day, 'long'),
                          })}
                          value={window.start}
                          onChange={(event) => setWindow(window, { start: event.target.value })}
                        />
                        <span aria-hidden>–</span>
                        <Input
                          type="time"
                          className="w-32"
                          aria-label={translate('schedulingSettingsTo', {
                            day: weekdayName(day, 'long'),
                          })}
                          value={window.end}
                          onChange={(event) => setWindow(window, { end: event.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground"
                          aria-label={translate('schedulingSettingsRemoveWindow', {
                            day: weekdayName(day, 'long'),
                          })}
                          onClick={() =>
                            form.set(
                              'weekly',
                              v.weekly.filter((one) => one !== window),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={translate('schedulingSettingsAddWindow', {
                      day: weekdayName(day, 'long'),
                    })}
                    onClick={() => form.set('weekly', [...v.weekly, { day, ...NEW_WINDOW }])}
                  >
                    <Plus />
                    {translate('schedulingSettingsAddHours')}
                  </Button>
                </li>
              )
            })}
          </ul>
          {form.errors.weekly && (
            <p role="alert" className="text-body-sm text-destructive">
              {form.errors.weekly}
            </p>
          )}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-medium">
            {translate('schedulingSettingsOverrides')}
          </legend>
          <p className="text-body-sm text-muted-foreground">
            {translate('schedulingSettingsOverridesHint')}
          </p>
          {v.overrides.length > 0 && (
            <ul className="grid divide-y rounded-lg border">
              {v.overrides.map((one) => {
                const off = !one.start && !one.end
                return (
                  <li
                    key={one.date}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                  >
                    <span className="min-w-28 text-body-sm font-medium">{dateText(one.date)}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-pressed={off}
                      onClick={() =>
                        setOverride(
                          one.date,
                          off
                            ? { start: NEW_WINDOW.start, end: NEW_WINDOW.end }
                            : { start: null, end: null },
                        )
                      }
                    >
                      {off
                        ? translate('schedulingSettingsDayOff')
                        : translate('schedulingSettingsOtherHours')}
                    </Button>
                    {!off && (
                      <>
                        <Input
                          type="time"
                          className="w-32"
                          aria-label={translate('schedulingSettingsFrom', {
                            day: dateText(one.date),
                          })}
                          value={one.start ?? ''}
                          onChange={(event) => setOverride(one.date, { start: event.target.value })}
                        />
                        <span aria-hidden>–</span>
                        <Input
                          type="time"
                          className="w-32"
                          aria-label={translate('schedulingSettingsTo', {
                            day: dateText(one.date),
                          })}
                          value={one.end ?? ''}
                          onChange={(event) => setOverride(one.date, { end: event.target.value })}
                        />
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto text-muted-foreground"
                      aria-label={translate('schedulingSettingsRemoveOverride', {
                        date: dateText(one.date),
                      })}
                      onClick={() =>
                        form.set(
                          'overrides',
                          v.overrides.filter((other) => other.date !== one.date),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="w-40"
              aria-label={translate('schedulingSettingsOverrideDate')}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!date}
              onClick={addOverride}
            >
              <Plus />
              {translate('schedulingSettingsAddOverride')}
            </Button>
          </div>
          {form.errors.overrides && (
            <p role="alert" className="text-body-sm text-destructive">
              {form.errors.overrides}
            </p>
          )}
        </fieldset>
      </form>
    </SettingsSection>
  )
}
