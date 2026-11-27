import { translate } from './i18n'

/**
 * Every kind tag (the API's `tags.Kinds`, kept equal by a Go test) with its label. A kind comes only from the file's
 * record, system folder or AI filing; one new kind is one line here.
 */
const kinds = new Map<string, Parameters<typeof translate>[0]>([
  ['invoice', 'documentTagInvoice'],
  ['partial-invoice', 'documentTagPartialInvoice'],
  ['prepayment-invoice', 'documentTagPrepaymentInvoice'],
  ['corrected-invoice', 'documentTagCorrectedInvoice'],
  ['proforma-invoice', 'documentTagProformaInvoice'],
  ['self-billed-invoice', 'documentTagSelfBilledInvoice'],
  ['credit-note', 'documentTagCreditNote'],
  ['debit-note', 'documentTagDebitNote'],
  ['quote', 'documentTagQuote'],
  ['contract', 'contract'],
  ['engagement', 'documentTagEngagement'],
  ['receipt', 'receipt'],
  ['payment-confirmation', 'documentTagPaymentConfirmation'],
  ['consent', 'documentTagConsent'],
  ['power-of-attorney', 'documentTagPowerOfAttorney'],
  ['bank-statement', 'bankStatement'],
  ['tax-document', 'documentTagTaxDocument'],
] as const)
/** Every kind tag, for callers that must cover each one. */
export const documentKinds = [...kinds.keys()]
const date = /^year-(\d{4}(?:-(?:0[1-9]|1[0-2]))?)$/

/** A tag only the record or filing sets (a kind, signed, a date): nobody types it onto a file. */
export const automaticOnlyTag = (tag: string) =>
  tag === 'signed' || date.test(tag) || kinds.has(tag)

/** Only callers with automatic tag provenance use this label. Filter values and writes keep the stored tag. */
export function documentTagLabel(tag: string, t = translate) {
  const kind = kinds.get(tag)
  if (kind) return t(kind)
  if (tag === 'signed') return t('signed')
  const period = date.exec(tag)
  if (period) return period[1] ?? tag
  for (const [prefix, key] of [
    ['client-', 'documentTagClient'],
    ['expense-', 'documentTagExpense'],
    ['from-quote-', 'documentTagFromQuote'],
  ] as const) {
    if (tag.startsWith(prefix)) return t(key, { value: tag.slice(prefix.length) })
  }
  return tag
}
