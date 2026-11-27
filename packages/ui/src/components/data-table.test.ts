import { readColumnSizes } from '@helvetly/ui/lib/table-storage'
import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DataTable, fitColumns, type DataColumn } from './data-table'

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
  it('gives extra room only to the flexible column', () => {
    const sizes = fitColumns(COLUMNS, {}, 1061)
    expect(sizes).toEqual({ name: 841, date: 120 })
    expect(total(sizes)).toBe(1061)
  })

  it('leaves room when the flexible column is hidden or reaches its maximum', () => {
    const withoutName = COLUMNS.filter(({ id }) => id !== 'name')
    expect(fitColumns(withoutName, {}, 1060)).toEqual({ date: 120 })
    const cappedName = COLUMNS.map((col) => (col.flex ? { ...col, maxSize: 400 } : col))
    expect(fitColumns(cappedName, {}, 1060)).toEqual({ name: 400, date: 120 })
  })

  it('uses the default for a new column beside a stored flexible column', () => {
    expect(fitColumns(COLUMNS, { name: 300 }, 2000)).toEqual({ name: 300, date: 120 })
  })

  it('keeps stored widths and fills with the rest', () => {
    expect(fitColumns(COLUMNS, { date: 200 }, 1060)).toEqual({ date: 200, name: 760 })
  })

  it('shrinks only the flexible column, down to its minimum, when short of room', () => {
    expect(fitColumns(COLUMNS, {}, 400)).toEqual({ name: 180, date: 120 })
    expect(fitColumns(COLUMNS, {}, 0)).toEqual({ name: 160, date: 120 })
  })

  it('leaves stored widths alone when every column has one', () => {
    const stored = { name: 300, date: 64 }
    expect(fitColumns(COLUMNS, stored, 2000)).toBe(stored)
  })
})

it('stores the last data column at its minimum after dragging past it', () => {
  const id = 'minimum-width-test'
  render(createElement(DataTable, { id, columns: COLUMNS, data: [], getRowId: () => '' }))
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize date' }), { clientX: 250 })
  fireEvent.mouseMove(document, { clientX: 0 })
  fireEvent.mouseUp(document, { clientX: 0 })
  expect(readColumnSizes(id, ['date'])).toEqual({ date: 64 })
})

it('keeps unchanged cells when the table updates and redraws edited rows', () => {
  type Row = { id: string; name: string }
  const cell = vi.fn<(row: Row) => string>((row) => row.name)
  const columns = [{ id: 'name', header: 'Name', cell }]
  const data = [{ id: 'one', name: 'Original' }]
  const props = { id: 'cell-test', columns, data, getRowId: (row: Row) => row.id }
  const view = render(createElement(DataTable<Row>, props))
  expect(screen.getByText('Original')).toBeTruthy()
  cell.mockClear()
  view.rerender(createElement(DataTable<Row>, { ...props, pending: true }))
  expect(cell).not.toHaveBeenCalled()
  view.rerender(createElement(DataTable<Row>, { ...props, data: [{ id: 'one', name: 'Edited' }] }))
  expect(screen.getByText('Edited')).toBeTruthy()
  expect(cell).toHaveBeenCalled()
})
