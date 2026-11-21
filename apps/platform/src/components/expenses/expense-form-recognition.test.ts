import type { ReceiptSuggestions } from '@/lib/expenses'

import { emptyValues } from './expense-form-model'
import { applyRecognition } from './expense-form-recognition'

type Flat = Partial<
  Record<
    | 'supplier_name'
    | 'supplier_vat_number'
    | 'supplier_country'
    | 'reference'
    | 'description'
    | 'document_date'
    | 'due_date'
    | 'currency'
    | 'amount'
    | 'vat_rate'
    | 'amount_2'
    | 'vat_rate_2',
    string | null
  >
>
/** A v2 reading from the flat fields the tests speak in: each amount and rate is one band of the breakdown. */
const suggest = (f: Flat, more: Partial<ReceiptSuggestions> = {}): ReceiptSuggestions => ({
  supplier: {
    name: f.supplier_name ?? null,
    vat_number: f.supplier_vat_number ?? null,
    country: f.supplier_country ?? null,
    iban: null,
  },
  document: {
    type: null,
    number: f.reference ?? null,
    date: f.document_date ?? null,
    due_date: f.due_date ?? null,
  },
  description: f.description ?? null,
  currency: f.currency ?? null,
  totals: { net: null, vat: null, gross: null },
  vat_breakdown: [
    [f.amount, f.vat_rate],
    [f.amount_2, f.vat_rate_2],
  ]
    .filter(([amount, rate]) => amount != null || rate != null)
    .map(([gross, rate]) => ({ rate: rate ?? null, net: null, vat: null, gross: gross ?? null })),
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

test('fills one line per rate of a three-rate breakdown', () => {
  const { values } = run(
    blank(),
    new Set(),
    suggest(
      { currency: 'CHF' },
      {
        vat_breakdown: [
          { rate: '8.1', net: '100.00', vat: '8.10', gross: '108.10' },
          { rate: '2.6', net: '100.00', vat: '2.60', gross: '102.60' },
          { rate: '3.8', net: '100.00', vat: '3.80', gross: '103.80' },
        ],
      },
    ),
  )
  expect(values.lines.map(({ amount, vat_rate }) => [amount, vat_rate])).toEqual([
    ['108.10', '8.1'],
    ['102.60', '2.6'],
    ['103.80', '3.8'],
  ])
})

test('figures the server found disagreeing, or a reverse charge, fill no amounts', () => {
  const amounts = { currency: 'CHF', amount: '10.00', vat_rate: '8.1' }
  const base = suggest(amounts)
  for (const more of [
    { confidence: { ...base.confidence, totals: 'low' as const } },
    { confidence: { ...base.confidence, vat_breakdown: 'low' as const } },
    { reverse_charge: true },
  ]) {
    const start = blank()
    const result = run(start, new Set(), suggest(amounts, more))
    expect(result.values).toBe(start)
    expect(result.applied).toEqual([])
  }
})

test('fills the payment of a paid receipt unless the person set it', () => {
  const paid = suggest(
    { document_date: '2026-03-01' },
    {
      document: { type: 'receipt', number: null, date: '2026-03-01', due_date: null },
      payment: { status: 'paid', method: 'card', paid_on: null },
    },
  )
  const filled = run(blank(), new Set(), paid)
  expect(filled.values).toMatchObject({ paid: true, paid_on: '2026-03-01', payment_method: 'card' })
  expect(filled.applied).toContain('payment')
  const kept = run(blank(), new Set(['payment_method']), paid)
  expect(kept.values.paid).toBe(false)
  expect(kept.kept).toContain('payment')
  // An invoice that says paid without a date is not given one.
  const undated = run(
    blank(),
    new Set(),
    suggest({}, { payment: { status: 'paid', method: null, paid_on: null } }),
  )
  expect(undated.applied).toEqual([])
})

test('fills the category and marks an unsure one, low-confidence parts too', () => {
  const category = {
    id: 'exc_1',
    name: 'Telecom',
    account_code: '6510',
    confidence: 0.4,
    reason: null,
  }
  const base = suggest({ supplier_name: 'Swisscom' })
  const { values, applied, uncertain } = run(
    blank(),
    new Set(),
    suggest(
      { supplier_name: 'Swisscom' },
      { category, confidence: { ...base.confidence, supplier: 'low' } },
    ),
  )
  expect(values.category_id).toBe('exc_1')
  expect(applied).toEqual(['supplier_name', 'category_id'])
  expect(uncertain).toEqual(['supplier_name', 'category_id'])
  const sure = run(blank(), new Set(), suggest({}, { category: { ...category, confidence: 0.9 } }))
  expect(sure.uncertain).toEqual([])
  const chosen = run(
    { ...blank(), category_id: 'exc_2' },
    new Set(['category_id']),
    suggest({}, { category }),
  )
  expect(chosen.values.category_id).toBe('exc_2')
  expect(chosen.kept).toEqual(['category_id'])
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
