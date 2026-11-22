import type { Line } from '@/lib/invoices'
import { sampleQuote } from '@/mocks/quotes'

import { diffLines, diffQuotes, isUnchanged } from './quote-diff'

const line = (position: number, description: string, change: Partial<Line> = {}): Line => ({
  id: `ln_${position}`,
  position,
  description,
  quantity: '1',
  unit: 'hour',
  unit_price: '100.00',
  discount_percent: '0',
  vat_category: 'S',
  vat_rate: '8.1',
  vat_exemption_code: null,
  vat_exemption_reason: null,
  amount: '100.00',
  ...change,
})

test('the same quote is unchanged, decimals compared by value', () => {
  const quote = sampleQuote()
  const again = sampleQuote({
    lines: quote.lines.map((entry) => ({ ...entry, quantity: `${entry.quantity}.00` })),
  })
  const diff = diffQuotes(quote, again)
  expect(isUnchanged(diff)).toBe(true)
  expect(diff.lines.map((entry) => entry.kind)).toEqual(['same', 'same'])
})

test('lines pair by id, then description, then position; the rest is added or removed', () => {
  const before = [
    line(1, 'Workshop'),
    line(2, 'Logo', { id: 'old_logo' }),
    line(3, 'Print run'),
    line(4, 'Hosting'),
  ]
  const after = [
    line(1, 'Workshop', { quantity: '2', amount: '200.00' }),
    line(2, 'Logo', { id: 'new_logo', unit_price: '90.00', discount_percent: '10' }),
    line(3, 'Print run, 500 copies'),
    line(5, 'Support', { id: 'ln_new' }),
  ]
  const diff = diffLines(before, after)
  expect(diff.map((entry) => entry.kind)).toEqual([
    'changed',
    'changed',
    'changed',
    'removed',
    'added',
  ])
  expect(diff[0]).toMatchObject({ kind: 'changed', fields: ['quantity'] })
  expect(diff[1]).toMatchObject({ kind: 'changed', fields: ['unit_price', 'discount_percent'] })
  expect(diff[2]).toMatchObject({ kind: 'changed', fields: ['description'] })
  expect(diff[3]).toMatchObject({ kind: 'removed', line: { description: 'Hosting' } })
  expect(diff[4]).toMatchObject({ kind: 'added', line: { description: 'Support' } })
})

test('a VAT change counts, a removed line sits where it was', () => {
  const diff = diffLines(
    [line(1, 'A'), line(2, 'B', { id: 'b' }), line(3, 'C')],
    [line(1, 'A', { vat_rate: '2.6' }), line(2, 'C', { id: 'c' })],
  )
  expect(diff).toMatchObject([
    { kind: 'changed', fields: ['vat'] },
    { kind: 'removed', line: { description: 'B' } },
    { kind: 'same', line: { description: 'C' } },
  ])
})

test('dates, texts and totals list only what changed', () => {
  const before = sampleQuote({ valid_until: '2026-12-03', intro: 'Hello', footer: null })
  const after = sampleQuote({
    valid_until: '2026-12-31',
    intro: ' Hello ',
    footer: 'Thanks',
    lines: [...before.lines, line(3, 'Extra')],
  })
  const diff = diffQuotes(before, after)
  expect(diff.fields).toEqual([
    { field: 'valid_until', before: '2026-12-03', after: '2026-12-31' },
    { field: 'footer', before: '', after: 'Thanks' },
  ])
  expect(diff.totals.map((entry) => entry.field)).toEqual([
    'subtotal',
    'vat_total',
    'payable_total',
  ])
  expect(isUnchanged(diff)).toBe(false)
})
