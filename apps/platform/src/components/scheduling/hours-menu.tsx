'use client'
import { Button } from '@helvetly/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Clock } from 'lucide-react'

import { NativeSelect } from '@/components/clients/fields'
import { translate } from '@/lib/i18n'
import { clock, minutesOf, type HostProfile } from '@/lib/scheduling'

/** The hours a day or week grid shows, as whole hours: from 0 to 24 is the full day. */
export type Hours = { from: number; to: number }
export type HoursChoice = { mode: 'full' | 'work'; work: Hours }

export const FULL_DAY: Hours = { from: 0, to: 24 }
export const HOURS_KEY = 'helvetly.scheduling.hours'

const isHours = (value: unknown): value is Hours => {
  if (typeof value !== 'object' || value === null) return false
  const { from, to } = value as Record<string, unknown>
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    Number(from) >= 0 &&
    Number(to) <= 24 &&
    Number(from) < Number(to)
  )
}

/** The host's working hours rounded out to whole hours, else 06:00–22:00. */
export function workingHours(profile: HostProfile | undefined): Hours {
  const weekly = profile?.weekly ?? []
  if (!weekly.length) return { from: 6, to: 22 }
  const from = Math.floor(Math.min(...weekly.map((entry) => minutesOf(entry.start))) / 60)
  const to = Math.ceil(Math.max(...weekly.map((entry) => minutesOf(entry.end))) / 60)
  return from < to ? { from, to: Math.min(24, to) } : { from: 6, to: 22 }
}

// A personal display preference kept per browser; storage may be unavailable or hold anything.
export function storedHours(): HoursChoice | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HOURS_KEY) ?? 'null')
    if (typeof saved !== 'object' || saved === null) return null
    const { mode, work } = saved as Record<string, unknown>
    return (mode === 'full' || mode === 'work') && isHours(work) ? { mode, work } : null
  } catch {
    return null
  }
}

export function saveHours(choice: HoursChoice) {
  try {
    localStorage.setItem(HOURS_KEY, JSON.stringify(choice))
  } catch {}
}

/** The toolbar's "Show hours" control: the full day or a range of whole hours. */
export function HoursMenu({
  choice,
  onChange,
}: {
  choice: HoursChoice
  onChange: (choice: HoursChoice) => void
}) {
  const { from, to } = choice.work
  const range = `${clock(from * 60)}–${clock(to * 60)}`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Clock />
          <span className="sr-only">{translate('schedShowHours')}: </span>
          {choice.mode === 'full' ? translate('schedFullDay') : range}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={translate('schedShowHours')} className="w-64 gap-3">
        <p className="text-body-sm font-medium">{translate('schedShowHours')}</p>
        <Segmented
          label={translate('schedShowHours')}
          size="sm"
          fill
          value={choice.mode}
          options={[
            { value: 'full', label: translate('schedFullDay') },
            { value: 'work', label: translate('schedWorkingHours') },
          ]}
          onChange={(mode) => onChange({ ...choice, mode })}
        />
        {choice.mode === 'work' && (
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect
              aria-label={translate('schedHoursFrom')}
              value={from}
              onChange={(event) => {
                const next = Number(event.target.value)
                onChange({ ...choice, work: { from: next, to: Math.max(to, next + 1) } })
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {clock(hour * 60)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={translate('schedHoursTo')}
              value={to}
              onChange={(event) =>
                onChange({ ...choice, work: { from, to: Number(event.target.value) } })
              }
            >
              {Array.from({ length: 24 - from }, (_, i) => from + 1 + i).map((hour) => (
                <option key={hour} value={hour}>
                  {clock(hour * 60)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
