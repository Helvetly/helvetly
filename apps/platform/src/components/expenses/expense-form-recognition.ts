// Merges the AI's receipt suggestions into the unsaved expense form without overwriting anything the person did.
import type { ReceiptSuggestions } from '@/lib/expenses'
import { parseDecimalInput } from '@/lib/invoices'

import {
  newLine,
  withSupplierCountry,
  type FormValues,
  type LineValues,
} from './expense-form-model'

/** The form fields a suggestion can fill, and the label key each is reported under. */
export const TEXT_FIELDS = [
  'supplier_name',
  'supplier_vat_number',
  'supplier_country',
  'reference',
  'description',
  'document_date',
  'due_date',
] as const

/** Edits that protect the amounts: currency, mode and lines are one group, never partly reinterpreted. */
const AMOUNT_FIELDS = ['currency', 'amount_mode', 'lines'] as const

export type Applied = {
  values: FormValues
  /** Fields (and `amounts`) that were filled. */
  applied: string[]
  /** Fields (and `amounts`) the receipt suggested but the person's own entry was kept. */
  kept: string[]
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * A field that started non-blank (a habit or default) is the person's and is kept, except the supplier country,
 * whose starting value is only the form's default. `touched` holds every field the person edited, cleared or reset at any time (sticky), so an edit made while the
 * request was running is kept too. A null suggestion never clears a value. The amounts are filled only as a whole:
 * currency, mode and lines untouched, and a currency, an amount and a VAT rate that all parse.
 */
export function applyRecognition(
  current: FormValues,
  initial: FormValues,
  touched: ReadonlySet<string>,
  suggestions: ReceiptSuggestions,
  options: {
    registered: boolean
    currencyOk: (code: string) => boolean
    /** The starting country is the person's saved habit (even CH), not the form's built-in fallback. */
    countrySaved: boolean
  },
): Applied {
  const { fields } = suggestions
  let values = current
  const applied: string[] = []
  const kept: string[] = []

  for (const field of TEXT_FIELDS) {
    const suggestion = fields[field]
    if (suggestion === null) continue
    const protectedField =
      touched.has(field) ||
      (field === 'supplier_country'
        ? touched.has('input_tax') || options.countrySaved
        : initial[field] !== '')
    if (protectedField) {
      kept.push(field)
      continue
    }
    if (field.endsWith('_date') && !isDate(suggestion)) continue
    if (field === 'supplier_country') {
      const code = suggestion.toUpperCase()
      if (!/^[A-Z]{2}$/.test(code)) continue
      // The country sets the input-tax default, unless the person already chose it.
      values = touched.has('deductible_percent')
        ? { ...values, supplier_country: code }
        : withSupplierCountry(values, code, options.registered)
    } else values = { ...values, [field]: suggestion }
    applied.push(field)
  }

  const money = amountsFrom(fields, options.currencyOk)
  if (money) {
    // A net-mode habit is a choice: gross receipt amounts are not placed into it.
    if (AMOUNT_FIELDS.some((field) => touched.has(field)) || current.amount_mode !== 'gross')
      kept.push('amounts')
    else {
      values = { ...values, amount_mode: 'gross', currency: money.currency, lines: money.lines }
      applied.push('amounts')
    }
  }
  return { values, applied, kept }
}

function amountsFrom(fields: ReceiptSuggestions['fields'], currencyOk: (code: string) => boolean) {
  const currency = fields.currency?.toUpperCase()
  if (!currency || !currencyOk(currency) || !fields.amount || !fields.vat_rate) return null
  const pairs = [[fields.amount, fields.vat_rate]]
  if (fields.amount_2 !== null || fields.vat_rate_2 !== null) {
    if (!fields.amount_2 || !fields.vat_rate_2) return null
    pairs.push([fields.amount_2, fields.vat_rate_2])
  }
  const lines: LineValues[] = []
  for (const [amount, rate] of pairs) {
    const parsedAmount = parseDecimalInput(amount ?? '', 2, true)
    const parsedRate = parseDecimalInput(rate ?? '', 2)
    if (!parsedAmount || parsedAmount.startsWith('-') || !parsedRate || Number(parsedRate) > 100)
      return null
    lines.push({ ...newLine(parsedRate), amount: parsedAmount })
  }
  return { currency, lines }
}
