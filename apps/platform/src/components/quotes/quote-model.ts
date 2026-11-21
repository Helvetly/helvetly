// The quote editor's state: the invoice editor's values (same lines, VAT and texts) plus the date a
// quote is valid until, and the conversion to the contract's QuoteInput.
import {
  editorInstalments,
  editorLine,
  emptyValues,
  newLine,
  toInput,
  type EditorErrors,
  type EditorValues,
} from '@/components/invoices/editor-model'
import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { addDays, type InvoiceInput, type InvoiceSettings } from '@/lib/invoices'
import type { Quote, QuoteInput } from '@/lib/quotes'

export type QuoteValues = EditorValues & { valid_until: string }

/** How long a new quote is valid, as the server's default. */
export const VALID_DAYS = 30

export function emptyQuoteValues(settings: InvoiceSettings, client: Client | null): QuoteValues {
  const values = emptyValues(settings, client)
  return { ...values, valid_until: addDays(values.issue_date, VALID_DAYS) }
}

export function valuesFromQuote(quote: Quote, settings: InvoiceSettings): QuoteValues {
  const values: QuoteValues = {
    ...emptyValues(settings),
    client_id: quote.client_id,
    issue_date: quote.issue_date,
    valid_until: quote.valid_until,
    currency: quote.currency,
    language: quote.language,
    vat_mode: quote.vat_mode,
    reference: quote.reference ?? '',
    intro: quote.intro ?? '',
    footer: quote.footer ?? '',
    note: quote.note ?? '',
    discount_percent: /^0*(\.0*)?$/.test(quote.discount_percent) ? '' : quote.discount_percent,
    lines: quote.lines.map(editorLine),
    instalments: editorInstalments(quote),
  }
  if (values.lines.length === 0) values.lines = [newLine(values, settings.default_vat_rate)]
  return values
}

/** The input to save, the number fields' errors and the sent line keys (see editor-model's toInput). */
export function toQuoteInput(values: QuoteValues): {
  input: Partial<QuoteInput>
  errors: EditorErrors
  keys: string[]
} {
  const { input: all, errors, keys } = toInput(values)
  if (values.valid_until < values.issue_date)
    errors.valid_until = translate('theQuoteMustBeValidOnOrAfterIts')
  // The invoice-only fields (due date, payment methods, …) stay out: the API refuses them.
  const input: Partial<QuoteInput> = {
    ...(all.client_id ? { client_id: all.client_id } : {}),
    issue_date: all.issue_date,
    valid_until: values.valid_until,
    currency: all.currency,
    language: all.language,
    vat_mode: all.vat_mode,
    reference: all.reference,
    intro: all.intro,
    footer: all.footer,
    note: all.note,
    discount_percent: all.discount_percent,
    lines: all.lines,
    ...(all.instalments === undefined ? {} : { instalments: all.instalments }),
  }
  return { input, errors, keys }
}

/** The invoice preview's input for what is on screen: the same maths gives the quote's totals. */
export const previewInput = (values: QuoteValues): Partial<InvoiceInput> =>
  toInput(values, true).input
