'use client'

import { Button } from '@helvetly/ui/components/button'
import { Calendar } from '@helvetly/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { useState } from 'react'

import { addDays, daysBetween, formatDay } from '@/lib/invoices'

/** A civil date ("2026-11-05") as a local Date for the calendar, and back; no time zone drift. */
export const toDate = (civil: string) => {
  const [year = 1970, month = 1, day = 1] = civil.split('-').map(Number)
  return new Date(year, month - 1, day)
}
export const toCivil = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Every value in the meta list: quiet text that shows a field on hover and focus. */
export const quietValue =
  'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[13.5px] tabular-nums outline-none transition-colors placeholder:text-placeholder hover:bg-muted/70 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/40 aria-expanded:bg-muted/70 data-invalid:text-destructive'

/** Every date popover: the calendar's width, 12px padding, one column. */
const popover = 'grid w-auto gap-2 p-3'

const bounds = (min?: string, max?: string) => [
  ...(min ? [{ before: toDate(min) }] : []),
  ...(max ? [{ after: toDate(max) }] : []),
]

/** One date, picked from a calendar. */
export function DateField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (date: string) => void
  min?: string
  max?: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`${label}: ${formatDay(value)}`}
          data-invalid={invalid || undefined}
          className={quietValue}
        >
          {formatDay(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={popover}>
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={toDate(value)}
          defaultMonth={toDate(value)}
          disabled={bounds(min, max)}
          onSelect={(date) => {
            if (!date) return
            onChange(toCivil(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const TERMS = [10, 14, 30, 60]

/** The due date with its term as a suffix; the popover offers the usual terms first. */
export function DueDateField({
  id,
  issueDate,
  value,
  onChange,
  invalid,
}: {
  id: string
  issueDate: string
  value: string
  onChange: (date: string) => void
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const days = daysBetween(issueDate, value)
  const choose = (date: string) => {
    onChange(date)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`Due date: ${formatDay(value)}`}
          data-invalid={invalid || undefined}
          className={quietValue}
        >
          {formatDay(value)}
          <span
            className={cn('text-[12.5px]', days < 0 ? 'text-destructive' : 'text-muted-foreground')}
          >
            {days < 0 ? 'before the issue date' : days === 0 ? 'on receipt' : `in ${days} days`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={popover}>
        {/* Terms as a segmented track: the chosen one is a raised white chip. */}
        <div className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-0.5">
          {TERMS.map((term) => (
            <button
              key={term}
              type="button"
              aria-pressed={days === term}
              onClick={() => choose(addDays(issueDate, term))}
              className="h-7 rounded-md text-[12.5px] text-muted-foreground tabular-nums transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-elevation-1"
            >
              {term} days
            </button>
          ))}
        </div>
        <label className="flex h-8 items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
          Other term
          <input
            inputMode="numeric"
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && custom) choose(addDays(issueDate, Number(custom)))
            }}
            placeholder="45"
            className="h-7 w-14 rounded-md border border-input bg-card px-2 text-right text-[12.5px] text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          days
        </label>
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={toDate(value)}
          defaultMonth={toDate(value)}
          disabled={bounds(issueDate)}
          onSelect={(date) => date && choose(toCivil(date))}
        />
        <p className="border-t border-border/70 pt-2 text-[12.5px] text-muted-foreground">
          Due <span className="text-foreground">{formatDay(value)}</span>
          {days > 0 ? ` · in ${days} days` : days === 0 ? ' · on receipt' : ''}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** The date of the service, or its period (Leistungsdatum / Leistungszeitraum); optional. */
export function ServiceField({
  id,
  start,
  end,
  onChange,
  invalid,
}: {
  id: string
  start: string
  end: string
  onChange: (start: string, end: string) => void
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [period, setPeriod] = useState(Boolean(end))
  const label = !start
    ? null
    : end
      ? `${formatDay(start).replace(/ \d{4}$/, start.slice(0, 4) === end.slice(0, 4) ? '' : '$&')} – ${formatDay(end)}`
      : formatDay(start)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`Service date: ${label ?? 'none'}`}
          data-invalid={invalid || undefined}
          className={cn(quietValue, !label && 'text-muted-foreground/70')}
        >
          {label ?? 'Add date or period'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={popover}>
        <div className="flex h-8 items-center justify-between gap-2">
          <Segmented
            label="Service"
            value={period ? 'period' : 'day'}
            options={[
              { value: 'day', label: 'One day' },
              { value: 'period', label: 'Period' },
            ]}
            onChange={(choice) => {
              setPeriod(choice === 'period')
              if (choice === 'day' && end) onChange(start, '')
            }}
          />
          {start && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                onChange('', '')
                setOpen(false)
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {period ? (
          <Calendar
            mode="range"
            weekStartsOn={1}
            selected={
              start ? { from: toDate(start), to: end ? toDate(end) : undefined } : undefined
            }
            defaultMonth={start ? toDate(start) : undefined}
            onSelect={(range) => {
              if (!range?.from) return onChange('', '')
              onChange(toCivil(range.from), range.to ? toCivil(range.to) : '')
              if (range.to && toCivil(range.to) !== toCivil(range.from)) setOpen(false)
            }}
          />
        ) : (
          <Calendar
            mode="single"
            weekStartsOn={1}
            selected={start ? toDate(start) : undefined}
            defaultMonth={start ? toDate(start) : undefined}
            onSelect={(date) => {
              onChange(date ? toCivil(date) : '', '')
              setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
