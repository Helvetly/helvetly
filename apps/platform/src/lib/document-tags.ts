import { translate } from './i18n'

const kinds = new Map<string, Parameters<typeof translate>[0]>([
  ['invoice', 'documentTagInvoice'],
  ['credit-note', 'documentTagCreditNote'],
  ['debit-note', 'documentTagDebitNote'],
  ['quote', 'documentTagQuote'],
  ['contract', 'contract'],
  ['receipt', 'receipt'],
  ['engagement', 'documentTagEngagement'],
  ['signed', 'signed'],
] as const)
const date = /^year-(\d{4}(?:-(?:0[1-9]|1[0-2]))?)$/

export const reservedDocumentTag = (tag: string) =>
  tag === 'signed' || date.test(tag) || /^client-.+/.test(tag)

export const protectedDocumentTag = (tag: string) => reservedDocumentTag(tag) || kinds.has(tag)

/** Only callers with automatic tag provenance use this label. Filter values and writes keep the stored tag. */
export function documentTagLabel(tag: string, t = translate) {
  const kind = kinds.get(tag)
  if (kind) return t(kind)
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
