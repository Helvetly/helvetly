import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeOrder, readColumnSizes, writeColumnSizes } from './table-storage'

describe('stored sizes', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips and drops unknown or broken entries', () => {
    writeColumnSizes('t', { number: 120.37 })
    expect(readColumnSizes('t', ['number', 'total'])).toEqual({ number: 120 })
    localStorage.setItem('helvetly.table.t.columns.v2', '{"number":-1,"total":"x","gone":90}')
    expect(readColumnSizes('t', ['number', 'total'])).toEqual({})
    localStorage.setItem('helvetly.table.t.columns.v2', 'not json')
    expect(readColumnSizes('t', ['number'])).toEqual({})
  })

  it('removes the entry on reset', () => {
    writeColumnSizes('t', { number: 120 })
    writeColumnSizes('t', {})
    expect(localStorage.getItem('helvetly.table.t.columns.v2')).toBeNull()
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writeColumnSizes('t', { number: 1 })).not.toThrow()
  })
})

describe('column order', () => {
  it('keeps the stored order, drops unknown ids and puts new ones in their default place', () => {
    expect(mergeOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(mergeOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
    expect(mergeOrder(['c', 'gone', 'a', 'c'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
    expect(mergeOrder(['b', 'a'], ['new', 'a', 'b'])).toEqual(['new', 'b', 'a'])
  })
})
