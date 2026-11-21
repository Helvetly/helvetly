import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  columnWidthsKey,
  readColumnWidths,
  resizeWidths,
  solveWidths,
  writeColumnWidths,
  type SizedColumn,
} from './column-widths'

const columns = ['number', 'client', 'total']

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('column widths storage', () => {
  it('reads back what was written', () => {
    writeColumnWidths('invoices', columns, { number: 150, client: 320 })
    expect(readColumnWidths('invoices', columns)).toEqual({ number: 150, client: 320 })
  })

  it('removes the entry when nothing is left', () => {
    writeColumnWidths('invoices', columns, { number: 150 })
    writeColumnWidths('invoices', columns, {})
    expect(localStorage.getItem(columnWidthsKey('invoices'))).toBeNull()
  })

  it.each([
    ['another column set', JSON.stringify({ columns: 'number,client', widths: { number: 150 } })],
    ['broken JSON', '{"columns":'],
    ['an array', '[150]'],
    ['no widths', JSON.stringify({ columns: columns.join(',') })],
  ])('ignores %s', (_, value) => {
    localStorage.setItem(columnWidthsKey('invoices'), value)
    expect(readColumnWidths('invoices', columns)).toEqual({})
  })

  it('keeps only known columns with positive, finite widths', () => {
    localStorage.setItem(
      columnWidthsKey('invoices'),
      JSON.stringify({
        columns: columns.join(','),
        widths: { number: 150, client: -4, total: '90', status: 120 },
      }),
    )
    expect(readColumnWidths('invoices', columns)).toEqual({ number: 150 })
  })

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeColumnWidths('invoices', columns, { number: 150 })).not.toThrow()
    expect(readColumnWidths('invoices', columns)).toEqual({})
  })
})

const sized: SizedColumn[] = [
  { id: 'select', natural: 40, min: 36, max: 40, resizable: false },
  { id: 'number', natural: 76, min: 60, max: 640, resizable: true },
  { id: 'name', natural: 0, min: 160, max: 1600, resizable: true },
  { id: 'type', natural: 110, min: 90, max: 640, resizable: true },
  { id: 'status', natural: 100, min: 96, max: 100, resizable: false },
]
const fill = (widths: Record<string, number>) =>
  Object.values(widths).reduce((sum, width) => sum + width, 0)

describe('solveWidths', () => {
  it('gives the flexible column the rest of the row', () => {
    const widths = solveWidths(sized, 'name', 1000, {})
    expect(widths).toEqual({ select: 40, number: 76, name: 674, type: 110, status: 100 })
    expect(fill(widths)).toBe(1000)
  })

  it('keeps every column at its minimum, stored widths below it included, and scrolls', () => {
    const widths = solveWidths(sized, 'name', 300, { number: 10, type: 20 })
    expect(widths).toEqual({ select: 40, number: 60, name: 160, type: 90, status: 100 })
    expect(fill(widths)).toBeGreaterThan(300)
  })

  it('caps stored widths at the maximum', () => {
    expect(solveWidths(sized, 'name', 1000, { type: 5000 }).type).toBe(640)
  })

  it('keeps a dragged flexible width as its least, scrolling past the box', () => {
    expect(solveWidths(sized, 'name', 1000, { name: 900 }).name).toBe(900)
    expect(solveWidths(sized, 'name', 1000, { name: 300 }).name).toBe(674)
  })

  it('ignores widths stored for columns that are not resizable or not shown', () => {
    expect(solveWidths(sized, 'name', 1000, { status: 300, tags: 200 })).toEqual(
      solveWidths(sized, 'name', 1000, {}),
    )
  })
})

describe('resizeWidths', () => {
  it('sizes a column within its range', () => {
    expect(resizeWidths(sized, 'name', 1000, {}, 'type', 20)).toEqual({ type: 90 })
    expect(resizeWidths(sized, 'name', 1000, {}, 'type', 9000)).toEqual({ type: 640 })
  })

  it('shrinks the flexible column by giving its neighbour the room: the row stays full', () => {
    const stored = resizeWidths(sized, 'name', 1000, {}, 'name', 474)
    expect(stored).toEqual({ type: 310 })
    const widths = solveWidths(sized, 'name', 1000, stored)
    expect(widths.name).toBe(474)
    expect(fill(widths)).toBe(1000)
  })

  it('stops the flexible column at its minimum', () => {
    const widths = solveWidths(
      sized,
      'name',
      1000,
      resizeWidths(sized, 'name', 1000, {}, 'name', 0),
    )
    expect(widths.name).toBe(160)
    expect(fill(widths)).toBe(1000)
  })

  it('takes the column before when none follows', () => {
    const last = sized.filter((column) => column.id !== 'type')
    expect(resizeWidths(last, 'name', 1000, {}, 'name', 684)).toEqual({ number: 176 })
  })

  it('shares the room among the columns after it, in proportion', () => {
    const wider: SizedColumn[] = [
      ...sized,
      { id: 'city', natural: 220, min: 60, max: 640, resizable: true },
    ]
    const stored = resizeWidths(wider, 'name', 1000, {}, 'name', 334)
    expect(stored).toEqual({ type: 150, city: 300 })
    const widths = solveWidths(wider, 'name', 1000, stored)
    expect(widths.name).toBe(334)
    expect(fill(widths)).toBe(1000)
  })

  it('widens the flexible column past the box, then narrows it back without a gap', () => {
    const wide = resizeWidths(sized, 'name', 1000, {}, 'name', 900)
    expect(wide).toEqual({ name: 900 })
    const back = resizeWidths(sized, 'name', 1000, wide, 'name', 700)
    expect(back).toEqual({ name: 700 })
    expect(fill(solveWidths(sized, 'name', 1000, back))).toBe(1026)
    const narrow = resizeWidths(sized, 'name', 1000, back, 'name', 600)
    expect(narrow).toEqual({ type: 184 })
    expect(fill(solveWidths(sized, 'name', 1000, narrow))).toBe(1000)
  })

  it('leaves an unknown column alone', () => {
    expect(resizeWidths(sized, 'name', 1000, { type: 120 }, 'tags', 200)).toEqual({ type: 120 })
  })
})
