import { describe, expect, it } from 'vitest'

import { fitColumns, type DataColumn } from './data-table'

const column = (id: string, extra: Partial<DataColumn<unknown>> = {}): DataColumn<unknown> => ({
  id,
  header: id,
  cell: () => null,
  ...extra,
})

const COLUMNS = [
  column('select'),
  column('name', { flex: true }),
  column('date', { size: 120 }),
  column('actions'),
]
const total = (sizes: Record<string, number>) =>
  52 + 48 + Object.entries(sizes).reduce((sum, [, width]) => sum + width, 0)

describe('fitColumns', () => {
  it('shares the room beyond the defaults by default width, the flexible column twice', () => {
    // 52 + 240 + 120 + 48 = 460 used; 600 more: name weighs 480, date 120.
    const sizes = fitColumns(COLUMNS, {}, 1060)
    expect(sizes).toEqual({ name: 720, date: 240 })
    expect(total(sizes)).toBe(1060)
  })

  it('gives what rounding leaves to the flexible column', () => {
    const sizes = fitColumns(COLUMNS, {}, 1061)
    expect(total(sizes)).toBe(1061)
  })

  it('keeps stored widths and fills with the rest', () => {
    expect(fitColumns(COLUMNS, { date: 200 }, 1060)).toEqual({ date: 200, name: 760 })
  })

  it('shrinks only the flexible column, down to its minimum, when short of room', () => {
    expect(fitColumns(COLUMNS, {}, 400)).toEqual({ name: 180, date: 120 })
    expect(fitColumns(COLUMNS, {}, 0)).toEqual({ name: 160, date: 120 })
  })

  it('leaves stored widths alone when every column has one', () => {
    const stored = { name: 300, date: 100 }
    expect(fitColumns(COLUMNS, stored, 2000)).toBe(stored)
  })
})
