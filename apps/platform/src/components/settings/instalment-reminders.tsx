import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { cn } from '@helvetly/ui/lib/utils'
import { Mail, X } from 'lucide-react'
import Link from 'next/link'
import { useState, type ComponentProps } from 'react'

import { translate } from '@/lib/i18n'

/** The days in "3, 10": whole, distinct, ascending; half-typed parts are left out. */
export function reminderDays(typed: string): number[] {
  const days = typed
    .split(/[\s,;]+/)
    .map(Number)
    .filter((day) => Number.isInteger(day) && day > 0)
  return [...new Set(days)].toSorted((a, b) => a - b)
}

/** The block's heading: what these settings are (emails) and where they are switched on or off. */
export function InstalmentRemindersHeading() {
  return (
    <div data-slot="instalment-reminders-heading" className="flex items-start gap-3 pt-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Mail aria-hidden className="size-4" />
      </span>
      <div className="grid gap-0.5">
        <h3 className="text-sm font-medium text-foreground">
          {translate('instalmentReminderEmails')}
        </h3>
        <p className="text-body-sm text-muted-foreground">
          {translate('instalmentReminderEmailsLead')} {translate('clientEmailsSwitchesLiveThere')}{' '}
          <Link href="/settings/emails" className="text-foreground underline underline-offset-4">
            {translate('clientEmails')}
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

const MAX_DAYS = 3

/**
 * Up to three days after the due date as chips in one field: type a day and press Enter (or a comma) to add it,
 * × or Backspace removes one. The value stays the typed list ("3, 10") the form validates and saves.
 */
export function ReminderDaysInput({
  value,
  onChange,
  className,
  ...input
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState('')
  const days = reminderDays(value)
  const commit = () => {
    const day = Number(draft)
    if (draft === '' || days.length >= MAX_DAYS) return
    setDraft('')
    if (day >= 1 && day <= 90) onChange([...days, day].toSorted((a, b) => a - b).join(', '))
  }
  const remove = (day: number) => onChange(days.filter((entry) => entry !== day).join(', '))
  return (
    <div
      data-slot="reminder-days-input"
      data-field-surface
      className={cn(fieldSurface, 'flex h-9 w-full min-w-0 items-center gap-1.5 px-1.5', className)}
    >
      {days.map((day) => (
        <span
          key={day}
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-body-sm tabular-nums dark:bg-muted-foreground/15"
        >
          {day}
          <button
            type="button"
            aria-label={translate('removeTheReminderDaysAfter', { days: day })}
            onClick={() => remove(day)}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <input
        {...input}
        inputMode="numeric"
        value={draft}
        disabled={input.disabled || days.length >= MAX_DAYS}
        placeholder={days.length === 0 ? translate('egThreeDays') : translate('addADay')}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 2))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Backspace' && draft === '' && days.length > 0) {
            remove(days[days.length - 1] ?? 0)
          }
        }}
        onBlur={commit}
        className="h-full w-full min-w-12 flex-1 bg-transparent px-1.5 text-body tabular-nums outline-none placeholder:text-placeholder disabled:hidden"
      />
      <span className="shrink-0 pr-1.5 text-body-sm whitespace-nowrap text-muted-foreground">
        {translate('daysAfter')}
      </span>
    </div>
  )
}

/** The schedule around one due date: a dot per reminder, the due date in the middle. */
export function ReminderTimeline({
  before,
  after,
  summary,
}: {
  before: number
  after: number[]
  summary: string
}) {
  const points = [
    ...(before > 0
      ? [{ key: 'before', label: translate('daysBeforeCount', { days: before }) }]
      : []),
    { key: 'due', label: translate('dueDate'), due: true },
    ...after.map((day) => ({
      key: `after-${day}`,
      label: translate('daysAfterCount', { days: day }),
    })),
  ]
  return (
    <output
      aria-label={translate('reminderSchedule')}
      data-slot="settings-preview"
      className="block rounded-lg bg-muted/60 px-3 pt-3 pb-2.5"
    >
      <span className="sr-only">{summary}</span>
      <ol aria-hidden className="grid auto-cols-fr grid-flow-col">
        {points.map((point, index) => (
          <li key={point.key} className="relative grid justify-items-center gap-1.5 text-center">
            {index > 0 && (
              <span className="absolute top-[5px] right-1/2 left-[-50%] h-px bg-border" />
            )}
            <span
              className={cn(
                'relative size-[11px] rounded-full border-2',
                point.due
                  ? 'border-foreground bg-foreground'
                  : 'border-primary/60 bg-card dark:bg-background',
              )}
            />
            <span
              className={cn(
                'px-1 text-xs leading-tight',
                point.due ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {point.label}
            </span>
          </li>
        ))}
      </ol>
      {points.length === 1 && (
        <p className="mt-2 text-center text-xs text-muted-foreground">{summary}</p>
      )}
    </output>
  )
}
