'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { Input } from '@helvetly/ui/components/input'
import { CalendarOff, Plus, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { SettingsEmpty, SettingsRow, SettingsSection } from '@/components/settings/layout'
import { translate } from '@/lib/i18n'
import {
  CANTONS,
  schedulingApi,
  useHolidays,
  useSaveHolidays,
  type Holiday,
} from '@/lib/scheduling-settings'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** `extra` added to `days`: one per date (the later name wins), by date. */
export function mergeHolidays(days: Holiday[], extra: Holiday[]): Holiday[] {
  const byDate = new Map([...days, ...extra].map((day) => [day.date, day]))
  return [...byDate.values()].toSorted((a, b) => a.date.localeCompare(b.date))
}

const dateText = (date: string) =>
  new Intl.DateTimeFormat(languageTag, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )

/** Days the business is closed: no sessions are made on them and cut-offs skip them. Owners and admins edit. */
export function HolidaysSection({ canEdit }: { canEdit: boolean }) {
  const holidays = useHolidays()
  if (holidays.error && !holidays.data)
    return (
      <SettingsSection
        id="scheduling-holidays"
        icon={CalendarOff}
        title={translate('schedulingSettingsHolidays')}
      >
        <p className="text-body text-muted-foreground">
          {translate('schedulingSettingsLoadFailed')}
        </p>
      </SettingsSection>
    )
  if (!holidays.data) return null
  // Keyed by the saved list: a save starts the form again from it.
  return (
    <HolidaysForm key={JSON.stringify(holidays.data)} saved={holidays.data} canEdit={canEdit} />
  )
}

function HolidaysForm({ saved, canEdit }: { saved: Holiday[]; canEdit: boolean }) {
  const save = useSaveHolidays()
  const [nextYear] = useState(() => new Date().getFullYear() + 1)
  const [canton, setCanton] = useState('')
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [problem, setProblem] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const form = useSectionForm({
    initial: { days: saved },
    sections: [{ id: 'holidays', fields: ['days'] }],
    save: ({ days }) => save.mutateAsync(days),
    fieldErrors: apiFieldErrors,
    savedMessage: () => translate('schedulingSettingsHolidaysSaved'),
  })
  const days = form.values.days
  const add = () => {
    if (!DATE.test(date) || Number.isNaN(Date.parse(date)))
      return setProblem(translate('schedulingSettingsHolidayDate'))
    if (!name.trim()) return setProblem(translate('schedulingSettingsHolidayName'))
    form.set('days', mergeHolidays(days, [{ date, name: name.trim() }]))
    setDate('')
    setName('')
    setProblem('')
  }
  const suggest = async () => {
    setSuggesting(true)
    try {
      form.set('days', mergeHolidays(days, await schedulingApi.suggestHolidays(nextYear, canton)))
    } catch (error) {
      toastError(error)
    } finally {
      setSuggesting(false)
    }
  }
  const section = canEdit ? form.section('holidays') : undefined
  return (
    <SettingsSection
      id="scheduling-holidays"
      icon={CalendarOff}
      title={translate('schedulingSettingsHolidays')}
      description={translate('schedulingSettingsHolidaysDescription')}
      section={section}
    >
      <div className="grid max-w-[var(--settings-form,44rem)] gap-4">
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Combobox
                value={canton}
                label={translate('schedulingSettingsCanton')}
                placeholder={translate('schedulingSettingsFederalOnly')}
                onChange={setCanton}
                onClear={() => setCanton('')}
                clearLabel={translate('schedulingSettingsFederalOnly')}
                options={CANTONS.map((code) => ({ value: code, label: code }))}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={suggesting}
              onClick={() => void suggest()}
            >
              <Wand2 />
              {translate('schedulingSettingsSuggestHolidays', {
                year: nextYear,
                canton: canton || 'CH',
              })}
            </Button>
          </div>
        )}
        {days.length === 0 ? (
          <SettingsEmpty icon={<CalendarOff />} title={translate('schedulingSettingsNoHolidays')}>
            {translate('schedulingSettingsNoHolidaysBody')}
          </SettingsEmpty>
        ) : (
          <ul className="grid divide-y">
            {days.map((day) => (
              <SettingsRow
                key={day.date}
                icon={<CalendarOff />}
                title={day.name}
                meta={dateText(day.date)}
              >
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={translate('schedulingSettingsRemoveHoliday', { name: day.name })}
                    onClick={() =>
                      form.set(
                        'days',
                        days.filter((one) => one.date !== day.date),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </SettingsRow>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                aria-label={translate('schedulingSettingsHolidayDateLabel')}
                className="w-40"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value)
                  setProblem('')
                }}
              />
              <Input
                aria-label={translate('schedulingSettingsHolidayNameLabel')}
                className="w-56"
                maxLength={100}
                placeholder={translate('schedulingSettingsHolidayNamePlaceholder')}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setProblem('')
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  add()
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={add}>
                <Plus />
                {translate('schedulingSettingsAddHoliday')}
              </Button>
            </div>
            {problem && (
              <p role="alert" className="text-body-sm text-destructive">
                {problem}
              </p>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
