import { describe, expect, it } from 'vitest'

import type { MoveItem, MoveReason } from '@/lib/scheduling'

import {
  choicesBody,
  defaultChoice,
  defaultChoices,
  moveCounts,
  moveOptions,
  moveReasonText,
} from './move-conflicts-model'

const item = (
  reason: MoveReason,
  id: string = reason,
  moves = false,
  dayOff?: string,
): MoveItem => ({
  occurrence_id: id,
  starts_at: '2026-12-22T08:00:00Z',
  ends_at: '2026-12-22T09:00:00Z',
  moves_to: moves ? '2026-12-24T10:00:00Z' : null,
  status: 'scheduled',
  reason,
  moves,
  day_off: dayOff,
})

describe('moveReasonText', () => {
  it.each<[MoveItem, string]>([
    [item('started'), 'Has started: it keeps its time.'],
    [item('closed'), 'Already closed: it stays as it is.'],
    [item('exception'), 'Changed on its own: it keeps its time.'],
    [item('day_off', 'a', true, 'Christmas Eve'), 'Would land on a day off (Christmas Eve).'],
    [
      item('day_off', 'b', false, 'Christmas Eve'),
      'Its new day is a day off (Christmas Eve): the series skips it.',
    ],
    [item('outside_series'), 'Past the end of the series: it would be cancelled.'],
    [item('request_pending', 'c', true), 'The client has an open request for this session.'],
    [item('conflict', 'd', true), 'The host is busy at the new time.'],
    [item('monthly_rule'), "The series repeats on a day of the month, which can't move by days."],
  ])('%o', (entry, text) => expect(moveReasonText(entry)).toBe(text))
})

describe('moveOptions and defaultChoice', () => {
  it.each<[MoveItem, string[], string | undefined]>([
    [item('day_off', 'a', true), ['Keep on its original day', 'Skip this date'], 'keep'],
    [item('day_off', 'b', false), ['Keep on its original day', 'Skip this date'], 'cancel'],
    [item('exception'), ['Leave as it is', 'Move it too'], 'keep'],
    [item('conflict', 'c', true), ['Move anyway', 'Keep on its original day'], 'move'],
    [item('request_pending', 'd', true), ['Move anyway', 'Keep on its original day'], 'move'],
    [item('started'), [], undefined],
    [item('closed'), [], undefined],
    [item('outside_series'), [], undefined],
    [item('monthly_rule'), [], undefined],
  ])('%o', (entry, labels, choice) => {
    expect(moveOptions(entry).map((option) => option.label)).toEqual(labels)
    expect(defaultChoice(entry)).toBe(choice)
  })
})

describe('moveCounts and choicesBody', () => {
  const items = [
    item('day_off', 'day', true),
    item('exception', 'own'),
    item('conflict', 'busy', true),
    item('started', 'now'),
  ]
  const preview = { moving: 10, sample: [], items }

  it('counts the proposed choices: the day off stays, the busy one moves', () => {
    expect(moveCounts(preview, defaultChoices(items))).toEqual({ moving: 9, staying: 3 })
  })

  it('follows changed choices and names the ids for the API', () => {
    const choices = { day: 'cancel', own: 'move', busy: 'keep' } as const
    expect(moveCounts(preview, choices)).toEqual({ moving: 9, staying: 3 })
    expect(choicesBody(items, choices)).toEqual({
      keep: ['busy'],
      cancel: ['day'],
      include: ['own'],
    })
    expect(choicesBody(items, defaultChoices(items))).toEqual({
      keep: ['day', 'own'],
      cancel: [],
      include: [],
    })
  })
})
