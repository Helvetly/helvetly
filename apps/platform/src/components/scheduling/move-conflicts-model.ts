import { translate } from '@/lib/i18n'
import {
  dayLabel,
  timeLabel,
  weekdayName,
  zoned,
  type Conflict,
  type MoveChoices,
  type MoveItem,
  type MovePreview,
} from '@/lib/scheduling'

import { weekdayOfDate } from './session-model'

/** What the person decides for a listed session; move_to goes with its own time (`at`, an instant). */
export type MoveDecision = 'keep' | 'skip' | 'move_anyway' | 'with_series' | 'move_to'
export type Decision = { kind: MoveDecision; at?: string }

/** "Thu 6 May, 20:15": a session's day and time in the series' zone. */
export const whenLabel = (instant: string, zone: string) =>
  `${dayLabel(zoned(instant, zone).date)}, ${timeLabel(instant, zone)}`

/** "Thursday 20:15": the day of the week and time a series moves from or to. */
export const slotLabel = (instant: string, zone: string) =>
  `${weekdayName(weekdayOfDate(zoned(instant, zone).date), 'long')} ${timeLabel(instant, zone)}`

/** What a new time overlaps, in plain words: the first overlap says enough. */
export function overlapText(conflict: Conflict, zone: string): string {
  const values = {
    title: conflict.title || translate('schedAnotherSession'),
    from: timeLabel(conflict.starts_at, zone),
    to: timeLabel(conflict.ends_at, zone),
  }
  switch (conflict.kind) {
    case 'event':
      return translate('schedMoveOverlapEvent', values)
    case 'client':
      return translate('schedMoveOverlapClient', values)
    case 'busy':
      return translate('schedMoveOverlapBusy', values)
    case 'holiday':
      return translate('schedMovePickDayOff')
    case 'outside_hours':
      return translate('schedMovePickOutsideHours')
  }
}

/** Why a session does not simply move, in plain words. */
export function moveReasonText(item: MoveItem, zone: string): string {
  const day = item.moves_to ? dayLabel(zoned(item.moves_to, zone).date) : ''
  const overlap = item.conflicts?.[0]
  switch (item.reason) {
    case 'started':
      return translate('schedMoveStarted')
    case 'closed':
      return translate('schedMoveClosed')
    case 'exception':
      return translate('schedMoveException', { when: whenLabel(item.starts_at, zone) })
    case 'day_off':
      return translate(item.moves ? 'schedMoveDayOff' : 'schedMoveDayOffSkipped', {
        day,
        name: item.day_off ?? '',
      })
    case 'outside_series':
      return translate('schedMoveOutside', { day })
    case 'request_pending':
      return translate('schedMoveRequest')
    case 'conflict':
      return overlap ? overlapText(overlap, zone) : translate('schedMoveBusy')
    case 'monthly_rule':
      return translate('schedMoveMonthly')
  }
}

/** The decisions a listed session offers; none: it is only told (started, closed, the monthly rule). */
export function moveOptions(
  item: MoveItem,
  zone: string,
): { value: MoveDecision; label: string }[] {
  const keep = {
    value: 'keep' as const,
    label: translate('schedMoveKeepOn', {
      day: weekdayName(weekdayOfDate(zoned(item.starts_at, zone).date), 'long'),
    }),
  }
  const anyway = { value: 'move_anyway' as const, label: translate('schedMoveAnyway') }
  const skip = { value: 'skip' as const, label: translate('schedMoveSkipDate') }
  const pick = { value: 'move_to' as const, label: translate('schedMovePick') }
  switch (item.reason) {
    case 'day_off':
      return [anyway, keep, skip, pick]
    case 'exception':
      return [
        { value: 'keep', label: translate('schedMoveLeave') },
        { value: 'with_series', label: translate('schedMoveWithSeries') },
        pick,
      ]
    case 'conflict':
    case 'request_pending':
      return [anyway, keep, pick]
    case 'outside_series':
      return [keep, skip, pick]
    default:
      return []
  }
}

/**
 * The proposed decision: what the series would do on its own, except that a session never lands on a day off
 * unasked and one changed on its own keeps its time.
 */
export function defaultDecision(item: MoveItem): MoveDecision | undefined {
  switch (item.reason) {
    case 'day_off':
      return item.moves ? 'keep' : 'skip'
    case 'exception':
      return 'keep'
    case 'conflict':
    case 'request_pending':
      return 'move_anyway'
    case 'outside_series':
      return 'skip'
    default:
      return undefined
  }
}

export const defaultDecisions = (items: MoveItem[]): Record<string, Decision> =>
  Object.fromEntries(
    items.flatMap((item) => {
      const kind = defaultDecision(item)
      return kind ? [[item.occurrence_id, { kind, at: item.moves_to ?? item.starts_at }]] : []
    }),
  )

/** The footer's counts: sessions that move with the series, and each decision made. */
export function decisionCounts(preview: MovePreview, decisions: Record<string, Decision>) {
  const counts = { move: preview.moving, anyway: 0, kept: 0, rescheduled: 0, skipped: 0 }
  for (const item of preview.items) {
    if (item.moves) counts.move--
    const kind = decisions[item.occurrence_id]?.kind
    if (kind === 'with_series') counts.move++
    if (kind === 'move_anyway') counts.anyway++
    if (kind === 'keep') counts.kept++
    if (kind === 'move_to') counts.rescheduled++
    if (kind === 'skip') counts.skipped++
  }
  return counts
}

/** "53 move · 1 moved anyway · 1 kept": the counts that are not zero (moving ones always). */
export function decisionSummary(counts: ReturnType<typeof decisionCounts>) {
  return [
    translate('schedMoveSumMove', { count: counts.move }),
    counts.anyway > 0 && translate('schedMoveSumAnyway', { count: counts.anyway }),
    counts.kept > 0 && translate('schedMoveSumKept', { count: counts.kept }),
    counts.rescheduled > 0 && translate('schedMoveSumRescheduled', { count: counts.rescheduled }),
    counts.skipped > 0 && translate('schedMoveSumSkipped', { count: counts.skipped }),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The API's decisions: one per listed session that offers a choice. */
export function decisionsBody(
  items: MoveItem[],
  decisions: Record<string, Decision>,
): Required<MoveChoices> {
  const body: Record<string, string> = {}
  for (const item of items) {
    const decision = decisions[item.occurrence_id]
    if (!decision) continue
    body[item.occurrence_id] =
      decision.kind === 'move_to' ? `move_to:${decision.at ?? ''}` : decision.kind
  }
  return { decisions: body }
}
