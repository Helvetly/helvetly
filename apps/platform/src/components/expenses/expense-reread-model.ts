import { categoryLabel } from '@/lib/expense-categories'
// Compares a draft with a new AI reading of its receipts, and applies the parts the person chose.
import type { Expense, ReceiptSuggestions } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { formatDay, formatMoney, toCents } from '@/lib/invoices'

import { withSupplierCountry, type FormValues } from './expense-form-model'
import {
  amountsFrom,
  isDate,
  TEXT_FIELDS,
  textOf,
  type TextField,
} from './expense-form-recognition'

/** The name a filled or offered field is reported under. */
export const recognizedLabel = (field: string) =>
  ({
    supplier_name: translate('supplier'),
    supplier_vat_number: translate('supplierVATUID'),
    supplier_country: translate('supplierCountry'),
    reference: translate('invoiceReceiptNo'),
    description: translate('whatFor'),
    document_date: translate('receiptDate'),
    due_date: translate('dueDate'),
    amounts: translate('amounts'),
    payment: translate('payment'),
    category_id: translate('category'),
  })[field] ?? field

export type RereadField = TextField | 'category_id' | 'amounts' | 'payment'

/** One value the reading would change: what the draft has now, what the receipt says, and whether now is empty. */
export type RereadRow = { field: RereadField; now: string; read: string; empty: boolean }

type Options = { registered: boolean; currencyOk: (code: string) => boolean }

const lineKey = (line: { amount: string; vat_rate: string }) =>
  `${toCents(line.amount)}@${Number(line.vat_rate)}`

const sameLines = (values: FormValues, lines: { amount: string; vat_rate: string }[]) => {
  const now = values.lines
    .filter((line) => line.amount !== '')
    .map(lineKey)
    .toSorted()
  return now.join() === lines.map(lineKey).toSorted().join()
}

const centsTotal = (lines: { amount: string }[]) =>
  (Number(lines.reduce((sum, line) => sum + toCents(line.amount), 0n)) / 100).toFixed(2)

const paidOnOf = (s: ReceiptSuggestions) => {
  const on = s.payment.paid_on ?? (s.document.type === 'receipt' ? s.document.date : null)
  return s.payment.status === 'paid' && on && isDate(on) ? on : null
}

/** The receipt's country, as a code the form takes; null when it is not one. */
const countryOf = (value: string) => {
  const code = value.toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

/**
 * Every value the reading has that differs from the draft. Nothing the receipt does not carry (a null) is offered,
 * nor amounts the server found disagreeing, nor a date that is not one.
 */
export function rereadRows(
  values: FormValues,
  expense: Expense,
  s: ReceiptSuggestions,
  options: Options,
): RereadRow[] {
  const rows: RereadRow[] = []
  const text = textOf(s)
  for (const field of TEXT_FIELDS) {
    let read = text[field]
    if (read === null) continue
    if (field.endsWith('_date') && !isDate(read)) continue
    if (field === 'supplier_country') read = countryOf(read)
    if (read === null || read === values[field]) continue
    const show = (value: string) => (field.endsWith('_date') && value ? formatDay(value) : value)
    rows.push({ field, now: show(values[field]), read: show(read), empty: values[field] === '' })
  }

  if (s.category && s.category.id !== values.category_id)
    rows.push({
      field: 'category_id',
      now: expense.category
        ? `${categoryLabel(expense.category)} · ${expense.category.account_code}`
        : '',
      read: `${categoryLabel(s.category)} · ${s.category.account_code}`,
      empty: values.category_id === '',
    })

  const money = amountsFrom(s, options.currencyOk)
  if (money && !(money.currency === values.currency && sameLines(values, money.lines))) {
    const empty = values.lines.every((line) => line.amount === '')
    rows.push({
      field: 'amounts',
      now: empty ? '' : formatMoney(expense.total, expense.currency),
      read: formatMoney(centsTotal(money.lines), money.currency),
      empty,
    })
  }

  const paidOn = paidOnOf(s)
  if (paidOn && !(values.paid && values.paid_on === paidOn))
    rows.push({
      field: 'payment',
      now: values.paid
        ? translate('paidOnDate', { date: values.paid_on ? formatDay(values.paid_on) : '—' })
        : translate('notPaidYet'),
      read: translate('paidOnDate', { date: formatDay(paidOn) }),
      empty: !values.paid,
    })
  return rows
}

/** The draft's values with the chosen parts of the reading in place; everything else is left as it was. */
export function applyReread(
  values: FormValues,
  s: ReceiptSuggestions,
  chosen: ReadonlySet<RereadField>,
  options: Options,
): FormValues {
  let next = values
  const text = textOf(s)
  for (const field of TEXT_FIELDS) {
    const read = text[field]
    if (!chosen.has(field) || read === null) continue
    if (field === 'supplier_country') {
      const code = countryOf(read)
      if (code) next = withSupplierCountry(next, code, options.registered)
    } else next = { ...next, [field]: read }
  }
  if (chosen.has('category_id') && s.category) next = { ...next, category_id: s.category.id }
  const money = chosen.has('amounts') ? amountsFrom(s, options.currencyOk) : null
  if (money)
    next = {
      ...next,
      amount_mode: 'gross',
      ...money,
    }
  const paidOn = chosen.has('payment') ? paidOnOf(s) : null
  if (paidOn)
    next = {
      ...next,
      paid: true,
      paid_on: paidOn,
      payment_method: s.payment.method ?? next.payment_method,
    }
  return next
}
