import { describe, expect, it } from 'vitest'

import type { ImportRecord } from '@/lib/imports'

import { importedMonthsToClose } from './close-imported-months'

const invoice = (
  data: ImportRecord['data'],
  kind: ImportRecord['kind'] = 'invoices',
): ImportRecord => ({
  id: 'rec',
  file_id: 'file',
  kind,
  status: 'created',
  data: { issued_elsewhere: true, ...data },
  issues: {},
  duplicate: null,
  entity_id: 'inv',
  error: null,
})

describe('importedMonthsToClose', () => {
  it('spans the imported history without gaps, skipping closed months', () => {
    const records = [
      invoice({ issue_date: '2024-03-19', due_date: '2024-03-26', paid_amount: '1407.60' }),
      invoice({ issue_date: '2024-06-02' }),
    ]
    expect(importedMonthsToClose(records, new Set(['2024-04']), '2026-11-18')).toEqual([
      '2024-03',
      '2024-05',
      '2024-06',
    ])
  })

  it('books a payment without a date on the due date, an instalment on its own', () => {
    const records = [
      invoice({ issue_date: '2024-01-10', due_date: '2024-02-10', paid_amount: '10' }),
      invoice({
        issue_date: '2024-01-10',
        instalments: [
          { amount: '5', due_date: '2024-04-01', paid: true },
          { amount: '5', due_date: '2024-09-01', paid: false },
        ],
      }),
    ]
    expect(importedMonthsToClose(records, new Set(), '2026-11-18')).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
    ])
  })

  it('never offers the current month, drafts or other kinds', () => {
    const records = [
      invoice({ issue_date: '2026-11-02' }),
      invoice({ issue_date: '2024-01-10', issued_elsewhere: false }),
      invoice({ issue_date: '2024-01-10' }, 'expenses'),
    ]
    expect(importedMonthsToClose(records, new Set(), '2026-11-18')).toEqual([])
  })
})
