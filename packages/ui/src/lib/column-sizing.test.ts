import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  layoutColumns,
  readColumnSizes,
  resizeColumn,
  writeColumnSizes,
  type SizedColumn,
} from './column-sizing'

const COLUMNS: SizedColumn[] = [
  { id: 'number', size: 100, min: 60, max: 200 },
  { id: 'client', size: 200, min: 160, max: 2000, flex: true },
  { id: 'total', size: 140, min: 100, max: 300 },
]

describe('layoutColumns', () => {
  it('gives the flexible column the rest of the box', () => {
    expect(layoutColumns(COLUMNS, 800, {})).toEqual({ number: 100, client: 560, total: 140 })
  })

  it('keeps dragged sizes within each range', () => {
    expect(layoutColumns(COLUMNS, 800, { number: 10, total: 999 })).toEqual({
      number: 60,
      client: 440,
      total: 300,
    })
  })

  it('never squeezes the flexible column below its min', () => {
    expect(layoutColumns(COLUMNS, 300, {}).client).toBe(160)
  })

  it('ignores a stored size of the flexible column', () => {
    expect(layoutColumns(COLUMNS, 800, { client: 50 }).client).toBe(560)
  })
})

describe('resizeColumn', () => {
  it('clamps to the column min and max', () => {
    expect(resizeColumn(COLUMNS, 2000, {}, 'number', 10)).toBe(60)
    expect(resizeColumn(COLUMNS, 2000, {}, 'number', 900)).toBe(200)
  })

  it('stops where the flexible column reaches its min', () => {
    // 800 - total 140 - client min 160 leaves 500, above number's max of 200: use a wide total.
    const wide: SizedColumn[] = COLUMNS.map((column) =>
      column.id === 'number' ? { ...column, max: 1000 } : column,
    )
    expect(resizeColumn(wide, 800, {}, 'number', 900)).toBe(500)
    expect(resizeColumn(wide, 800, { total: 300 }, 'number', 900)).toBe(340)
  })

  it('keeps the min even when the box is too narrow', () => {
    expect(resizeColumn(COLUMNS, 200, {}, 'number', 150)).toBe(60)
  })
})

describe('stored sizes', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips and drops unknown or broken entries', () => {
    writeColumnSizes('t', { number: 120 })
    expect(readColumnSizes('t', ['number', 'total'])).toEqual({ number: 120 })
    localStorage.setItem('helvetly.table.t.columns', '{"number":-1,"total":"x","gone":90}')
    expect(readColumnSizes('t', ['number', 'total'])).toEqual({})
    localStorage.setItem('helvetly.table.t.columns', 'not json')
    expect(readColumnSizes('t', ['number'])).toEqual({})
  })

  it('removes the entry on reset', () => {
    writeColumnSizes('t', { number: 120 })
    writeColumnSizes('t', {})
    expect(localStorage.getItem('helvetly.table.t.columns')).toBeNull()
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writeColumnSizes('t', { number: 1 })).not.toThrow()
  })
})
