// Merges the AI's receipt suggestions into the unsaved expense form without overwriting anything the person did.
import type { ReadGroup, ReceiptSuggestions } from '@/lib/expenses'
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

type TextField = (typeof TEXT_FIELDS)[number]

/** The part of the reading each filled field comes from, for its confidence. */
const GROUP_OF: Partial<Record<string, ReadGroup>> = {
  supplier_name: 'supplier',
  supplier_vat_number: 'supplier',
  supplier_country: 'supplier',
  reference: 'document',
  document_date: 'document',
  due_date: 'document',
  payment: 'payment',
}

/** Below this the category is filled but marked to check. */
export const SURE_CATEGORY = 0.6

export type Applied = {
  values: FormValues
  /** Fields (and `amounts`, `payment`) that were filled. */
  applied: string[]
  /** Fields (and `amounts`, `payment`) the receipt suggested but the person's own entry was kept. */
  kept: string[]
  /** Filled fields the AI read with low confidence: the person checks them. */
  uncertain: string[]
}

/** The reading's value for each text field of the form. */
const textOf = (s: ReceiptSuggestions): Record<TextField, string | null> => ({
  supplier_name: s.supplier.name,
  supplier_vat_number: s.supplier.vat_number,
  supplier_country: s.supplier.country,
  reference: s.document.number,
  description: s.description,
  document_date: s.document.date,
  due_date: s.document.due_date,
})

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * Receipt reading v2 into the form. A field that started non-blank (a habit or default) is the person's and is kept, except the supplier country,
 * whose starting value is only the form's default. `touched` holds every field the person edited, cleared or reset at any time (sticky), so an edit made while the
 * request was running is kept too. A null suggestion never clears a value. The amounts are filled only as a whole:
 * currency, mode and lines untouched, one gross line per VAT rate of the breakdown, none of it read with low
 * confidence. The payment is filled when the receipt shows it paid on a date, the category when the person chose
 * none; a category below SURE_CATEGORY is marked to check.
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
  const fields = textOf(suggestions)
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

  const money = amountsFrom(suggestions, options.currencyOk)
  if (money) {
    // A net-mode habit is a choice: gross receipt amounts are not placed into it.
    if (AMOUNT_FIELDS.some((field) => touched.has(field)) || current.amount_mode !== 'gross')
      kept.push('amounts')
    else {
      values = { ...values, amount_mode: 'gross', currency: money.currency, lines: money.lines }
      applied.push('amounts')
    }
  }

  const { payment, category } = suggestions
  const paidOn =
    payment.paid_on ?? (suggestions.document.type === 'receipt' ? suggestions.document.date : null)
  if (payment.status === 'paid' && paidOn && isDate(paidOn)) {
    if (PAYMENT_FIELDS.some((field) => touched.has(field)) || initial.paid) kept.push('payment')
    else {
      values = {
        ...values,
        paid: true,
        paid_on: paidOn,
        payment_method: payment.method ?? values.payment_method,
      }
      applied.push('payment')
    }
  }

  if (category) {
    if (touched.has('category_id') || initial.category_id !== '') kept.push('category_id')
    else {
      values = { ...values, category_id: category.id }
      applied.push('category_id')
    }
  }

  const uncertain = applied.filter((field) => {
    if (field === 'category_id') return (category?.confidence ?? 0) < SURE_CATEGORY
    const group = GROUP_OF[field]
    return group !== undefined && suggestions.confidence[group] === 'low'
  })
  return { values, applied, kept, uncertain }
}

const PAYMENT_FIELDS = ['paid', 'paid_on', 'payment_method'] as const

/**
 * One gross line per rate of the breakdown, or nothing: never a reverse charge (the form cannot record it yet), a
 * total without its rate, or figures the server found disagreeing.
 */
function amountsFrom(s: ReceiptSuggestions, currencyOk: (code: string) => boolean) {
  const currency = s.currency?.toUpperCase()
  if (!currency || !currencyOk(currency) || s.reverse_charge || s.vat_breakdown.length === 0)
    return null
  if (s.confidence.totals === 'low' || s.confidence.vat_breakdown === 'low') return null
  const lines: LineValues[] = []
  for (const band of s.vat_breakdown) {
    const parsedAmount = parseDecimalInput(band.gross ?? '', 2, true)
    const parsedRate = parseDecimalInput(band.rate ?? '', 2)
    if (!parsedAmount || parsedAmount.startsWith('-') || !parsedRate || Number(parsedRate) > 100)
      return null
    lines.push({ ...newLine(parsedRate), amount: parsedAmount })
  }
  return { currency, lines }
}
