import {
  billingOf,
  unpriced,
  type Engagement,
  type EngagementInput,
  type Recurrence,
} from '@/lib/engagements'
// The engagement form's state, checks, schedule presets and summary (docs/engagements-contract.md).
import { withHabits, type Habits } from '@/lib/habits'
import { translate } from '@/lib/i18n'
import {
  addDays,
  fromCents,
  parseDecimalInput,
  toCents,
  today,
  UNITS,
  VAT_CATEGORIES,
  type Unit,
  type VatCategory,
} from '@/lib/invoices'
import type { Product } from '@/lib/products'

export type FormValues = {
  client_id: string
  client_name: string
  title: string
  description: string
  product_id: string
  unit: Unit | ''
  quantity: string
  /** 'paid' = no price here: the work was paid on an invoice made elsewhere, the engagement only tracks it. */
  billing: Engagement['billing'] | 'paid'
  price_basis: Engagement['price_basis']
  unit_price: string
  /** Empty means "same as the unit price". */
  overage_unit_price: string
  currency: string
  vat_category: VatCategory
  vat_rate: string
  start_date: string
  recurrence: Recurrence
  interval: string
  end_date: string
  reference: string
  document_id: string
  rollover: boolean
  auto_invoice: boolean
  invoice_detail: Engagement['invoice_detail']
}

export type FieldErrors = Partial<Record<keyof FormValues, string>>

/** Where errors are focused from, in form order. */
export const FIELD_ORDER: (keyof FormValues)[] = [
  'client_id',
  'title',
  'quantity',
  'start_date',
  'interval',
  'end_date',
  'unit_price',
  'overage_unit_price',
  'currency',
  'vat_category',
  'vat_rate',
  'description',
  'reference',
  'document_id',
]

export const PRESET_MONTHS = [1, 3, 6, 12] as const
const MAX_QUANTITY_MILLI = 1_000_000_000n
const MAX_PRICE_CENTS = 10_000_000_000n
/** As the API's limit (engagements/input.go) and products', counted after trimming. */
export const DESCRIPTION_MAX = 1000

/** A description saved before the limit, longer than it and not changed: kept and saved as it is. */
export const keptLongDescription = (description: string, saved: string) =>
  description.trim().length > DESCRIPTION_MAX && description.trim() === saved.trim()

/** What a new engagement starts with: the workspace's currency and VAT defaults. */
export type Defaults = { currency: string; vat_registered: boolean; default_vat_rate: string }

export const FALLBACK_DEFAULTS: Defaults = {
  currency: 'CHF',
  vat_registered: true,
  default_vat_rate: '8.1',
}

export function emptyValues(
  defaults: Defaults = FALLBACK_DEFAULTS,
  clientId = '',
  clientName = '',
): FormValues {
  return {
    client_id: clientId,
    client_name: clientName,
    title: '',
    description: '',
    product_id: '',
    unit: 'hour',
    quantity: '',
    // Most engagements track work already paid; pricing one is the deliberate step.
    billing: 'paid',
    price_basis: 'net',
    unit_price: '',
    overage_unit_price: '',
    currency: defaults.currency,
    vat_category: defaults.vat_registered ? 'S' : 'O',
    vat_rate: defaults.vat_registered ? defaults.default_vat_rate : '0',
    start_date: today(),
    recurrence: 'none',
    interval: '1',
    end_date: '',
    reference: '',
    document_id: '',
    rollover: false,
    auto_invoice: false,
    invoice_detail: 'summary',
  }
}

export function valuesFromEngagement(e: Engagement): FormValues {
  return {
    client_id: e.client.id,
    client_name: e.client.name,
    title: e.title,
    description: e.description ?? '',
    product_id: e.product_id ?? '',
    unit: e.unit ?? '',
    quantity: e.quantity,
    billing: billingOf(e),
    price_basis: e.price_basis,
    unit_price: unpriced(e) ? '' : e.unit_price,
    overage_unit_price: e.overage_unit_price ?? '',
    currency: e.currency,
    vat_category: e.vat_category,
    vat_rate: e.vat_rate,
    start_date: e.start_date,
    recurrence: e.recurrence,
    interval: String(e.interval),
    end_date: e.end_date ?? '',
    reference: e.reference ?? '',
    document_id: e.document_id ?? '',
    rollover: e.rollover,
    auto_invoice: e.auto_invoice,
    invoice_detail: e.invoice_detail,
  }
}

