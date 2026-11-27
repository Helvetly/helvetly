'use client'
import { languageTag } from '@helvetly/i18n'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Button } from '@helvetly/ui/components/button'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarDays, Copy, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { NativeSelect } from '@/components/clients/fields'
import { translate } from '@/lib/i18n'
import { weekdayName, type Window } from '@/lib/scheduling-settings'
import {
  clockOptions,
  copyDay,
  DEFAULT_RANGE,
  nextRange,
  rangeProblems,
  rangesOf,
  setRanges,
  WEEK,
  WORKDAYS,
  type Range,
  type RangeProblem,
} from '@/lib/weekly-schedule'

const clockLabel = (clock: string) =>
  new Intl.DateTimeFormat(languageTag, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`2024-01-01T${clock}:00Z`))

// A range has no id of its own; this one follows it through edits so a changed time never remounts its field.
const rangeIds = new WeakMap<Window, number>()
let rangeCount = 0
const rangeKey = (range: Window) => {
  const known = rangeIds.get(range)
  if (known !== undefined) return known
  rangeCount += 1
  rangeIds.set(range, rangeCount)
  return rangeCount
}

const PROBLEM_TEXT: Record<RangeProblem, () => string> = {
  order: () => translate('schedulingSettingsWindowOrder'),
  overlap: () => translate('schedulingSettingsWindowOverlap'),
}

/** The first problem of the week, "Tuesday: …", for the line under the list. */
export function weekProblem(weekly: readonly Window[]): string | null {
  for (const day of WEEK) {
    const problem = rangeProblems(rangesOf(weekly, day)).values().next().value
    if (problem) return `${weekdayName(day, 'long')}: ${PROBLEM_TEXT[problem]()}`
  }
  return null
}

/**
 * The week as one list: each day is switched on or off and, when on, has its time ranges inline. Problems mark the
 * fields at once and are worded in a line under the list that always keeps its room.
 */
export function WeeklySchedule({
  value,
  onChange,
}: {
  value: readonly Window[]
  onChange: (weekly: Window[]) => void
}) {
  const problem = weekProblem(value)
  return (
    <div className="grid gap-1.5">
      <ul
        className="grid divide-y rounded-lg border"
        aria-label={translate('schedulingSettingsWeekly')}
      >
        {WEEK.map((day) => (
          <DayRow
            key={day}
            day={day}
            ranges={rangesOf(value, day)}
            onChange={(ranges) => onChange(setRanges(value, day, ranges))}
            onCopy={(days) => onChange(copyDay(value, day, days))}
          />
        ))}
      </ul>
      <p role="alert" className="min-h-5 text-body-sm text-destructive">
        {problem}
      </p>
    </div>
  )
}

function DayRow({
  day,
  ranges,
  onChange,
  onCopy,
}: {
  day: number
  ranges: Window[]
  onChange: (ranges: (Range | Window)[]) => void
  onCopy: (days: readonly number[]) => void
}) {
  const name = weekdayName(day, 'long')
  const on = ranges.length > 0
  const problems = rangeProblems(ranges)
  const next = nextRange(ranges)
  const set = (index: number, change: Partial<Range>) =>
    onChange(
      ranges.map((range, i) => {
        if (i !== index) return range
        const edited = { ...range, ...change }
        rangeIds.set(edited, rangeKey(range))
        return edited
      }),
    )
  return (
    <li
      data-day={day}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_5.75rem_auto_auto_minmax(0,1fr)]"
    >
      <span className="flex h-9 items-center">
        <Switch
          checked={on}
          aria-label={name}
          onCheckedChange={(checked) => onChange(checked ? [{ ...DEFAULT_RANGE }] : [])}
        />
      </span>
      <span
        className={cn(
          'flex h-9 items-center text-body-sm font-medium',
          !on && 'text-muted-foreground',
        )}
      >
        {name}
      </span>
      <div
        className={cn(
          'grid gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1',
          // Off, "Unavailable" sits beside the day's name on a phone too; on, the ranges take their own line.
          on ? 'col-span-full row-start-2' : 'col-start-3 row-start-1',
        )}
      >
        {!on && (
          <span className="flex h-9 items-center text-body-sm text-muted-foreground">
            {translate('schedulingSettingsUnavailable')}
          </span>
        )}
        {ranges.map((range, index) => (
          <div key={rangeKey(range)} className="flex items-center gap-2">
            <ClockSelect
              label={translate('schedulingSettingsFrom', { day: name })}
              value={range.start}
              invalid={problems.has(index)}
              onChange={(start) => set(index, { start })}
            />
            <span aria-hidden className="text-muted-foreground">
              –
            </span>
            <ClockSelect
              label={translate('schedulingSettingsTo', { day: name })}
              value={range.end}
              invalid={problems.has(index)}
              onChange={(end) => set(index, { end })}
            />
            <IconAction
              label={translate('schedulingSettingsRemoveWindow', { day: name })}
              tip={translate('schedulingSettingsRemoveRange')}
              onClick={() => onChange(ranges.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </IconAction>
          </div>
        ))}
      </div>
      {/* Its width is kept while the day is off, so switching a day never moves the others' fields. */}
      <div
        className={cn(
          'col-start-3 row-start-1 min-w-[4.5rem] items-center gap-1 sm:col-start-4 sm:flex',
          on ? 'flex' : 'hidden',
        )}
      >
        {on && (
          <>
            <IconAction
              label={translate('schedulingSettingsAddWindow', { day: name })}
              tip={translate('schedulingSettingsAddRange')}
              disabled={!next}
              onClick={() => next && onChange([...ranges, next])}
            >
              <Plus />
            </IconAction>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      className="text-muted-foreground"
                      aria-label={translate('schedulingSettingsCopyDay', { day: name })}
                    >
                      <Copy />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{translate('schedulingSettingsCopyTo')}</TooltipContent>
              </Tooltip>
              <ActionMenuContent
                kind="dropdown"
                menu={{
                  header: translate('schedulingSettingsCopyHoursOf', { day: name }),
                  actions: [
                    {
                      id: 'workdays',
                      group: 'edit',
                      icon: <Copy />,
                      label: translate('schedulingSettingsCopyToWorkdays'),
                      onSelect: () => onCopy(WORKDAYS),
                    },
                    {
                      id: 'week',
                      group: 'edit',
                      icon: <CalendarDays />,
                      label: translate('schedulingSettingsEveryDay'),
                      onSelect: () => onCopy(WEEK),
                    },
                  ],
                }}
              />
            </DropdownMenu>
          </>
        )}
      </div>
    </li>
  )
}

export function ClockSelect({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string
  value: string
  invalid: boolean
  onChange: (clock: string) => void
}) {
  return (
    <NativeSelect
      aria-label={label}
      aria-invalid={invalid || undefined}
      wrapperClassName="w-full max-w-36 sm:w-28"
      className="tabular-nums"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {clockOptions(value).map((clock) => (
        <option key={clock} value={clock}>
          {clockLabel(clock)}
        </option>
      ))}
    </NativeSelect>
  )
}

function IconAction({
  label,
  tip,
  disabled,
  onClick,
  children,
}: {
  label: string
  tip: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="text-muted-foreground"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
