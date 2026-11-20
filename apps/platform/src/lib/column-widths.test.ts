import { afterEach, describe, expect, it, vi } from 'vitest'

import { columnWidthsKey, readColumnWidths, writeColumnWidths } from './column-widths'

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