/** A catalogue item copied into the engagement (like an invoice line): the item is not linked live. */
export function applyProduct(values: FormValues, product: Product): FormValues {
  return {
    ...values,
    product_id: product.id,
    title: product.name,
    description: product.description ?? values.description,
    unit: product.unit ?? values.unit,
    price_basis: product.price_basis,
    unit_price: product.unit_price,
    currency: product.currency,
    vat_category: product.vat_category,
    vat_rate: product.vat_rate,
  }
}

// Dates (civil, `YYYY-MM-DD`)

const isDate = (text: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))

/** `date` plus `months`, the day clamped to the target month's length (31 Jan + 1 month = 28 Feb). */
export function addMonths(date: string, months: number) {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return [year, month, Math.min(d, last)]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('-')
}

/** The last day of a one-off engagement of `months` months from `start`: start + months − 1 day. */
export const presetEnd = (start: string, months: number) => addDays(addMonths(start, months), -1)

/** "1.11.2026" */
export const swissDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${d}.${m}.${y}`
}

// Quantities and money

const quantityMilli = (text: string) => {
  const q = parseDecimalInput(text, 3)
  if (q === null || q.startsWith('-')) return null
  const [whole = '0', fraction = ''] = q.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}

const priceCents = (text: string) => {
  const p = parseDecimalInput(text, 2, true)
  return p === null || p.startsWith('-') ? null : toCents(p)
}

/** `savedDescription`: the engagement's description as loaded, which may stay over the limit unchanged. */
export function validate(values: FormValues, savedDescription = ''): FieldErrors {
  const errors: FieldErrors = {}
  if (!values.client_id) errors.client_id = translate('chooseAClient')
  const title = values.title.trim()
  if (!title) errors.title = translate('enterATitle')
  else if (title.length > 200) errors.title = translate('useAtMost200Characters')
  const quantity = quantityMilli(values.quantity)
  if (!values.quantity.trim()) errors.quantity = translate('enterTheQuantityPerPeriod')
  else if (quantity === null || quantity <= 0n || quantity > MAX_QUANTITY_MILLI)
    errors.quantity = translate('enterAQuantityAbove0UpTo1000')
  if (!isDate(values.start_date)) errors.start_date = translate('chooseAStartDate')
  const recurring = values.recurrence !== 'none'
  const interval = Number(values.interval)
  if (recurring && !(Number.isInteger(interval) && interval >= 1 && interval <= 12))
    errors.interval = translate('useAWholeNumberFrom1To12')
  if (values.end_date) {
    if (!isDate(values.end_date)) errors.end_date = translate('chooseAValidEndDate')
    else if (isDate(values.start_date) && values.end_date < values.start_date)
      errors.end_date = translate('theEndCannotBeBeforeTheStart')
  } else if (!recurring) errors.end_date = translate('chooseWhenTheEngagementEnds')
  const price = priceCents(values.unit_price)
  const priced = values.billing !== 'paid'
  if (priced) {
    if (!values.unit_price.trim()) errors.unit_price = translate('enterAPrice')
    else if (price === null || price > MAX_PRICE_CENTS)
      errors.unit_price = translate('enterAPriceFrom0To100000000')
    // A zero price reads back as Paid separately (unpriced), so it is asked for that way.
    else if (price === 0n) errors.unit_price = translate('enterAPriceAbove0')
  }
  if (priced && values.overage_unit_price.trim()) {
    const overage = priceCents(values.overage_unit_price)
    if (overage === null || overage > MAX_PRICE_CENTS)
      errors.overage_unit_price = translate('enterAPriceFrom0WithAtMostTwo')
  }
  if (!/^[A-Z]{3}$/.test(values.currency)) errors.currency = translate('chooseACurrency2')
  if (priced && values.vat_category === 'S') {
    const rate = parseDecimalInput(values.vat_rate, 2)
    if (rate === null || rate.startsWith('-') || Number(rate) > 100 || Number(rate) === 0)
      errors.vat_rate = translate('enterAVATRateAbove0UpTo100')
  }
  if (
    values.description.trim().length > DESCRIPTION_MAX &&
    !keptLongDescription(values.description, savedDescription)
  )
    errors.description = translate('useAtMostCharacters3', { DESCRIPTION_MAX })
  if (values.reference.trim().length > 100) errors.reference = translate('useAtMost100Characters')
  return errors
}

/** Rollover applies to advance billing on a recurring schedule only. */
export const canRollOver = (values: Pick<FormValues, 'billing' | 'recurrence'>) =>
  values.billing !== 'arrears' && values.recurrence !== 'none'

const orNull = (text: string) => text.trim() || null

export function toInput(values: FormValues): EngagementInput {
  const recurring = values.recurrence !== 'none'
  const paid = values.billing === 'paid'
  const overage = paid ? '' : values.overage_unit_price.trim()
  return {
    client_id: values.client_id,
    title: values.title.trim(),
    description: orNull(values.description),
    product_id: orNull(values.product_id),
    unit: values.unit || null,
    quantity: parseDecimalInput(values.quantity, 3) ?? values.quantity,
    // Paid elsewhere is stored as an advance engagement without a price (see unpriced).
    billing: values.billing === 'paid' ? 'advance' : values.billing,
    price_basis: values.price_basis,
    unit_price: paid ? '0' : (parseDecimalInput(values.unit_price, 2, true) ?? values.unit_price),
    overage_unit_price: overage
      ? (parseDecimalInput(overage, 2, true) ?? values.overage_unit_price)
      : null,
    currency: values.currency,
    vat_category: values.vat_category,
    vat_rate:
      values.vat_category === 'S'
        ? (parseDecimalInput(values.vat_rate, 2) ?? values.vat_rate)
        : '0',
    start_date: values.start_date,
    recurrence: values.recurrence,
    interval: recurring ? Number(values.interval) : 1,
    end_date: orNull(values.end_date),
    reference: orNull(values.reference),
    document_id: orNull(values.document_id),
    // Rollover only exists for advance + recurring; elsewhere the server answers 422.
    rollover: values.rollover && canRollOver(values),
    auto_invoice: values.auto_invoice && !paid,
    invoice_detail: values.invoice_detail,
  }
}

/** The 422's field messages for the fields this form has. */
export function serverFieldErrors(details: Record<string, unknown>): FieldErrors {
  const fields = details.fields
  if (typeof fields !== 'object' || fields === null) return {}
  const errors: FieldErrors = {}
  for (const [key, message] of Object.entries(fields)) {
    const field = FIELD_ORDER.find((name) => name === key)
    if (field && typeof message === 'string') errors[field] = message
  }
  return errors
}

/** quantity × price for one period, rounded half up to the cent; null while either is not a number. */
export function periodTotal(values: Pick<FormValues, 'quantity' | 'unit_price'>) {
  const q = quantityMilli(values.quantity)
  const p = priceCents(values.unit_price)
  return q === null || p === null ? null : fromCents((q * p + 500n) / 1000n)
}

const RECURRENCE_WORDS: Record<Exclude<Recurrence, 'none'>, [string, string]> = {
  weekly: [translate('dynamicWeek'), translate('dynamicWeeks')],
  monthly: [translate('dynamicMonth'), translate('dynamicMonths')],
  quarterly: [translate('dynamicQuarter'), translate('dynamicQuarters')],
  yearly: [translate('dynamicYear'), translate('dynamicYears')],
}

export const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: translate('weeks') },
  { value: 'monthly', label: translate('months') },
  { value: 'quarterly', label: translate('quarters') },
  { value: 'yearly', label: translate('years') },
] as const

const MONTHS_PER = { monthly: 1, quarterly: 3, yearly: 12 } as const
const MAX_PERIODS = 600

export type Period = { start: string; end: string }

function periodStart(start: string, recurrence: Exclude<Recurrence, 'none'>, count: number) {
  return recurrence === 'weekly'
    ? addDays(start, 7 * count)
    : addMonths(start, MONTHS_PER[recurrence] * count)
}

/** The first `limit` periods of a recurring schedule, each anchored on the start date and cut at the end date. */
export function schedulePeriods(values: FormValues, limit: number): Period[] {
  const { recurrence, start_date: start } = values
  const every = Number(values.interval)
  if (recurrence === 'none' || !isDate(start) || !Number.isInteger(every) || every < 1) return []
  const end = isDate(values.end_date) ? values.end_date : null
  const periods: Period[] = []
  for (let i = 0; i < limit; i++) {
    const from = periodStart(start, recurrence, every * i)
    if (end && from > end) break
    const to = addDays(periodStart(start, recurrence, every * (i + 1)), -1)
    periods.push({ start: from, end: end && to > end ? end : to })
  }
  return periods
}

// End dates reach 2100, so a weekly schedule from 2000 has about 5'300 periods.
const MAX_LISTED = 6000

export type NumberedPeriod = Period & { n: number }

/**
 * The periods the summary lists: all of them up to four; else the first three, then, with an end date, the last
 * one and how many there are in all (`count`, null while open-ended).
 */
export function periodPreview(values: FormValues): {
  first: NumberedPeriod[]
  last: NumberedPeriod | null
  more: boolean
  count: number | null
} {
  const ends = isDate(values.end_date)
  const all = schedulePeriods(values, ends ? MAX_LISTED : 4).map((p, i) => ({ ...p, n: i + 1 }))
  const short = all.length <= (ends ? 4 : 3)
  return {
    first: short ? all : all.slice(0, 3),
    last: ends && !short ? (all.at(-1) ?? null) : null,
    more: !short,
    count: ends ? all.length : null,
  }
}

/** What the engagement is worth in total; null while unknown (no end date on a recurring one). */
export function committedTotal(values: FormValues) {
  if (values.billing === 'paid') return null
  const total = periodTotal(values)
  if (total === null) return null
  if (values.recurrence === 'none') return total
  if (!isDate(values.end_date)) return null
  const count = schedulePeriods(values, MAX_PERIODS).length
  return count === 0 || count === MAX_PERIODS ? null : fromCents(toCents(total) * BigInt(count))
}

/** "30 h German lessons for Müller AG · 7.11.2026 – 6.2.2027 · billed upfront"; null until the quantity says something. */
export function summarySentence(values: FormValues, clientName: string): string | null {
  const q = quantityMilli(values.quantity)
  if (q === null || q === 0n || !isDate(values.start_date)) return null
  const unit = UNITS.find((u) => u.value === values.unit)?.short
  const amount = parseDecimalInput(values.quantity, 3) ?? ''
  const what = [unit ? `${amount} ${unit}` : amount, values.title.trim()].filter(Boolean).join(' ')
  const who = clientName ? translate('dynamicFor', { what: what, clientName: clientName }) : what
  const start = swissDate(values.start_date)
  const end = isDate(values.end_date) ? swissDate(values.end_date) : null
  let when: string
  if (values.recurrence === 'none')
    when = end ? `${start} – ${end}` : translate('dynamicFrom2', { start: start })
  else {
    const n = Number(values.interval)
    const [one, many] = RECURRENCE_WORDS[values.recurrence]
    when = translate('dynamicFrom', {
      value1:
        n === 1
          ? translate('dynamicEvery2', { one: one })
          : translate('dynamicEvery', { n: n, many: many }),
      start: start,
      value3: end ? translate('dynamicUntil', { end: end }) : '',
    })
  }
  const billed =
    values.billing === 'paid'
      ? translate('paidSeparately')
      : values.billing === 'advance'
        ? translate('billedUpfront')
        : translate('billedAfterDelivery')
  return [who, when, billed].join(' · ')
}

/** What the system does once this is saved, as short sentences. */
export function nextSteps(values: FormValues): string[] {
  const recurring = values.recurrence !== 'none'
  const period = recurring ? translate('eachPeriod') : translate('thePeriod')
  const steps: string[] = []
  if (values.billing === 'paid') steps.push(translate('paidSeparatelyNextStep'))
  else if (!values.auto_invoice)
    steps.push(`No invoice is created automatically: you invoice ${period} yourself.`)
  else {
    steps.push(
      values.billing === 'advance'
        ? `An advance invoice draft is created when ${period} starts.`
        : `An invoice draft for what was delivered is created after ${period} ends.`,
    )
    steps.push('Nothing is sent or issued without you.')
  }
  // Not when the end date leaves a single period.
  if (recurring && schedulePeriods(values, 2).length !== 1)
    steps.push('A new period with the same quantity starts automatically.')
  if (canRollOver(values) && values.rollover)
    steps.push('Unused quantity carries into the next period only, then expires.')
  return steps
}

/** What a new engagement starts with from this person's habits (lib/habits), per client first. */
export const ENGAGEMENT_HABITS = [
  'unit',
  'billing',
  'price_basis',
  'vat_category',
  'recurrence',
  'interval',
  'rollover',
  'auto_invoice',
  'invoice_detail',
] as const satisfies readonly (keyof FormValues)[]

const oneOf =
  (...options: string[]) =>
  (value: string) =>
    options.includes(value)

const ENGAGEMENT_HABIT_OPTIONS = {
  unit: (unit: string) => UNITS.some((entry) => entry.value === unit),
  billing: oneOf('advance', 'arrears', 'paid'),
  price_basis: oneOf('net', 'gross'),
  vat_category: (code: string) => VAT_CATEGORIES.some((entry) => entry.value === code),
  recurrence: oneOf('none', 'weekly', 'monthly', 'quarterly', 'yearly'),
  interval: (interval: string) => /^\d{1,2}$/.test(interval),
  invoice_detail: oneOf('summary', 'per_entry'),
}

/** The preset length a one-off engagement ran for, learned with the rest; '' for a custom end. */
const durationOf = (values: FormValues) =>
  String(
    PRESET_MONTHS.find((months) => presetEnd(values.start_date, months) === values.end_date) ?? '',
  )

export function newValues(
  defaults: Defaults,
  habits: Habits,
  clientId = '',
  clientName = '',
): FormValues {
  const scope = clientId || null
  const values = withHabits(
    emptyValues(defaults, clientId, clientName),
    habits,
    'engagement',
    ENGAGEMENT_HABITS,
    {
      scope,
      // Without VAT registration everything is outside VAT: a habit can't change that.
      fixed: defaults.vat_registered ? [] : ['vat_category'],
      allowed: ENGAGEMENT_HABIT_OPTIONS,
    },
  )
  const { duration } = withHabits({ duration: '' }, habits, 'engagement', ['duration'], {
    scope,
    allowed: { duration: oneOf(...PRESET_MONTHS.map(String)) },
  })
  return {
    ...values,
    vat_rate: values.vat_category === 'S' ? defaults.default_vat_rate : '0',
    end_date:
      values.recurrence === 'none' && duration
        ? presetEnd(values.start_date, Number(duration))
        : values.end_date,
  }
}

/**
 * A client picked in a new form: its habits fill the habit fields (and what follows from them: the VAT
 * rate, a learned length) that still hold the values the form started with, leaving the user's changes alone.
 */
export function withClientHabits(
  values: FormValues,
  initial: FormValues,
  defaults: Defaults,
  habits: Habits,
  clientId: string,
): FormValues {
  const fresh = newValues(defaults, habits, clientId)
  const fields = [...ENGAGEMENT_HABITS, 'vat_rate', 'end_date'] as const
  const untouched = fields.filter((field) => values[field] === initial[field])
  return { ...values, ...Object.fromEntries(untouched.map((field) => [field, fresh[field]])) }
}

/** What a saved engagement teaches: its choices and, for one-off work, its length. */
export const habitValues = (values: FormValues) => ({ ...values, duration: durationOf(values) })
export const ENGAGEMENT_HABIT_FIELDS = [...ENGAGEMENT_HABITS, 'duration'] as const
