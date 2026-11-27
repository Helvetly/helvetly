'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Clock, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { SettingsSection } from '@/components/settings/layout'
import { TimeZoneSelect } from '@/components/settings/workspace-settings'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import {
  useHostHours,
  useSaveHours,
  windowProblem,
  type HostHours,
  type Override,
} from '@/lib/scheduling-settings'
import { defaultWeek } from '@/lib/weekly-schedule'

import { ClockSelect, WeeklySchedule } from './weekly-schedule'

const NEW_WINDOW = { start: '09:00', end: '17:00' } as const

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
    // Someone who never saved hours cannot be booked; they start from a usual week to save or change.
    draft: saved.saved === false ? { ...saved, weekly: defaultWeek() } : undefined,
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
  const [date, setDate] = useState('')
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
          <TimeZoneSelect
            id="hours-zone"
            value={zone}
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
          <WeeklySchedule value={v.weekly} onChange={(weekly) => form.set('weekly', weekly)} />
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
                        <ClockSelect
                          label={translate('schedulingSettingsFrom', { day: dateText(one.date) })}
                          value={one.start ?? NEW_WINDOW.start}
                          invalid={!!one.start && !!one.end && one.start >= one.end}
                          onChange={(start) => setOverride(one.date, { start })}
                        />
                        <span aria-hidden className="text-muted-foreground">
                          –
                        </span>
                        <ClockSelect
                          label={translate('schedulingSettingsTo', { day: dateText(one.date) })}
                          value={one.end ?? NEW_WINDOW.end}
                          invalid={!!one.start && !!one.end && one.start >= one.end}
                          onChange={(end) => setOverride(one.date, { end })}
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
