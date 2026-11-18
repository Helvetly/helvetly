import { learnValues, type Habits } from '@/lib/habits'

import {
  emptyValues,
  newValues,
  PRODUCT_HABITS,
  isGtin,
  pricePreview,
  serverFieldErrors,
  toInput,
  validate,
  type FormValues,
} from './product-form-model'

const defaults = { currency: 'CHF', vat_registered: true, default_vat_rate: '8.1' }
const values = (change: Partial<FormValues>): FormValues => ({
  ...emptyValues(defaults),
  name: 'Consulting',
  price_basis: 'net',
  unit_price: '150',
  ...change,
})

test('previews net, VAT and gross exactly as the server derives them', () => {
  const cases: [Partial<FormValues>, { net: string; vat: string; gross: string } | null][] = [
    [{ unit_price: '100' }, { net: '100.00', vat: '8.10', gross: '108.10' }],
    [
      { price_basis: 'gross', unit_price: '108.10' },
      { net: '100.00', vat: '8.10', gross: '108.10' },
    ],
    [
      { price_basis: 'gross', unit_price: '10' },
      { net: '9.25', vat: '0.75', gross: '10.00' },
    ],
    [
      { unit_price: "1'234,5", vat_rate: '2.6' },
      { net: '1234.50', vat: '32.10', gross: '1266.60' },
    ],
    [
      { unit_price: '0.05', vat_rate: '10' },
      { net: '0.05', vat: '0.01', gross: '0.06' },
    ], // 0.005 rounds up
    [
      { vat_category: 'E', unit_price: '50' },
      { net: '50.00', vat: '0.00', gross: '50.00' },
    ],
    [{ unit_price: 'abc' }, null],
  ]
  for (const [change, want] of cases) expect(pricePreview(values(change))).toEqual(want)
})

test('checks what the server would refuse', () => {
  expect(validate(values({}))).toEqual({})
  expect(Object.keys(validate(values({ name: ' ', unit_price: '' })))).toEqual([
    'name',
    'unit_price',
  ])
  expect(validate(values({ unit_price: '1.234' })).unit_price).toBeDefined()
  expect(validate(values({ vat_rate: '0' })).vat_rate).toMatch(/above 0/)
  expect(validate(values({ vat_category: 'Z', vat_rate: '0' }))).toEqual({})
  expect(validate(values({ sku: 'has space' })).sku).toBeDefined()
  expect(validate(values({ type: 'product', gtin: '4006381333932' })).gtin).toBeDefined()
  expect(validate(values({ type: 'service', gtin: 'ignored for services' }))).toEqual({})
})

test('GTIN check digits', () => {
  expect(
    ['96385074', '036000291452', '4006381333931', '10012345678902', '400 6381 33393-1'].map(isGtin),
  ).toEqual([true, true, true, true, true])
  expect(['4006381333932', '1234567', '400638133393a'].map(isGtin)).toEqual([false, false, false])
})

test('sends clean input: blanks as null, the rate only for standard-rated items', () => {
  expect(toInput(values({ unit_price: '12,5', sku: ' A-1 ', description: '  ' }))).toEqual({
    type: 'service',
    name: 'Consulting',
    description: null,
    sku: 'A-1',
    gtin: null,
    unit: null,
    price_basis: 'net',
    unit_price: '12.50',
    currency: 'CHF',
    vat_category: 'S',
    vat_rate: '8.1',
  })
  expect(toInput(values({ vat_category: 'G', vat_rate: '8.1' })).vat_rate).toBe('0')
  expect(toInput(values({ type: 'product', gtin: '9638-5074' })).gtin).toBe('96385074')
})

test('keeps the server’s messages for the fields the form has', () => {
  expect(serverFieldErrors({ fields: { sku: 'Taken.', other: 'x', name: 3 } })).toEqual({
    sku: 'Taken.',
  })
  expect(serverFieldErrors({})).toEqual({})
})

test('a new item starts with the usual type and VAT category; the rate follows the settings', () => {
  const usual = {
    ...emptyValues(defaults),
    type: 'product' as const,
    vat_category: 'S' as const,
    vat_rate: '2.6',
  }
  const habits = [1, 2].reduce<Habits>((h) => learnValues(h, 'product', usual, PRODUCT_HABITS), {})
  expect(newValues(defaults, habits)).toMatchObject({
    type: 'product',
    vat_category: 'S',
    vat_rate: defaults.default_vat_rate,
  })
})

test('a new item is priced gross unless the person usually enters net', () => {
  expect(emptyValues(defaults).price_basis).toBe('gross')
  expect(newValues(defaults, {}).price_basis).toBe('gross')
  const usual = { ...emptyValues(defaults), price_basis: 'net' as const }
  const habits = [1, 2].reduce<Habits>((h) => learnValues(h, 'product', usual, PRODUCT_HABITS), {})
  expect(newValues(defaults, habits).price_basis).toBe('net')
})
