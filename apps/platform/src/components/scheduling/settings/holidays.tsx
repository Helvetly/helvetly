'use client'
import { languageTag } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { Input } from '@helvetly/ui/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { CalendarOff, Plus, Trash2, Wand2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { SettingsSection } from '@/components/settings/layout'
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
  new Intl.DateTimeFormat(languageTag, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))

/** The days of each year, in the order given (already by date). */
const byYear = (days: Holiday[]) => Map.groupBy(days, (day) => day.date.slice(0, 4))

/** Stable, so it focuses once when the field appears. */
const focusOnMount = (input: HTMLInputElement | null) => input?.focus()

const today = () => new Date().toLocaleDateString('sv')

/** Days the business is closed: no sessions are made on them and cut-offs skip them. Owners and admins edit. */
export function HolidaysSection({ canEdit }: { canEdit: boolean }) {
  const holidays = useHolidays()
  // Dates that came from a suggestion: kept across the form's restart after a save, not stored.
  const [suggested, setSuggested] = useState<ReadonlySet<string>>(() => new Set())
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
    <HolidaysForm
      key={JSON.stringify(holidays.data)}
      saved={holidays.data}
      canEdit={canEdit}
      suggested={suggested}
      onSuggested={setSuggested}
    />
  )
}

function HolidaysForm({
  saved,
  canEdit,
  suggested,
  onSuggested,
}: {
  saved: Holiday[]
  canEdit: boolean
  suggested: ReadonlySet<string>
  onSuggested: (dates: ReadonlySet<string>) => void
}) {
  const save = useSaveHolidays()
  const [nextYear] = useState(() => new Date().getFullYear() + 1)
  const [now] = useState(today)
  const [canton, setCanton] = useState('')
  const [adding, setAdding] = useState(false)
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
  const close = () => {
    setAdding(false)
    setDate('')
    setName('')
    setProblem('')
  }
  const add = () => {
    if (!DATE.test(date) || Number.isNaN(Date.parse(date)))
      return setProblem(translate('schedulingSettingsHolidayDate'))
    if (!name.trim()) return setProblem(translate('schedulingSettingsHolidayName'))
    form.set('days', mergeHolidays(days, [{ date, name: name.trim() }]))
    onSuggested(new Set([...suggested].filter((one) => one !== date)))
    close()
  }
  // Enter adds, Escape cancels (and stays here: it must not discard the section's changes).
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') add()
    else close()
  }
  const suggest = async () => {
    setSuggesting(true)
    try {
      const found = await schedulingApi.suggestHolidays(nextYear, canton)
      form.set('days', mergeHolidays(days, found))
      onSuggested(new Set([...suggested, ...found.map((day) => day.date)]))
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
      {/* The wrapper takes the settings rows' first-child rules, so the card keeps its whole border. */}
      <div>
        <div
          data-slot="holidays-card"
          className="max-w-[var(--settings-form,44rem)] overflow-hidden rounded-lg border"
        >
          {canEdit && (
            <div className="flex flex-col gap-2 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full sm:w-60">
                <Combobox
                  value={canton}
                  label={translate('schedulingSettingsPublicHolidays')}
                  placeholder={translate('schedulingSettingsFederalOnly')}
                  onChange={setCanton}
                  onClear={() => setCanton('')}
                  clearLabel={translate('schedulingSettingsFederalOnly')}
                  options={CANTONS.map((code) => ({ value: code, label: code }))}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="self-start text-muted-foreground sm:self-auto"
                disabled={suggesting}
                onClick={() => void suggest()}
              >
                <Wand2 />
                {translate('schedulingSettingsSuggestHolidays', { year: nextYear })}
              </Button>
            </div>
          )}
          {days.length === 0 ? (
            <p className="px-3 py-4 text-body-sm text-muted-foreground">
              {translate('schedulingSettingsNoHolidays')}
            </p>
          ) : (
            [...byYear(days)].map(([year, ofYear]) => (
              <section key={year} aria-label={year} className="[&+section]:border-t">
                <h3 className="border-b bg-muted/40 px-3 py-1 text-caption font-medium text-muted-foreground tabular-nums">
                  {year}
                </h3>
                <ul className="divide-y">
                  {ofYear.map((day) => (
                    <li
                      key={day.date}
                      data-past={day.date < now || undefined}
                      className="group/day flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-body-sm data-past:text-muted-foreground"
                    >
                      <span className="w-28 shrink-0 tabular-nums">{dateText(day.date)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium group-data-past/day:font-normal">
                        {day.name}
                      </span>
                      {suggested.has(day.date) && (
                        <Badge size="sm">{translate('schedulingSettingsPublicHoliday')}</Badge>
                      )}
                      {canEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="-mr-1.5 text-muted-foreground"
                              aria-label={translate('schedulingSettingsRemoveHoliday', {
                                name: day.name,
                              })}
                              onClick={() =>
                                form.set(
                                  'days',
                                  days.filter((one) => one.date !== day.date),
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {translate('schedulingSettingsRemoveHoliday', { name: day.name })}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {canEdit && (
            <div className="border-t px-3 py-2">
              {adding ? (
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      ref={focusOnMount}
                      onKeyDown={keys}
                      aria-label={translate('schedulingSettingsHolidayDateLabel')}
                      className="w-full sm:w-40"
                      value={date}
                      onChange={(event) => {
                        setDate(event.target.value)
                        setProblem('')
                      }}
                    />
                    <Input
                      aria-label={translate('schedulingSettingsHolidayNameLabel')}
                      className="min-w-40 flex-1"
                      maxLength={100}
                      onKeyDown={keys}
                      placeholder={translate('schedulingSettingsHolidayNamePlaceholder')}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value)
                        setProblem('')
                      }}
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="lg" onClick={add}>
                        {translate('schedulingSettingsAddHolidayConfirm')}
                      </Button>
                      <Button type="button" size="lg" variant="ghost" onClick={close}>
                        {translate('cancel')}
                      </Button>
                    </div>
                  </div>
                  {problem && (
                    <p role="alert" className="text-body-sm text-destructive">
                      {problem}
                    </p>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-1.5"
                  onClick={() => setAdding(true)}
                >
                  <Plus />
                  {translate('schedulingSettingsAddHoliday')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}
