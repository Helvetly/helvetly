import { describe, expect, test } from 'vitest'

import { nextSort, parseSort, sortParam, sortRows, type Sort } from './list-sort'

const FIELDS = ['number', 'client', 'total'] as const
type Field = (typeof FIELDS)[number]
const FALLBACK: Sort<Field> = { field: 'number', desc: true }

describe('parseSort', () => {
  test.each([
    ['client', { field: 'client', desc: false }],
    ['-total', { field: 'total', desc: true }],
    ['nope', FALLBACK],
    ['-', FALLBACK],
    [null, FALLBACK],
  ])('reads %s', (value, want) => {
    expect(parseSort(value, FIELDS, FALLBACK)).toEqual(want)
  })
})

test('sortParam leaves the default out of the URL', () => {
  expect(sortParam(FALLBACK, FALLBACK)).toBeNull()
  expect(sortParam({ field: 'number', desc: false }, FALLBACK)).toBe('number')
  expect(sortParam({ field: 'total', desc: true }, FALLBACK)).toBe('-total')
})

test('nextSort flips the sorted column and starts another in its own direction', () => {
  expect(nextSort(FALLBACK, 'number', false)).toEqual({ field: 'number', desc: false })
  expect(nextSort(FALLBACK, 'client', false)).toEqual({ field: 'client', desc: false })
  expect(nextSort(FALLBACK, 'total', true)).toEqual({ field: 'total', desc: true })
})

describe('sortRows', () => {
  const rows = [
    { id: 'a', name: 'beta', n: 10 },
    { id: 'b', name: 'Alpha', n: 9 },
    { id: 'c', name: '', n: null },
    { id: 'd', name: 'alpha', n: 9 },
  ]
  const ids = (list: typeof rows) => list.map((row) => row.id)

  test('text ignores case and keeps equal rows in their order', () => {
    expect(ids(sortRows(rows, (row) => row.name, false))).toEqual(['b', 'd', 'a', 'c'])
  })
  test('descending reverses the values, not the empty ones or the ties', () => {
    expect(ids(sortRows(rows, (row) => row.name, true))).toEqual(['a', 'b', 'd', 'c'])
    expect(ids(sortRows(rows, (row) => row.n, true))).toEqual(['a', 'b', 'd', 'c'])
  })
  test('numbers by size, numbers in text as people read them', () => {
    expect(ids(sortRows(rows, (row) => row.n, false))).toEqual(['b', 'd', 'a', 'c'])
    const numbered = [
      { id: 'x', name: 'Q-10' },
      { id: 'y', name: 'Q-9' },
    ]
    expect(sortRows(numbered, (row) => row.name, false).map((row) => row.id)).toEqual(['y', 'x'])
  })
  test('does not change the list it was given', () => {
    const copy = [...rows]
    sortRows(rows, (row) => row.name, false)
    expect(rows).toEqual(copy)
  })
})
