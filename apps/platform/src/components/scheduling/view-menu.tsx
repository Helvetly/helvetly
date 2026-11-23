'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { CalendarDays, ChevronDown, List } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import { NativeSelect } from '@/components/clients/fields'
import { translate } from '@/lib/i18n'
import { clock, VIEWS, type View } from '@/lib/scheduling'

import type { HoursChoice } from './hours-menu'

export type Layout = 'calendar' | 'list'

export const VIEW_LABEL: Record<View, string> = {
  day: translate('schedDay'),
  week: translate('schedWeek'),
  month: translate('schedMonth'),
}

// The menu's typeahead and arrow keys would take the keys meant for a select inside it.
const keepKeys = (event: KeyboardEvent) => event.stopPropagation()

const isMode = (value: string): value is HoursChoice['mode'] => value === 'full' || value === 'work'

/** The one view control: the period, calendar or list, and for a day or week the hours shown. */
export function ViewMenu({
  view,
  layout,
  hours,
  onView,
  onLayout,
  onHours,
}: {
  view: View
  layout: Layout
  hours: HoursChoice
  onView: (view: View) => void
  onLayout: (layout: Layout) => void
  onHours: (hours: HoursChoice) => void
}) {
  const { from, to } = hours.work
  const Icon = layout === 'list' ? List : CalendarDays
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Icon />
          <span className="sr-only">{translate('schedView')}: </span>
          {VIEW_LABEL[view]}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(next) => {
            const chosen = VIEWS.find((entry) => entry === next)
            if (chosen) onView(chosen)
          }}
        >
          {VIEWS.map((entry) => (
            <DropdownMenuRadioItem key={entry} value={entry}>
              {VIEW_LABEL[entry]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={layout}
          onValueChange={(next) => onLayout(next === 'list' ? 'list' : 'calendar')}
        >
          <DropdownMenuRadioItem value="calendar">
            <CalendarDays />
            {translate('schedCalendarLayout')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="list">
            <List />
            {translate('schedList')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {layout === 'calendar' && view !== 'month' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-caption text-muted-foreground">
              {translate('schedShowHours')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={hours.mode}
              onValueChange={(mode) => {
                if (isMode(mode)) onHours({ ...hours, mode })
              }}
            >
              {/* The menu stays open: working hours offer their range right below. */}
              <DropdownMenuRadioItem value="full" onSelect={(event) => event.preventDefault()}>
                {translate('schedFullDay')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="work" onSelect={(event) => event.preventDefault()}>
                {translate('schedWorkingHours')}
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {clock(from * 60)}–{clock(to * 60)}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {hours.mode === 'work' && (
              <div className="grid grid-cols-2 gap-2 p-1.5">
                <NativeSelect
                  aria-label={translate('schedHoursFrom')}
                  onKeyDown={keepKeys}
                  value={from}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    onHours({ ...hours, work: { from: next, to: Math.max(to, next + 1) } })
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
                  onKeyDown={keepKeys}
                  value={to}
                  onChange={(event) =>
                    onHours({ ...hours, work: { from, to: Number(event.target.value) } })
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
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
