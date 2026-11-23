'use client'
import { cn } from '@helvetly/ui/lib/utils'
import { Check } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { translate } from '@/lib/i18n'
import {
  clock,
  dayLabel,
  hostColor,
  hostTint,
  instantOf,
  isOpen,
  timeLabel,
  zoned,
  type Busy,
  type Occurrence,
  type Person,
} from '@/lib/scheduling'

import { HostDot } from './bits'
import { clipToDay, layoutDay, snapMinutes } from './layout'

const HOUR = 48
const SNAP = 15
const MIN_LENGTH = 15

type Drag = {
  occurrence: Occurrence
  mode: 'move' | 'resize'
  x: number
  y: number
  /** The session's start and end on the grid's wall clock. */
  start: { date: string; minutes: number }
  end: { date: string; minutes: number }
  dMinutes: number
  dDays: number
  moved: boolean
}

/** Day or week as a time grid: sessions placed by their wall-clock time in `zone`, busy times hatched, `lanes` side by side. */
export function TimeGrid({
  days,
  zone,
  occurrences,
  busy,
  lanes,
  now,
  canWrite,
  onOpen,
  onCreate,
  onMove,
}: {
  days: string[]
  zone: string
  occurrences: Occurrence[]
  busy: Busy[]
  /** Hosts shown side by side in each day; null shows everyone in one column. */
  lanes: Person[] | null
  now: Date
  canWrite: boolean
  onOpen: (occurrence: Occurrence) => void
  onCreate: (date: string, minutes: number, hostId?: string) => void
  onMove: (occurrence: Occurrence, startsAt: Date, endsAt: Date) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const columns = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const hintId = useId()
  const today = zoned(now, zone)

  useEffect(() => {
    // Opens on the working day, not at midnight.
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR
  }, [])

  const laneList = lanes ?? [null]
  const laneOf = (hostId: string | null | undefined) =>
    lanes
      ? Math.max(
          0,
          lanes.findIndex((lane) => lane.id === hostId),
        )
      : 0

  const shifted = (occurrence: Occurrence) => {
    if (drag?.occurrence.id !== occurrence.id) return null
    const startDate = days[days.indexOf(drag.start.date) + drag.dDays] ?? drag.start.date
    const startMinutes =
      drag.mode === 'move' ? drag.start.minutes + drag.dMinutes : drag.start.minutes
    const length =
      drag.mode === 'move'
        ? lengthOf(occurrence)
        : Math.max(MIN_LENGTH, lengthOf(occurrence) + drag.dMinutes)
    return { startDate, startMinutes, length }
  }

  const finish = (target: Drag) => {
    const startDate = days[days.indexOf(target.start.date) + target.dDays] ?? target.start.date
    const length =
      target.mode === 'move'
        ? lengthOf(target.occurrence)
        : Math.max(MIN_LENGTH, lengthOf(target.occurrence) + target.dMinutes)
    const startMinutes =
      target.mode === 'move' ? target.start.minutes + target.dMinutes : target.start.minutes
    const startsAt =
      target.mode === 'move' || target.dDays !== 0
        ? instantOf(startDate, startMinutes, zone)
        : new Date(target.occurrence.starts_at)
    onMove(target.occurrence, startsAt, new Date(startsAt.getTime() + length * 60_000))
  }

  const pointerDown = (
    event: PointerEvent<HTMLElement>,
    occurrence: Occurrence,
    mode: Drag['mode'],
  ) => {
    if (!canWrite || !isOpen(occurrence.status) || event.button !== 0) return
    event.stopPropagation()
    setDrag({
      occurrence,
      mode,
      x: event.clientX,
      y: event.clientY,
      start: zoned(occurrence.starts_at, zone),
      end: zoned(occurrence.ends_at, zone),
      dMinutes: 0,
      dDays: 0,
      moved: false,
    })
  }
  const pointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return
    const width = (columns.current?.clientWidth ?? 0) / days.length
    const dMinutes = snapMinutes(event.clientY - drag.y, HOUR, SNAP)
    const dDays =
      drag.mode === 'move' && width > 0 ? Math.round((event.clientX - drag.x) / width) : 0
    const index = days.indexOf(drag.start.date)
    const clamped = Math.min(days.length - 1 - index, Math.max(-index, dDays))
    const moved =
      drag.moved || Math.abs(event.clientY - drag.y) > 4 || Math.abs(event.clientX - drag.x) > 4
    setDrag({ ...drag, dMinutes, dDays: index === -1 ? 0 : clamped, moved })
  }
  const pointerUp = () => {
    if (!drag) return
    setDrag(null)
    if (drag.moved && (drag.dMinutes !== 0 || drag.dDays !== 0)) finish(drag)
    else if (!drag.moved) onOpen(drag.occurrence)
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>, occurrence: Occurrence) => {
    if (!event.altKey || !canWrite || !isOpen(occurrence.status)) return
    const vertical = { ArrowUp: -SNAP, ArrowDown: SNAP }[event.key]
    const horizontal = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (vertical === undefined && horizontal === undefined) return
    event.preventDefault()
    const start = new Date(occurrence.starts_at)
    const end = new Date(occurrence.ends_at)
    if (event.shiftKey && vertical !== undefined) {
      const nextEnd = new Date(end.getTime() + vertical * 60_000)
      if (nextEnd.getTime() - start.getTime() >= MIN_LENGTH * 60_000)
        onMove(occurrence, start, nextEnd)
      return
    }
    const local = zoned(start, zone)
    const index = days.indexOf(local.date)
    const date = horizontal ? (days[index + horizontal] ?? local.date) : local.date
    const startsAt = instantOf(date, local.minutes + (vertical ?? 0), zone)
    onMove(occurrence, startsAt, new Date(startsAt.getTime() + lengthOf(occurrence) * 60_000))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <p id={hintId} className="sr-only">
        {translate('schedKeyboardHint')}
      </p>
      {/* Day (and host) headings, aligned with the columns under them. */}
      <div className="flex [scrollbar-gutter:stable] overflow-hidden border-b">
        <div className="w-14 shrink-0" />
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((day) => (
            <div
              key={day}
              className="grid min-w-0 border-l px-1 py-1.5 text-center first:border-l-0"
            >
              <span
                className={cn(
                  'truncate text-body-sm',
                  day === today.date ? 'font-semibold text-brand' : 'text-muted-foreground',
                )}
              >
                {dayLabel(day)}
              </span>
              {lanes && (
                <span
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}
                >
                  {lanes.map((lane) => (
                    <span
                      key={lane.id}
                      className="flex min-w-0 items-center justify-center gap-1 text-caption text-muted-foreground"
                    >
                      <HostDot id={lane.id} />
                      <span className="truncate">{lane.name.split(' ')[0]}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR }}>
          <div className="relative w-14 shrink-0" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => (
              <span
                key={i}
                className="absolute right-2 -translate-y-1/2 text-caption text-muted-foreground tabular-nums"
                style={{ top: (i + 1) * HOUR }}
              >
                {clock((i + 1) * 60)}
              </span>
            ))}
          </div>
          <div
            ref={columns}
            className="relative grid flex-1 pr-1"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {/* Hour lines. */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="border-t border-border/60" style={{ height: HOUR }} />
              ))}
            </div>
            {days.map((day) => (
              <div
                key={day}
                className="relative grid border-l first:border-l-0"
                style={{ gridTemplateColumns: `repeat(${laneList.length}, minmax(0, 1fr))` }}
              >
                {laneList.map((lane, laneIndex) => (
                  <DayColumn
                    key={lane?.id ?? 'all'}
                    day={day}
                    zone={zone}
                    lane={lane}
                    divided={laneIndex > 0}
                    occurrences={occurrences.filter(
                      (entry) => !lanes || laneOf(entry.host?.id) === laneIndex,
                    )}
                    busy={busy.filter((block) => !lanes || laneOf(block.host_id) === laneIndex)}
                    canWrite={canWrite}
                    hintId={hintId}
                    shifted={shifted}
                    dragging={drag?.moved ? drag.occurrence.id : null}
                    onCreate={onCreate}
                    onOpen={onOpen}
                    onPointerDown={pointerDown}
                    onKeyDown={keyDown}
                  />
                ))}
                {day === today.date && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive/70"
                    style={{ top: (today.minutes / 60) * HOUR }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const lengthOf = (occurrence: Occurrence) =>
  Math.round((Date.parse(occurrence.ends_at) - Date.parse(occurrence.starts_at)) / 60_000)

function DayColumn({
  day,
  zone,
  lane,
  divided,
  occurrences,
  busy,
  canWrite,
  hintId,
  shifted,
  dragging,
  onCreate,
  onOpen,
  onPointerDown,
  onKeyDown,
}: {
  day: string
  zone: string
  lane: Person | null
  divided: boolean
  occurrences: Occurrence[]
  busy: Busy[]
  canWrite: boolean
  hintId: string
  shifted: (
    occurrence: Occurrence,
  ) => { startDate: string; startMinutes: number; length: number } | null
  dragging: string | null
  onCreate: (date: string, minutes: number, hostId?: string) => void
  onOpen: (occurrence: Occurrence) => void
  onPointerDown: (
    event: PointerEvent<HTMLElement>,
    occurrence: Occurrence,
    mode: 'move' | 'resize',
  ) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>, occurrence: Occurrence) => void
}) {
  const spans = occurrences.flatMap((occurrence) => {
    const moved = shifted(occurrence)
    const start = zoned(occurrence.starts_at, zone)
    const end = zoned(occurrence.ends_at, zone)
    const clipped = moved
      ? moved.startDate === day
        ? { start: moved.startMinutes, end: Math.min(1440, moved.startMinutes + moved.length) }
        : null
      : clipToDay(start.date, start.minutes, end.date, end.minutes, day)
    return clipped ? [{ id: occurrence.id, occurrence, ...clipped }] : []
  })
  const placed = layoutDay(spans)
  const busyBlocks = busy.flatMap((block) => {
    const start = zoned(block.starts_at, zone)
    const end = zoned(block.ends_at, zone)
    const clipped = clipToDay(start.date, start.minutes, end.date, end.minutes, day)
    return clipped ? [{ ...clipped, key: `${block.host_id}-${block.starts_at}` }] : []
  })

  return (
    <div className={cn('relative', divided && 'border-l border-dashed border-border/60')}>
      {canWrite &&
        Array.from({ length: 48 }, (_, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-label={translate('schedNewSessionAt', { day: dayLabel(day), time: clock(i * 30) })}
            onClick={() => onCreate(day, i * 30, lane?.id)}
            className="absolute inset-x-0 cursor-cell hover:bg-muted/50"
            style={{ top: (i * HOUR) / 2, height: HOUR / 2 }}
          />
        ))}
      {busyBlocks.map((block) => (
        <div
          key={block.key}
          className="pointer-events-none absolute inset-x-0.5 rounded-md bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,transparent_6px_12px)] ring-1 ring-border ring-inset"
          style={{
            top: (block.start / 60) * HOUR,
            height: ((block.end - block.start) / 60) * HOUR,
          }}
        >
          <span className="sr-only">{translate('schedBusy')}</span>
        </div>
      ))}
      {placed.map((block) => {
        const occurrence = spans.find((span) => span.id === block.id)?.occurrence
        if (!occurrence) return null
        const color = hostColor(occurrence.host?.id)
        const open = isOpen(occurrence.status)
        const closed = occurrence.status.startsWith('cancelled') || occurrence.status === 'declined'
        const height = Math.max(((block.end - block.start) / 60) * HOUR, 20)
        return (
          <div
            key={block.id}
            className={cn('absolute z-10 px-0.5', dragging === block.id && 'z-30 opacity-90')}
            style={{
              top: (block.start / 60) * HOUR,
              height,
              left: `${(block.col / block.cols) * 100}%`,
              width: `${100 / block.cols}%`,
            }}
          >
            <button
              type="button"
              aria-describedby={canWrite && open ? hintId : undefined}
              onPointerDown={(event) => onPointerDown(event, occurrence, 'move')}
              onClick={(event) => {
                // A movable block opens on pointer-up (a drag must not open it); Enter, Space and fixed blocks here.
                if (event.detail === 0 || !(canWrite && open)) onOpen(occurrence)
              }}
              onKeyDown={(event) => onKeyDown(event, occurrence)}
              className={cn(
                'flex size-full touch-none flex-col items-start overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                // A title-only block centres its one line at the caption's paired line height; two lines stack tight.
                height >= 34 ? 'leading-tight' : 'justify-center',
                canWrite && open ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                occurrence.status === 'requested' && 'border border-l-[3px] border-dashed',
                closed && 'opacity-60',
              )}
              style={{
                backgroundColor: hostTint(occurrence.host?.id, closed ? 12 : 22),
                borderColor: color,
              }}
            >
              <span
                className={cn(
                  'flex w-full items-center gap-1 font-medium',
                  closed && 'line-through',
                )}
              >
                {occurrence.status === 'attended' && (
                  <Check
                    aria-label={translate('schedStatusAttended')}
                    className="size-3 shrink-0"
                  />
                )}
                <span className="truncate">{occurrence.title}</span>
              </span>
              {height >= 34 && (
                <span className="w-full truncate text-muted-foreground">
                  {timeLabel(occurrence.starts_at, zone)} · {occurrence.client.name}
                </span>
              )}
            </button>
            {canWrite && open && (
              <span
                aria-hidden
                onPointerDown={(event) => onPointerDown(event, occurrence, 'resize')}
                className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize touch-none"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
