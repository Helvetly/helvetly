import { createTranslators } from '@helvetly/i18n'
import { expect, it } from 'vitest'

import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import itMessages from '../messages/it.json'
import { documentTagLabel, protectedDocumentTag, reservedDocumentTag } from './document-tags'

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

it('protects automatic record kinds, dates, signed status and clients', () => {
  for (const tag of [
    'invoice',
    'credit-note',
    'debit-note',
    'quote',
    'receipt',
    'engagement',
    'contract',
    'signed',
    'client-sample',
    'year-2025',
    'year-2025-02',
  ])
    expect(protectedDocumentTag(tag)).toBe(true)
  for (const tag of ['year-2025-13', 'custom', 'sample-7', 'from-quote-sample', 'expense-travel'])
    expect(protectedDocumentTag(tag)).toBe(false)
  expect(reservedDocumentTag('invoice')).toBe(false)
})
