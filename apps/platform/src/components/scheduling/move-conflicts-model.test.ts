import { describe, expect, it } from 'vitest'

import type { MoveItem, MovePreview } from '@/lib/scheduling'

import {
  decisionCounts,
  decisionsBody,
  decisionSummary,
  defaultDecision,
  defaultDecisions,
  moveOptions,
  moveReasonText,
  overlapText,
  slotLabel,
} from './move-conflicts-model'

const ZONE = 'Europe/Zurich'

// Wednesday 5 May 2027, 20:30 in Zurich; by the rule it would go to Thursday 6 May, 20:15.
const item = (reason: MoveItem['reason'], extra: Partial<MoveItem> = {}): MoveItem => ({
  occurrence_id: reason,
  starts_at: '2027-05-05T18:30:00Z',
  ends_at: '2027-05-05T19:30:00Z',
  moves_to: '2027-05-06T18:15:00Z',
  status: 'scheduled',
  reason,
  moves: false,
  ...extra,
})

describe('moveReasonText', () => {
  it.each<[string, MoveItem, string]>([
    [
      'started',
      item('started', { moves_to: null }),
      'This session has already started, so it keeps its time.',
    ],
    [
      'closed',
      item('closed', { moves_to: null }),
      'This session has already happened, so it stays as it is.',
    ],
    [
      'exception',
      item('exception'),
      'You already moved this session on its own to Wed 5 May, 20:30.',
    ],
    [
      'day off it lands on',
      item('day_off', { moves: true, day_off: 'Ascension Day' }),
      'Thu 6 May is a day off (Ascension Day).',
    ],
    [
      'day off the series skips',
      item('day_off', { day_off: 'Ascension Day' }),
      'Thu 6 May is a day off (Ascension Day), and this series skips days off.',
    ],
    ['past the end', item('outside_series'), 'Thu 6 May is past the end of the series.'],
    [
      'request',
      item('request_pending', { moves: true }),
      'The client asked to change this session and is waiting for your answer.',
    ],
    [
      'overlap',
      item('conflict', {
        moves: true,
        conflicts: [
          {
            kind: 'event',
            title: 'Strategy call',
            starts_at: '2027-05-06T18:00:00Z',
            ends_at: '2027-05-06T19:00:00Z',
          },
        ],
      }),
      'Overlaps “Strategy call”, 20:00–21:00.',
    ],
    ['busy without details', item('conflict', { moves: true }), 'Someone is busy at the new time.'],
  ])('%s', (_, given, text) => {
    expect(moveReasonText(given, ZONE)).toBe(text)
  })

  it('names every kind of overlap', () => {
    const at = { starts_at: '2027-05-06T18:00:00Z', ends_at: '2027-05-06T19:00:00Z' }
    expect(overlapText({ kind: 'client', title: 'Tax review', ...at }, ZONE)).toBe(
      'The client has “Tax review” with someone else on your team, 20:00–21:00.',
    )
    expect(overlapText({ kind: 'busy', ...at }, ZONE)).toBe(
      'Your calendar shows you as busy, 20:00–21:00.',
    )
    expect(overlapText({ kind: 'holiday', ...at }, ZONE)).toBe('That day is a day off.')
    expect(overlapText({ kind: 'outside_hours', ...at }, ZONE)).toBe(
      "That's outside working hours.",
    )
  })
})

const labels = (given: MoveItem) => moveOptions(given, ZONE).map((option) => option.label)

describe('moveOptions and defaults', () => {
  it('offers the ways out per reason', () => {
    expect(labels(item('day_off', { day_off: 'x' }))).toEqual([
      'Move anyway',
      'Keep on Wednesday',
      'Skip this date',
      'Pick another time…',
    ])
    expect(labels(item('exception'))).toEqual([
      'Leave as it is',
      'Move with the series',
      'Pick another time…',
    ])
    expect(labels(item('conflict', { moves: true }))).toEqual([
      'Move anyway',
      'Keep on Wednesday',
      'Pick another time…',
    ])
    expect(labels(item('outside_series'))).toEqual([
      'Keep on Wednesday',
      'Skip this date',
      'Pick another time…',
    ])
    expect(labels(item('started'))).toEqual([])
    expect(labels(item('monthly_rule'))).toEqual([])
  })

  it('proposes what the series would do, never a day off unasked', () => {
    expect(defaultDecision(item('day_off', { moves: true }))).toBe('keep')
    expect(defaultDecision(item('day_off'))).toBe('skip')
    expect(defaultDecision(item('exception'))).toBe('keep')
    expect(defaultDecision(item('conflict', { moves: true }))).toBe('move_anyway')
    expect(defaultDecision(item('outside_series'))).toBe('skip')
    expect(defaultDecision(item('closed'))).toBeUndefined()
    // A picked time starts at the proposed one.
    expect(defaultDecisions([item('exception')]).exception).toEqual({
      kind: 'keep',
      at: '2027-05-06T18:15:00Z',
    })
  })
})

describe('decision counts and body', () => {
  const preview: MovePreview = {
    moving: 55,
    sample: [],
    items: [
      item('day_off', { occurrence_id: 'a', moves: true }),
      item('conflict', { occurrence_id: 'b', moves: true }),
      item('exception', { occurrence_id: 'c' }),
      item('outside_series', { occurrence_id: 'd' }),
      item('started', { occurrence_id: 'e', moves_to: null }),
    ],
  }

  it('counts each decision; the sessions that move without problems are the rest', () => {
    const counts = decisionCounts(preview, {
      a: { kind: 'move_anyway' },
      b: { kind: 'keep' },
      c: { kind: 'move_to', at: '2027-05-07T08:00:00Z' },
      d: { kind: 'skip' },
    })
    expect(counts).toEqual({ move: 53, anyway: 1, kept: 1, rescheduled: 1, skipped: 1 })
    expect(decisionSummary(counts)).toBe(
      '53 move · 1 moved anyway · 1 kept · 1 rescheduled · 1 skipped',
    )
    expect(decisionSummary(decisionCounts(preview, { c: { kind: 'with_series' } }))).toBe('54 move')
  })

  it('sends a decision per session that offers one, a picked time with it', () => {
    expect(
      decisionsBody(preview.items, {
        a: { kind: 'move_anyway' },
        c: { kind: 'move_to', at: '2027-05-07T08:00:00Z' },
      }),
    ).toEqual({ decisions: { a: 'move_anyway', c: 'move_to:2027-05-07T08:00:00Z' } })
  })

  it('labels the series slot by weekday and time', () => {
    expect(slotLabel('2026-11-25T19:30:00Z', ZONE)).toBe('Wednesday 20:30')
  })
})
