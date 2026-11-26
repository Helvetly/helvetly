import { createTranslators } from '@helvetly/i18n'
import { expect, it } from 'vitest'

import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import itMessages from '../messages/it.json'
import { automaticOnlyTag, documentTagLabel } from './document-tags'

const translator = createTranslators({ en, de, fr, it: itMessages })

it.each([
  ['en', 'Invoice', 'From quote: sample-7'],
  ['de', 'Rechnung', 'Aus Offerte: sample-7'],
  ['fr', 'Facture', 'Issu du devis : sample-7'],
  ['it', 'Fattura', 'Da preventivo: sample-7'],
] as const)('renders automatic facts in %s with stable values', (locale, invoice, quote) => {
  const t = translator(locale)
  expect(documentTagLabel('invoice', t)).toBe(invoice)
  expect(documentTagLabel('from-quote-sample-7', t)).toBe(quote)
  expect(documentTagLabel('year-2025-02', t)).toBe('2025-02')
  expect(documentTagLabel('year-2025', t)).toBe('2025')
  expect(documentTagLabel('sample-7', t)).toBe('sample-7')
})

it('keeps kinds, dates and signed for the record or filing; client names are free tags', () => {
  for (const tag of [
    'invoice',
    'self-billed-invoice',
    'credit-note',
    'quote',
    'contract',
    'payment-confirmation',
    'power-of-attorney',
    'signed',
    'year-2025',
    'year-2025-02',
  ])
    expect(automaticOnlyTag(tag)).toBe(true)
  for (const tag of [
    'year-2025-13',
    'custom',
    'acme-ag',
    'client-invoice',
    '2026-in-005',
    'expense-travel',
  ])
    expect(automaticOnlyTag(tag)).toBe(false)
})

it.each(['en', 'de', 'fr', 'it'] as const)('labels every kind in %s', (locale) => {
  const t = translator(locale)
  for (const tag of ['payment-confirmation', 'proforma-invoice', 'consent', 'power-of-attorney'])
    expect(documentTagLabel(tag, t)).not.toBe(tag)
  expect(documentTagLabel('client-invoice', t)).toContain('invoice')
})
