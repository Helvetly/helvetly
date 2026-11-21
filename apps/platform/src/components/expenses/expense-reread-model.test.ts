import type { Expense, ReceiptSuggestions } from '@/lib/expenses'
import { expense as storyExpense } from '@/stories/pages/api'

import { toInput, valuesFromExpense } from './expense-form-model'
import { applyReread, rereadRows, type RereadField } from './expense-reread-model'

const options = { registered: true, currencyOk: (code: string) => code === 'CHF' || code === 'EUR' }

const reading = (more: Partial<ReceiptSuggestions> = {}): ReceiptSuggestions => ({
  supplier: { name: 'SBB CFF FFS', vat_number: null, country: 'CH', iban: null },
  document: { type: 'invoice', number: null, date: '2026-11-04', due_date: null },
  description: 'Zürich–Bern return',
  currency: 'CHF',
  totals: { net: null, vat: null, gross: '184.60' },
  vat_breakdown: [{ rate: '8.1', net: null, vat: null, gross: '184.60' }],
  items: [],
  payment: { status: 'unknown', method: null, paid_on: null },
  reverse_charge: false,
  category: null,
  confidence: {
    supplier: 'high',
    document: 'high',
    totals: 'high',
    vat_breakdown: 'high',
    items: 'high',
    payment: 'high',
  },
  issues: {},
  ...more,
})

const draft = (change: Partial<Expense> = {}) =>
  storyExpense({
    status: 'draft',
    payment_status: 'unpaid',
    paid_on: null,
    payment_method: null,
    ...change,
  })

const rowsFor = (expense: Expense, s: ReceiptSuggestions) =>
  rereadRows(valuesFromExpense(expense), expense, s, options)

test('a reading that says what the draft already has offers nothing', () => {
  expect(rowsFor(draft(), reading())).toEqual([])
})

test.each<{
  name: string
  expense: Partial<Expense>
  s: Partial<ReceiptSuggestions>
  rows: { field: RereadField; empty: boolean }[]
}>([
  {
    name: 'an empty field is offered checked, a changed one unchecked',
    expense: { reference: null, supplier_name: 'SBB' },
    s: {
      supplier: { name: 'SBB CFF FFS', vat_number: null, country: 'CH', iban: null },
      document: { type: 'invoice', number: 'R-77', date: '2026-11-04', due_date: null },
    },
    rows: [
      { field: 'supplier_name', empty: false },
      { field: 'reference', empty: true },
    ],
  },
  {
    name: 'a null never clears and a malformed date or country is not offered',
    expense: { reference: 'R-1', due_date: null },
    s: {
      supplier: { name: null, vat_number: null, country: 'Switzerland', iban: null },
      document: { type: 'invoice', number: null, date: '4.11.2026', due_date: 'soon' },
    },
    rows: [],
  },
  {
    name: 'a country is compared as a code',
    expense: {},
    s: { supplier: { name: 'SBB CFF FFS', vat_number: null, country: 'de', iban: null } },
    rows: [{ field: 'supplier_country', empty: false }],
  },
  {
    name: 'another category',
    expense: {},
    s: {
      category: {
        id: 'cat_telecom',
        name: 'Telecom',
        account_code: '6510',
        confidence: 0.9,
        reason: null,
      },
    },
    rows: [{ field: 'category_id', empty: false }],
  },
  {
    name: 'other amounts, but not when the server found them disagreeing',
    expense: {},
    s: { vat_breakdown: [{ rate: '8.1', net: null, vat: null, gross: '190.00' }] },
    rows: [{ field: 'amounts', empty: false }],
  },
  {
    name: 'disagreeing amounts are not offered',
    expense: {},
    s: {
      vat_breakdown: [{ rate: '8.1', net: null, vat: null, gross: '190.00' }],
      confidence: {
        supplier: 'high',
        document: 'high',
        totals: 'low',
        vat_breakdown: 'high',
        items: 'high',
        payment: 'high',
      },
    },
    rows: [],
  },
  {
    name: 'a payment the draft does not record yet',
    expense: {},
    s: { payment: { status: 'paid', method: 'card', paid_on: '2026-11-05' } },
    rows: [{ field: 'payment', empty: true }],
  },
])('$name', ({ expense, s, rows }) => {
  expect(rowsFor(draft(expense), reading(s)).map(({ field, empty }) => ({ field, empty }))).toEqual(
    rows,
  )
})

const expenseLine = (id: string, amount: string, vat_rate: string) => ({
  id,
  position: 1,
  description: null,
  amount,
  vat_rate,
  category: null,
  quantity: null,
  unit_price: null,
})

test('amounts in the same lines in another order are the same', () => {
  const expense = draft({
    lines: [expenseLine('a', '10.00', '2.6'), expenseLine('b', '20.00', '8.1')],
  })
  const s = reading({
    vat_breakdown: [
      { rate: '8.1', net: null, vat: null, gross: '20' },
      { rate: '2.60', net: null, vat: null, gross: '10.00' },
    ],
  })
  expect(rowsFor(expense, s)).toEqual([])
})

test('applying changes only the chosen parts', () => {
  const expense = draft({ supplier_name: 'SBB', reference: null, description: 'Old' })
  const s = reading({
    supplier: { name: 'SBB CFF FFS', vat_number: null, country: 'DE', iban: null },
    document: { type: 'invoice', number: 'R-77', date: '2026-11-04', due_date: null },
    description: 'New',
    vat_breakdown: [
      { rate: '8.1', net: null, vat: null, gross: '100.00' },
      { rate: '2.6', net: null, vat: null, gross: '50.00' },
    ],
    payment: { status: 'paid', method: 'twint', paid_on: '2026-11-05' },
    category: {
      id: 'cat_telecom',
      name: 'Telecom',
      account_code: '6510',
      confidence: 1,
      reason: null,
    },
  })
  const values = valuesFromExpense(expense)
  const next = applyReread(
    values,
    s,
    new Set<RereadField>(['reference', 'supplier_country', 'amounts', 'payment']),
    options,
  )
  expect(next.supplier_name).toBe('SBB')
  expect(next.description).toBe('Old')
  expect(next.category_id).toBe('cat_travel')
  expect(next.reference).toBe('R-77')
  // A foreign country takes the input tax with it, as in the form.
  expect(next.supplier_country).toBe('DE')
  expect(next.input_tax).toBe('none')
  expect(next.lines.map((line) => [line.amount, line.vat_rate])).toEqual([
    ['100.00', '8.1'],
    ['50.00', '2.6'],
  ])
  expect(next.entry_mode).toBe('single')
  expect(next).toMatchObject({ paid: true, paid_on: '2026-11-05', payment_method: 'twint' })
  // Everything not chosen goes back to the API as it was.
  const input = toInput(next, { userId: 'usr_1', baseCurrency: 'CHF', booked: false })
  expect(input).toMatchObject({
    supplier_name: 'SBB',
    description: 'Old',
    category_id: 'cat_travel',
  })
})

test('nothing chosen is the draft unchanged', () => {
  const values = valuesFromExpense(draft())
  expect(applyReread(values, reading({ description: 'New' }), new Set(), options)).toBe(values)
})
