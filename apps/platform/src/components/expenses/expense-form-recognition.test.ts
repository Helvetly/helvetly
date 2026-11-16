import type { ReceiptSuggestions } from '@/lib/expenses'

import { emptyValues } from './expense-form-model'
import { applyRecognition } from './expense-form-recognition'

const none: ReceiptSuggestions['fields'] = {
  supplier_name: null,
  supplier_vat_number: null,
  supplier_country: null,
  reference: null,
  description: null,
  document_date: null,
  due_date: null,
  currency: null,
  amount: null,
  vat_rate: null,
  amount_2: null,
  vat_rate_2: null,
}
const suggest = (fields: Partial<ReceiptSuggestions['fields']>): ReceiptSuggestions => ({
  fields: { ...none, ...fields },
  issues: {},
})
const options = {
  registered: true,
  countrySaved: false,
  currencyOk: (code: string) => ['CHF', 'EUR'].includes(code),
}
const blank = () => emptyValues('CHF', '8.1', true)
const run = (
  current: ReturnType<typeof blank>,
  touched: Set<string>,
  suggestions: ReceiptSuggestions,
  initial = blank(),
  extra: Partial<typeof options> = {},
) => applyRecognition(current, initial, touched, suggestions, { ...options, ...extra })

test('fills untouched fields and the amounts as one group, as gross lines', () => {
  const { values, applied, kept } = run(
    blank(),
    new Set(),
    suggest({
      supplier_name: 'Migros',
      document_date: '2025-03-01',
      currency: 'eur',
      amount: '108,1',
      vat_rate: '8.1',
      amount_2: '5.00',
      vat_rate_2: '2.6',
    }),
  )
  expect(values).toMatchObject({
    supplier_name: 'Migros',
    document_date: '2025-03-01',
    currency: 'EUR',
  })
  expect(values.amount_mode).toBe('gross')
  expect(values.lines.map(({ amount, vat_rate }) => [amount, vat_rate])).toEqual([
    ['108.10', '8.1'],
    ['5.00', '2.6'],
  ])
  expect(applied).toEqual(['supplier_name', 'document_date', 'amounts'])
  expect(kept).toEqual([])
})

test('keeps what the person typed or cleared, even back at its initial value', () => {
  const start = { ...blank(), supplier_name: '' }
  const { values, applied, kept } = run(
    start,
    new Set(['supplier_name']),
    suggest({ supplier_name: 'Migros', reference: 'R-1' }),
  )
  expect(values.supplier_name).toBe('')
  expect(values.reference).toBe('R-1')
  expect(applied).toEqual(['reference'])
  expect(kept).toEqual(['supplier_name'])
})

test('a touched currency, mode or line protects every amount', () => {
  for (const field of ['currency', 'amount_mode', 'lines']) {
    const start = blank()
    const { values, applied, kept } = run(
      start,
      new Set([field]),
      suggest({ currency: 'EUR', amount: '10.00', vat_rate: '8.1' }),
    )
    expect(values).toBe(start)
    expect(applied).toEqual([])
    expect(kept).toEqual(['amounts'])
  }
})

test('incomplete or unusable amounts fill nothing and never default a rate', () => {
  for (const fields of [
    { currency: 'CHF', amount: '10.00' },
    { amount: '10.00', vat_rate: '8.1' },
    { currency: 'CHF', amount: '10.00', vat_rate: '8.1', amount_2: '1.00' },
    { currency: 'JPY', amount: '10.00', vat_rate: '8.1' },
    { currency: 'CHF', amount: '-10.00', vat_rate: '8.1' },
    { currency: 'CHF', amount: 'ten', vat_rate: '8.1' },
    { currency: 'CHF', amount: '10.00', vat_rate: '101' },
  ]) {
    const start = blank()
    const result = run(start, new Set(), suggest(fields))
    expect(result.values).toBe(start)
    expect(result.applied).toEqual([])
  }
})

test('a null suggestion clears nothing and a bad date is ignored', () => {
  const start = { ...blank(), supplier_name: 'Typed', due_date: '2025-01-01' }
  const { values, applied } = run(start, new Set(), suggest({ due_date: 'soon' }))
  expect(values).toEqual(start)
  expect(applied).toEqual([])
})

test('the country sets input tax like the form does, unless the person chose it', () => {
  const free = run(blank(), new Set(), suggest({ supplier_country: 'de' }))
  expect(free.values).toMatchObject({
    supplier_country: 'DE',
    input_tax: 'none',
    deductible_percent: '0',
  })
  const chosen = run(blank(), new Set(['deductible_percent']), suggest({ supplier_country: 'DE' }))
  expect(chosen.values).toMatchObject({
    supplier_country: 'DE',
    input_tax: 'full',
    deductible_percent: '100',
  })
  const kept = run(blank(), new Set(['input_tax']), suggest({ supplier_country: 'DE' }))
  expect(kept.values.supplier_country).toBe('CH')
  expect(kept.kept).toEqual(['supplier_country'])
})

test('a saved country preference survives, even CH; the built-in fallback does not', () => {
  const germany = {
    ...blank(),
    supplier_country: 'DE',
    input_tax: 'none' as const,
    deductible_percent: '0',
  }
  const saved = run(germany, new Set(), suggest({ supplier_country: 'CH' }), germany, {
    countrySaved: true,
  })
  expect(saved.values).toBe(germany)
  expect(saved.kept).toEqual(['supplier_country'])
  const savedCh = run(blank(), new Set(), suggest({ supplier_country: 'DE' }), blank(), {
    countrySaved: true,
  })
  expect(savedCh.values.supplier_country).toBe('CH')
  expect(savedCh.kept).toEqual(['supplier_country'])
  const fallback = run(blank(), new Set(), suggest({ supplier_country: 'DE' }))
  expect(fallback.values.supplier_country).toBe('DE')
})
