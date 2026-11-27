import { describe, expect, it } from 'vitest'

import type { InvoiceListItem } from '@/lib/invoices'
import { scheduledInvoice } from '@/mocks/data'

import { moneyGroups, totalsByCurrency, fitRows } from './attention-groups'

const NOW = '2026-11-27'
const invoice = (patch: Partial<InvoiceListItem>): InvoiceListItem => ({
  ...scheduledInvoice,
  open_instalments: [],
  refund_due: '0.00',
  is_overdue: false,
  currency: 'CHF',
  ...patch,
})

describe('moneyGroups', () => {
  it('puts each invoice in one group, the most urgent first', () => {
    const groups = moneyGroups(
      [
        invoice({ id: 'late-2', due_date: '2026-11-20', is_overdue: true, amount_due: '20.00' }),
        invoice({ id: 'late-1', due_date: '2026-10-01', is_overdue: true, amount_due: '10.00' }),
        invoice({ id: 'soon', due_date: '2026-12-05', amount_due: '30.00' }),
        invoice({ id: 'later', due_date: '2027-01-30', amount_due: '40.00' }),
        invoice({ id: 'refund', is_overdue: true, refund_due: '15.00' }),
      ],
      NOW,
    )
    expect(groups.overdue.map((r) => r.invoice.id)).toEqual(['late-1', 'late-2'])
    expect(groups.dueSoon.map((r) => r.invoice.id)).toEqual(['soon'])
    expect(groups.refunds.map((r) => [r.invoice.id, r.amount])).toEqual([['refund', '15.00']])
    expect(groups.instalments).toEqual([])
  })

  it('lists every overdue instalment, else the next one only while it is due soon', () => {
    const groups = moneyGroups(
      [
        invoice({
          id: 'a',
          open_instalments: [
            { seq: 1, due_date: '2026-10-01', open: '65.00', is_overdue: true },
            { seq: 2, due_date: '2026-11-01', open: '100.00', is_overdue: true },
            { seq: 3, due_date: '2026-12-01', open: '416.00', is_overdue: false },
          ],
        }),
        invoice({
          id: 'b',
          open_instalments: [{ seq: 1, due_date: '2026-12-03', open: '50.00', is_overdue: false }],
        }),
        invoice({
          id: 'c',
          open_instalments: [{ seq: 1, due_date: '2027-03-01', open: '50.00', is_overdue: false }],
        }),
      ],
      NOW,
    )
    expect(
      groups.instalments.map((r) => `${r.invoice.id}${r.instalment?.seq}:${r.amount}`),
    ).toEqual(['a1:65.00', 'a2:100.00', 'b1:50.00'])
    expect(groups.dueSoon).toEqual([])
  })

  it('keeps an overdue invoice whose next instalment is far off', () => {
    const groups = moneyGroups(
      [
        invoice({
          id: 'late',
          is_overdue: true,
          open_instalments: [{ seq: 2, due_date: '2027-03-01', open: '50.00', is_overdue: false }],
        }),
      ],
      NOW,
    )
    expect(groups.instalments.map((r) => r.invoice.id)).toEqual(['late'])
  })
})

describe('totalsByCurrency', () => {
  it('sums exactly per currency, the largest first', () => {
    const rows = moneyGroups(
      [
        invoice({ id: '1', is_overdue: true, amount_due: '0.10' }),
        invoice({ id: '2', is_overdue: true, amount_due: '0.20' }),
        invoice({ id: '3', is_overdue: true, amount_due: '5.00', currency: 'EUR' }),
      ],
      NOW,
    ).overdue
    expect(totalsByCurrency(rows)).toEqual([
      { currency: 'EUR', amount: '5.00' },
      { currency: 'CHF', amount: '0.30' },
    ])
    expect(totalsByCurrency([])).toEqual([])
  })
})

describe('fitRows', () => {
  it('shows up to three rows a group while they fit, the first groups first', () => {
    expect(fitRows([5, 6, 2], 99)).toEqual([3, 3, 2])
    expect(fitRows([5, 6, 2], 5)).toEqual([2, 2, 1])
    expect(fitRows([5, 6, 2], 6)).toEqual([2, 2, 2])
    expect(fitRows([5, 6, 2], 7)).toEqual([3, 2, 2])
  })
  it('keeps one row per group when nothing more fits', () => {
    expect(fitRows([5, 6, 2], 0)).toEqual([1, 1, 1])
    expect(fitRows([5, 6, 2], -4)).toEqual([1, 1, 1])
    expect(fitRows([], 4)).toEqual([])
  })
})
