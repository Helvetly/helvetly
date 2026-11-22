import {
  choiceOf,
  notAChoice,
  textOf,
  UNIT_CHOICES,
  type Choice,
} from '@/components/import/form-import'
// The product form's state, checks and exact price preview (docs/products-contract.md).
import { withHabits, type Habits } from '@/lib/habits'
import { translate } from '@/lib/i18n'
import type { ImportValue } from '@/lib/imports'
import type { InvoiceSettings } from '@/lib/invoices'
import {
  fromCents,
  parseDecimalInput,
  toCents,
  UNITS,
  VAT_CATEGORIES,
  type Unit,
  type VatCategory,
} from '@/lib/invoices'
import type { PriceBasis, Product, ProductInput, ProductType } from '@/lib/products'

export type FormValues = {
  type: ProductType
  name: string
  description: string
  sku: string
  gtin: string
  unit: Unit | ''
  price_basis: PriceBasis
  unit_price: string
  currency: string
  vat_category: VatCategory
  vat_rate: string
}

export type FieldErrors = Partial<Record<keyof FormValues, string>>

/** Where errors are focused from, in form order. */
export const FIELD_ORDER: (keyof FormValues)[] = [
  'type',
  'name',
  'unit_price',
  'currency',
  'price_basis',
  'vat_category',
  'vat_rate',
  'unit',
  'sku',
  'gtin',
  'description',
]

export const DESCRIPTION_MAX = 1000
const MAX_PRICE_CENTS = 10_000_000_000n

/** What a new item starts with: the workspace's currency and VAT defaults. */
export type Defaults = { currency: string; vat_registered: boolean; default_vat_rate: string }

/** A new item's defaults from the invoice settings, with Swiss ones while they load. */
export const productDefaults = (
  settings: Pick<InvoiceSettings, 'currency' | 'vat_registered' | 'default_vat_rate'> | undefined,
): Defaults => ({
  currency: settings?.currency ?? 'CHF',
  vat_registered: settings?.vat_registered ?? true,
  default_vat_rate: settings?.default_vat_rate ?? '8.1',
})

export function emptyValues(defaults: Defaults): FormValues {
  return {
    type: 'service',
    name: '',
    description: '',
    sku: '',
    gtin: '',
    unit: '',
    price_basis: 'gross',
    unit_price: '',
    currency: defaults.currency,
    vat_category: defaults.vat_registered ? 'S' : 'O',
    vat_rate: defaults.vat_registered ? defaults.default_vat_rate : '0',
  }
}

export function valuesFromProduct(product: Product): FormValues {
  return {
    type: product.type,
    name: product.name,
    description: product.description ?? '',
    sku: product.sku ?? '',
    gtin: product.gtin ?? '',
    unit: product.unit ?? '',
    price_basis: product.price_basis,
    unit_price: product.unit_price,
    currency: product.currency,
    vat_category: product.vat_category,
    vat_rate: product.vat_rate,
  }
}

/** A GTIN-8/12/13/14 with its GS1 mod-10 check digit (spaces and dashes ignored). */
export function isGtin(input: string) {
  const digits = input.replace(/[\s-]/g, '')
  if (!/^(\d{8}|\d{12,14})$/.test(digits)) return false
  let sum = 0
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight)
    sum += Number(digits[i]) * weight
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1))
}

const rateOf = (values: FormValues) => parseDecimalInput(values.vat_rate, 2)

export function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}
  if (!values.name.trim()) errors.name = translate('enterAName')
  else if (values.name.trim().length > 200) errors.name = translate('useAtMost200Characters2')
  const price = parseDecimalInput(values.unit_price, 2, true)
  if (!values.unit_price.trim()) errors.unit_price = translate('enterAPrice2')
  else if (price === null || price.startsWith('-') || toCents(price) > MAX_PRICE_CENTS)
    errors.unit_price = translate('enterAPriceFrom0To1000000002')
  if (!/^[A-Z]{3}$/.test(values.currency)) errors.currency = translate('chooseACurrency')
  const rate = rateOf(values)
  if (values.vat_category === 'S') {
    if (rate === null || rate.startsWith('-') || Number(rate) > 100)
      errors.vat_rate = translate('enterAVATRateFrom0To100With')
    else if (Number(rate) === 0) errors.vat_rate = translate('aStandardRatedItemNeedsARateAbove0')
  }
  const sku = values.sku.trim()
  if (sku.length > 64) errors.sku = translate('useAtMost64Characters')
  else if (sku && !/^[A-Za-z0-9._/-]+$/.test(sku))
    errors.sku = translate('useLettersDigitsAndOnlyNoSpaces')
  if (values.type === 'product' && values.gtin.trim() && !isGtin(values.gtin))
    errors.gtin = translate('enterAGTINOf81213Or14')
  if (values.description.trim().length > DESCRIPTION_MAX)
    errors.description = translate('useAtMostCharacters3', { DESCRIPTION_MAX: DESCRIPTION_MAX })
  return errors
}

const orNull = (text: string) => text.trim() || null

