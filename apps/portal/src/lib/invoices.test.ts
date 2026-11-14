import { portalInvoices } from '@/mocks/portal'

import { byUrgency, isOpen, sumByCurrency } from './invoices'
import type { PortalInvoice } from './portal'

const base = portalInvoices[0] as PortalInvoice
const invoice = (fields: Partial<PortalInvoice>): PortalInvoice => ({ ...base, ...fields })

test('isOpen needs status open and something left to pay', () => {
  expect(isOpen(invoice({ status: 'open', amount_due: '0.05' }))).toBe(true)
  expect(isOpen(invoice({ status: 'open', amount_due: '0.00' }))).toBe(false)
  expect(isOpen(invoice({ status: 'paid', amount_due: '0.00' }))).toBe(false)
  expect(isOpen(invoice({ status: 'void', amount_due: '10.00' }))).toBe(false)
})

test('sumByCurrency adds exactly in minor units and drops zero or negative sums', () => {
  const sums = sumByCurrency(
    [
      invoice({ currency: 'CHF', amount_due: '0.10' }),
      invoice({ currency: 'CHF', amount_due: '0.20' }),
      invoice({ currency: 'EUR', amount_due: '50.50' }),
      invoice({ currency: 'USD', amount_due: '-5.00' }),
      invoice({ currency: 'GBP', amount_due: '0.00' }),
    ],
    (i) => i.amount_due,
  )
  expect(sums).toEqual([
    ['CHF', '0.30'],
    ['EUR', '50.50'],
  ])
})

test('byUrgency keeps open invoices, overdue first, then the nearest due date, undated last', () => {
  const list = [
    invoice({ id: 'later', number: '4', due_date: '2026-12-20' }),
    invoice({ id: 'paid', number: '5', status: 'paid', amount_due: '0.00' }),
    invoice({ id: 'undated', number: '6', due_date: null }),
    invoice({ id: 'soon', number: '3', due_date: '2026-11-12' }),
    invoice({ id: 'overdue', number: '2', due_date: '2026-11-01', is_overdue: true }),
  ]
  expect(byUrgency(list).map((i) => i.id)).toEqual(['overdue', 'soon', 'later', 'undated'])
})
