import { sampleQuote } from '@/mocks/quotes'
import { sampleSchedule, sampleSettings } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { emptyQuoteValues, previewInput, toQuoteInput, valuesFromQuote } from './quote-model'

const settings = sampleSettings()

test('a new quote is valid for 30 days and takes the client’s currency and language', () => {
  const values = emptyQuoteValues(settings, sampleClient({ currency: 'EUR', language: 'fr' }))
  expect(values.client_id).toBe('cli_1')
  expect(values.currency).toBe('EUR')
  expect(values.language).toBe('fr')
  expect(Date.parse(values.valid_until) - Date.parse(values.issue_date)).toBe(30 * 86_400_000)
})

test('a saved quote round-trips into exactly the fields the API takes', () => {
  const quote = sampleQuote({ reference: 'PO 7', note: 'Internal', discount_percent: '5.00' })
  const { input, errors } = toQuoteInput(valuesFromQuote(quote, settings))
  expect(errors).toEqual({})
  expect(Object.keys(input).toSorted()).toEqual(
    [
      'client_id',
      'currency',
      'discount_percent',
      'footer',
      'instalments',
      'intro',
      'issue_date',
      'language',
      'lines',
      'note',
      'reference',
      'valid_until',
      'vat_mode',
    ].toSorted(),
  )
  expect(input).toMatchObject({
    client_id: 'cli_1',
    valid_until: '2026-12-03',
    reference: 'PO 7',
    note: 'Internal',
    discount_percent: '5',
  })
  expect(input.lines?.map((line) => [line.description, line.quantity, line.unit_price])).toEqual([
    ['Brand workshop', '8', '180.00'],
    ['Logo design', '6', '150.00'],
  ])
})

test('a quote valid before its date and a bad number are caught before saving', () => {
  const values = valuesFromQuote(sampleQuote({ valid_until: '2026-11-01' }), settings)
  const first = values.lines[0]
  if (!first) throw new Error('The sample quote has lines.')
  first.quantity = 'abc'
  const { errors } = toQuoteInput(values)
  expect(errors.valid_until).toMatch(/on or after/)
  expect(errors[`${first.key}.quantity`]).toBeDefined()
})

test('a quote without lines still offers one to type into, and the preview sends it', () => {
  const values = valuesFromQuote(sampleQuote({ lines: [] }), settings)
  expect(values.lines).toHaveLength(1)
  expect(previewInput(values).lines).toHaveLength(1)
  expect(toQuoteInput(values).input.lines).toEqual([])
})

test('a quote’s schedule round-trips: typed rows as they are, none as null', () => {
  const quote = sampleQuote({ instalments: sampleSchedule() })
  const values = valuesFromQuote(quote, settings)
  expect(values.instalments).toEqual({
    count: '3',
    interval: 'monthly',
    first_due_date: '2026-12-01',
    items: [
      { due_date: '2026-12-01', amount: '360.35' },
      { due_date: '2027-01-01', amount: '360.35' },
      { due_date: '2027-02-01', amount: '360.30' },
    ],
  })
  expect(toQuoteInput(values).input.instalments).toEqual({
    count: 3,
    interval: 'monthly',
    first_due_date: '2026-12-01',
    items: [
      { due_date: '2026-12-01', amount: '360.35' },
      { due_date: '2027-01-01', amount: '360.35' },
      { due_date: '2027-02-01', amount: '360.30' },
    ],
  })
  expect(previewInput(values).instalments).toEqual({
    count: 3,
    interval: 'monthly',
    first_due_date: '2026-12-01',
  })
  expect(toQuoteInput(valuesFromQuote(sampleQuote(), settings)).input.instalments).toBeNull()
})
