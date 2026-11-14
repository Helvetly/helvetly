// The expense form's values (as typed), their checks and the API input they become.
import {
  isForeignVat,
  type Expense,
  type ExpenseInput,
  type InputTax,
  type RateSource,
} from '@/lib/expenses'
import { withHabits, type Habits } from '@/lib/habits'
import { parseDecimalInput, PAYMENT_METHODS, type PaymentMethod } from '@/lib/invoices'

export type LineValues = { key: string; description: string; amount: string; vat_rate: string }

export type FormValues = {
  supplier_name: string
  supplier_vat_number: string
  supplier_country: string
  reference: string
  description: string
  category_id: string
  document_date: string
  due_date: string
  currency: string
  amount_mode: 'gross' | 'net'
  lines: LineValues[]
  input_tax: InputTax
  deductible_percent: string
  exchange_rate: string
  exchange_rate_date: string
  exchange_rate_source: RateSource | ''
  paid: boolean
  paid_on: string
  payment_method: PaymentMethod | ''
  out_of_pocket: boolean
  paid_by_member_id: string
  reimbursed_on: string
  note: string
  receipt_missing_reason: string
}

export type FieldErrors = Partial<Record<string, string>>

/** The fields booking needs, in form order (the API's missing_fields name `category` and `total`). */
export const BOOKING_FIELDS = ['supplier_name', 'document_date', 'category_id', 'lines'] as const
export const NOTE_MAX = 1000

let lineCounter = 0
export const newLine = (vatRate: string): LineValues => ({
  key: `line-${++lineCounter}`,
  description: '',
  amount: '',
  vat_rate: vatRate,
})

export function emptyValues(currency: string, vatRate: string, registered: boolean): FormValues {
  return {
    supplier_name: '',
    supplier_vat_number: '',
    supplier_country: 'CH',
    reference: '',
    description: '',
    category_id: '',
    document_date: '',
    due_date: '',
    currency,
    amount_mode: 'gross',
    lines: [newLine(registered ? vatRate : '0')],
    input_tax: registered ? 'full' : 'none',
    deductible_percent: registered ? '100' : '0',
    exchange_rate: '',
    exchange_rate_date: '',
    exchange_rate_source: '',
    paid: false,
    paid_on: '',
    payment_method: '',
    out_of_pocket: false,
    paid_by_member_id: '',
    reimbursed_on: '',
    note: '',
    receipt_missing_reason: '',
  }
}

export function valuesFromExpense(expense: Expense): FormValues {
  const foreign = expense.currency !== expense.base.currency
  return {
    supplier_name: expense.supplier_name ?? '',
    supplier_vat_number: expense.supplier_vat_number ?? '',
    supplier_country: expense.supplier_country,
    reference: expense.reference ?? '',
    description: expense.description ?? '',
    category_id: expense.category?.id ?? '',
    document_date: expense.document_date ?? '',
    due_date: expense.due_date ?? '',
    currency: expense.currency,
    amount_mode: expense.amount_mode,
    lines: expense.lines.length
      ? expense.lines.map((line) => ({
          ...newLine(line.vat_rate),
          description: line.description ?? '',
          amount: line.amount,
        }))
      : [newLine('0')],
    input_tax: expense.input_tax,
    deductible_percent: expense.deductible_percent,
    exchange_rate: foreign ? expense.exchange_rate : '',
    exchange_rate_date: expense.exchange_rate_date ?? '',
    exchange_rate_source: expense.exchange_rate_source ?? '',
    paid: expense.payment_status === 'paid',
    paid_on: expense.paid_on ?? '',
    payment_method: expense.payment_method ?? '',
    out_of_pocket: expense.paid_by_member !== null,
    paid_by_member_id: expense.paid_by_member?.id ?? '',
    reimbursed_on: expense.reimbursed_on ?? '',
    note: expense.note ?? '',
    receipt_missing_reason: expense.receipt_missing_reason ?? '',
  }
}

/**
 * A new supplier country sets the input-tax default, as the API does: foreign VAT is not Swiss input tax,
 * Swiss VAT is fully reclaimable when the workspace is VAT-registered. The person can still change it.
 */
export function withSupplierCountry(
  values: FormValues,
  country: string,
  registered: boolean,
): FormValues {
  const reclaim = !isForeignVat(country) && registered
  return {
    ...values,
    supplier_country: country,
    input_tax: reclaim ? 'full' : 'none',
    deductible_percent: reclaim ? '100' : '0',
  }
}

const blank = (value: string) => value.trim() || null
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

/** The lines someone filled in (an empty last row is not a line). */
const filledLines = (values: FormValues) =>
  values.lines.filter((line) => line.amount.trim() || line.description.trim())

/**
 * Errors the person can fix before saving. `booking` also requires what booking needs; dates are
 * compared as civil dates, so `today` is the workspace's (YYYY-MM-DD).
 */