export function toInput(values: FormValues): Partial<ProductInput> {
  const standard = values.vat_category === 'S'
  return {
    type: values.type,
    name: values.name.trim(),
    description: orNull(values.description),
    sku: orNull(values.sku),
    gtin: values.type === 'product' ? orNull(values.gtin.replace(/[\s-]/g, '')) : null,
    unit: values.unit || null,
    price_basis: values.price_basis,
    unit_price: parseDecimalInput(values.unit_price, 2, true) ?? values.unit_price,
    currency: values.currency,
    vat_category: values.vat_category,
    vat_rate: standard ? (rateOf(values) ?? values.vat_rate) : '0',
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

/** n / d rounded half away from zero, for n ≥ 0. */
const divRound = (n: bigint, d: bigint) => (2n * n + d) / (2n * d)

/**
 * Net, VAT and gross for one unit, as the server derives them (one rounding of the VAT, half away
 * from zero); null while the price or rate is not a number yet.
 */
export function pricePreview(
  values: Pick<FormValues, 'price_basis' | 'unit_price' | 'vat_category' | 'vat_rate'>,
) {
  const price = parseDecimalInput(values.unit_price, 2, true)
  const rate = values.vat_category === 'S' ? parseDecimalInput(values.vat_rate, 2, true) : '0.00'
  if (price === null || rate === null || price.startsWith('-') || rate.startsWith('-')) return null
  const cents = toCents(price)
  const basisPoints = toCents(rate) // a rate with two decimals, in hundredths of a percent
  const vat =
    values.price_basis === 'gross'
      ? divRound(cents * basisPoints, 10_000n + basisPoints)
      : divRound(cents * basisPoints, 10_000n)
  const net = values.price_basis === 'gross' ? cents - vat : cents
  return { net: fromCents(net), vat: fromCents(vat), gross: fromCents(net + vat) }
}

/** What a new item starts with from this person's habits (lib/habits); the rate follows the settings. */
export const PRODUCT_HABITS = [
  'type',
  'unit',
  'price_basis',
  'vat_category',
] as const satisfies readonly (keyof FormValues)[]

export const PRODUCT_HABIT_OPTIONS = {
  type: (type: string) => type === 'product' || type === 'service',
  unit: (unit: string) => UNITS.some((entry) => entry.value === unit),
  price_basis: (basis: string) => basis === 'net' || basis === 'gross',
  vat_category: (code: string) => VAT_CATEGORIES.some((entry) => entry.value === code),
}

export function newValues(defaults: Defaults, habits: Habits): FormValues {
  const values = withHabits(emptyValues(defaults), habits, 'product', PRODUCT_HABITS, {
    // Without VAT registration every item is outside VAT: a habit can't change that.
    fixed: defaults.vat_registered ? [] : ['vat_category'],
    allowed: PRODUCT_HABIT_OPTIONS,
  })
  return {
    ...values,
    vat_rate: values.vat_category === 'S' ? defaults.default_vat_rate : '0',
  }
}

// Import: a catalogue item read from a document, as the form's values

const TYPE_CHOICES: Choice<FormValues['type']>[] = [
  { value: 'product', aliases: ['goods', 'article', 'item'] },
  { value: 'service', aliases: ['work', 'hours', 'subscription', 'fee'] },
]
const BASIS_CHOICES: Choice<FormValues['price_basis']>[] = [
  { value: 'net', aliases: ['excl. vat', 'excluding vat'] },
  { value: 'gross', aliases: ['incl. vat', 'including vat'] },
]
const CATEGORY_CHOICES: Choice<VatCategory>[] = VAT_CATEGORIES.map((c) => ({
  value: c.value,
  aliases: [c.label],
}))

/**
 * An imported catalogue item as the form's values, from a new item's defaults. A value the form has no choice for
 * keeps the default and gets an error on its field.
 */
export function valuesFromImport(
  data: Record<string, ImportValue>,
  defaults: Defaults,
): { values: FormValues; errors: FieldErrors } {
  const values = emptyValues(defaults)
  const errors: FieldErrors = {}
  const pick = <T extends string>(field: keyof FormValues, choices: readonly Choice<T>[]) => {
    const choice = choiceOf(data[field], choices)
    if (choice === null) errors[field] = notAChoice(data[field])
    return choice ?? undefined
  }
  for (const field of ['name', 'description', 'sku', 'gtin', 'unit_price'] as const)
    values[field] = textOf(data[field])
  values.currency = textOf(data.currency).toUpperCase() || values.currency
  values.type = pick('type', TYPE_CHOICES) ?? values.type
  values.unit = pick('unit', UNIT_CHOICES) ?? values.unit
  values.price_basis = pick('price_basis', BASIS_CHOICES) ?? values.price_basis
  values.vat_category = pick('vat_category', CATEGORY_CHOICES) ?? values.vat_category
  if (values.vat_category !== 'S') values.vat_rate = '0'
  else if (textOf(data.vat_rate)) values.vat_rate = textOf(data.vat_rate).replace(/\s*%$/, '')
  return { values, errors }
}
