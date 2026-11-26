import { describe, expect, it } from 'vitest'

import { editorLinesOf, importLinesOf, instalmentsOf } from './invoice-record-editor'

it('keeps a past due instalment open and reads an explicit payment date', () => {
  expect(
    instalmentsOf({
      instalments: [
        { due_date: '2024-01-31', amount: '100.00', paid: false },
        { due_date: '2024-02-29', amount: '100.00', paid_on: '2024-02-27' },
      ],
    }),
  ).toMatchObject([
    { due_date: '2024-01-31', paid: false, paid_on: '' },
    { due_date: '2024-02-29', paid: true, paid_on: '2024-02-27' },
  ])
})

describe('invoice record lines', () => {
  it('reads the document lines into editor rows and back, unchanged', () => {
    const data = {
      lines: [
        {
          description: 'Website care',
          quantity: '10',
          unit: 'hour',
          unit_price: '120.00',
          discount_percent: '5',
          vat_category: 'S',
          vat_rate: '8.1',
        },
      ],
    }
    expect(importLinesOf(editorLinesOf(data, 'exclusive', '8.1'))).toEqual([
      {
        description: 'Website care',
        quantity: '10',
        unit: 'hour',
        unit_price: '120.00',
        discount_percent: '5',
        vat_category: 'S',
        vat_rate: '8.1',
      },
    ])
  })

  it('fills what the document left out from the workspace and drops an unknown unit', () => {
    const [line] = editorLinesOf(
      { lines: [{ description: 'Setup', unit: 'box', unit_price: '50' }] },
      'exclusive',
      '8.1',
    )
    expect(line).toMatchObject({ quantity: '1', unit: null, vat_category: 'S', vat_rate: '8.1' })
  })

  it('sends no blank rows', () => {
    const lines = editorLinesOf({ lines: [{ description: '', unit_price: '' }] }, 'none', '8.1')
    expect(importLinesOf(lines)).toEqual([])
  })
})