export function validate(values: FormValues, today: string, booking: boolean): FieldErrors {
  const errors: FieldErrors = {}
  const lines = filledLines(values)
  lines.forEach((line) => {
    const index = values.lines.indexOf(line)
    if (parseDecimalInput(line.amount, 2) === null || line.amount.trim().startsWith('-'))
      errors[`lines.${index}.amount`] = 'Enter an amount such as 49.90.'
    const rate = parseDecimalInput(line.vat_rate, 2)
    if (rate === null || Number(rate) < 0 || Number(rate) > 100)
      errors[`lines.${index}.vat_rate`] = 'Enter a rate from 0 to 100.'
  })
  if (values.input_tax === 'partial') {
    const share = parseDecimalInput(values.deductible_percent, 2)
    if (share === null || Number(share) <= 0 || Number(share) >= 100)
      errors.deductible_percent = 'Enter a share above 0 and below 100.'
  }
  if (values.exchange_rate.trim()) {
    const rate = parseDecimalInput(values.exchange_rate, 6)
    if (rate === null || Number(rate) <= 0)
      errors.exchange_rate = 'Enter a rate above 0, e.g. 0.9412.'
  }
  if (values.document_date && values.due_date && values.due_date < values.document_date)
    errors.due_date = 'The due date cannot be before the document date.'
  if (values.paid && values.paid_on && values.paid_on > today)
    errors.paid_on = 'The payment date cannot be in the future.'
  if (values.reimbursed_on && values.reimbursed_on > today)
    errors.reimbursed_on = 'This date cannot be in the future.'
  if (values.note.length > NOTE_MAX) errors.note = `Use at most ${NOTE_MAX} characters.`

  if (booking) {
    if (!values.supplier_name.trim()) errors.supplier_name = 'Enter the supplier to book.'
    if (!isDate(values.document_date)) errors.document_date = 'Enter the receipt’s date to book.'
    else if (values.document_date > today)
      errors.document_date = 'The date cannot be in the future.'
    if (!values.category_id) errors.category_id = 'Choose a category to book.'
    if (!lines.some((line) => Number(parseDecimalInput(line.amount, 2) ?? 0) > 0))
      errors['lines.0.amount'] ??= 'Enter the amount to book.'
  }
  return errors
}

/**
 * The API input. A new expense sends what is filled in; an edit sends every field so cleared ones
 * clear. A booked expense sends only what it still takes (payment and note).
 */
export function toInput(
  values: FormValues,
  options: { userId: string | undefined; baseCurrency: string; booked: boolean },
): Partial<ExpenseInput> {
  const payment: Partial<ExpenseInput> = values.paid
    ? {
        payment_status: 'paid',
        paid_on: values.paid_on || null,
        payment_method: values.payment_method || null,
        paid_by_member_id: values.out_of_pocket
          ? values.paid_by_member_id || options.userId || null
          : null,
        reimbursed_on: values.out_of_pocket ? values.reimbursed_on || null : null,
      }
    : { payment_status: 'unpaid' }
  if (options.booked) return { ...payment, note: blank(values.note) }

  const foreign = values.currency !== options.baseCurrency
  return {
    supplier_name: blank(values.supplier_name),
    supplier_vat_number: blank(values.supplier_vat_number),
    supplier_country: values.supplier_country,
    reference: blank(values.reference),
    description: blank(values.description),
    category_id: values.category_id || null,
    document_date: values.document_date || null,
    due_date: values.due_date || null,
    currency: values.currency,
    amount_mode: values.amount_mode,
    lines: filledLines(values).map((line) => ({
      description: blank(line.description),
      amount: parseDecimalInput(line.amount, 2, true) ?? '0.00',
      vat_rate: parseDecimalInput(line.vat_rate, 2) ?? '0',
    })),
    input_tax: values.input_tax,
    ...(values.input_tax === 'partial'
      ? { deductible_percent: parseDecimalInput(values.deductible_percent, 2) ?? '0' }
      : {}),
    ...(foreign && values.exchange_rate.trim()
      ? { exchange_rate: parseDecimalInput(values.exchange_rate, 6) ?? undefined }
      : {}),
    exchange_rate_date: foreign ? values.exchange_rate_date || null : null,
    exchange_rate_source: foreign ? values.exchange_rate_source || null : null,
    ...payment,
    note: blank(values.note),
    receipt_missing_reason: blank(values.receipt_missing_reason),
  }
}

const SERVER_FIELDS: Record<string, string> = {
  category: 'category_id',
  paid_by_member_id: 'paid_on',
}

/** The API's 422 details.fields as form errors (`lines.0.amount` keeps its name). */
export function serverFieldErrors(details: Record<string, unknown>): FieldErrors {
  const fields = details.fields
  if (typeof fields !== 'object' || fields === null) return {}
  const errors: FieldErrors = {}
  for (const [key, message] of Object.entries(fields))
    if (typeof message === 'string') errors[SERVER_FIELDS[key] ?? key] = message
  return errors
}

/** The order errors are focused in: the form's order, then lines top to bottom. */
export const ERROR_ORDER = [
  'supplier_name',
  'supplier_vat_number',
  'supplier_country',
  'reference',
  'document_date',
  'due_date',
  'category_id',
  'description',
  'lines',
  'exchange_rate',
  'deductible_percent',
  'paid_on',
  'reimbursed_on',
  'note',
]

export function firstError(errors: FieldErrors) {
  const keys = Object.keys(errors).filter((key) => errors[key])
  return (
    ERROR_ORDER.flatMap((field) =>
      keys.filter((key) => key === field || key.startsWith(`${field}.`)).toSorted(),
    )[0] ?? keys[0]
  )
}

/** What a new expense starts with from this person's habits (lib/habits). */
export const EXPENSE_HABITS = [
  'supplier_country',
  'category_id',
  'amount_mode',
  'paid',
  'payment_method',
  'out_of_pocket',
] as const satisfies readonly (keyof FormValues)[]

export function newValues(
  currency: string,
  vatRate: string,
  registered: boolean,
  habits: Habits,
  /** The categories that exist now; a habit for a deleted one is ignored. */
  categoryIds: readonly string[],
): FormValues {
  return withHabits(emptyValues(currency, vatRate, registered), habits, 'expense', EXPENSE_HABITS, {
    allowed: {
      supplier_country: (code) => /^[A-Z]{2}$/.test(code),
      category_id: (id) => categoryIds.includes(id),
      amount_mode: (mode) => mode === 'gross' || mode === 'net',
      payment_method: (method) => PAYMENT_METHODS.some((entry) => entry.value === method),
    },
  })
}
