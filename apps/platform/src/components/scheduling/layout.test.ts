import { describe, expect, it } from 'vitest'

import { clipToDay, layoutDay, snapMinutes, type Span } from './layout'

const at = (spans: Span[]) =>
  Object.fromEntries(layoutDay(spans).map(({ id, col, cols }) => [id, [col, cols]]))

describe('layoutDay', () => {
  it.each<[string, Span[], Record<string, [number, number]>]>([
    ['nothing', [], {}],
    ['one block takes the whole width', [{ id: 'a', start: 540, end: 600 }], { a: [0, 1] }],
    [
      'blocks that only touch stay full width',
      [
        { id: 'a', start: 540, end: 600 },
        { id: 'b', start: 600, end: 660 },
      ],
      { a: [0, 1], b: [0, 1] },
    ],
    [
      'two overlapping blocks share the width',
      [
        { id: 'a', start: 540, end: 630 },
        { id: 'b', start: 600, end: 660 },
      ],
      { a: [0, 2], b: [1, 2] },
    ],
    [
      'a chain is one cluster and reuses a freed column',
      [
        { id: 'a', start: 540, end: 600 },
        { id: 'b', start: 570, end: 660 },
        { id: 'c', start: 600, end: 690 },
      ],
      { a: [0, 2], b: [1, 2], c: [0, 2] },
    ],
    [
      'three at once make three columns; a later block starts a new cluster',
      [
        { id: 'a', start: 540, end: 600 },
        { id: 'b', start: 540, end: 600 },
        { id: 'c', start: 550, end: 590 },
        { id: 'd', start: 720, end: 780 },
      ],
      { a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] },
    ],
    [
      'a long block keeps its column under shorter ones',
      [
        { id: 'long', start: 480, end: 720 },
        { id: 'x', start: 500, end: 530 },
        { id: 'y', start: 540, end: 560 },
      ],
      { long: [0, 2], x: [1, 2], y: [1, 2] },
    ],
  ])('%s', (_, spans, expected) => {
    expect(at(spans)).toEqual(expected)
  })

  it('does not depend on the input order', () => {
    const spans: Span[] = [
      { id: 'c', start: 600, end: 690 },
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 660 },
    ]
    expect(at(spans)).toEqual(at(spans.toReversed()))
  })
})

describe('clipToDay', () => {
  it.each([
    ['inside the day', '2026-12-01', 540, '2026-12-01', 600, { start: 540, end: 600 }],
    ['runs past midnight', '2026-12-01', 1380, '2026-12-02', 60, { start: 1380, end: 1440 }],
    ['started the day before', '2026-11-30', 1380, '2026-12-01', 60, { start: 0, end: 60 }],
    ['another day', '2026-12-02', 540, '2026-12-02', 600, null],
    ['ends at midnight', '2026-11-30', 1380, '2026-12-01', 0, null],
  ])('%s', (_, sd, sm, ed, em, expected) => {
    expect(clipToDay(sd, sm, ed, em, '2026-12-01')).toEqual(expected)
  })
})

describe('snapMinutes', () => {
  it.each([
    [0, 0],
    [12, 15],
    [5, 0],
    [48, 60],
    [-30, -30],
  ])('%d px at 48 px an hour is %d minutes', (pixels, minutes) => {
    expect(snapMinutes(pixels, 48)).toBe(minutes)
  })
})
