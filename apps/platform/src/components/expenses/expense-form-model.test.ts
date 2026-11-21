import {
  emptyValues,
  firstError,
  itemAmount,
  mergedByRate,
  mergeLoses,
  newLine,
  serverFieldErrors,
  toInput,
  validate,
  withCategoryRate,
  withEntryMode,
  withSupplierCountry,
  type FormValues,
} from './expense-form-model'

const TODAY = '2026-11-05'
const filled = (change: Partial<FormValues> = {}): FormValues => ({
  ...emptyValues('CHF', '8.1', true),
  supplier_name: ' SBB ',
  document_date: '2026-11-03',
  category_id: 'exc_travel',
  lines: [{ ...newLine('8.1'), amount: "1'080,50" }],
  ...change,
})
const options = { userId: 'usr_1', baseCurrency: 'CHF', booked: false }

test('a draft saves with nothing filled in; booking needs supplier, date, category and amount', () => {
  const empty = emptyValues('CHF', '8.1', true)
  expect(validate(empty, TODAY, false)).toEqual({})
  expect(Object.keys(validate(empty, TODAY, true)).toSorted()).toEqual(
    ['category_id', 'document_date', 'lines.0.amount', 'supplier_name'].toSorted(),
  )
  expect(validate(filled(), TODAY, true)).toEqual({})
})

test('dates, amounts, rates and shares are checked before sending', () => {
  const errors = validate(
    filled({
      document_date: '2026-11-04',
      due_date: '2026-11-01',
      paid: true,
      paid_on: '2026-12-01',
      input_tax: 'partial',
      deductible_percent: '100',
      lines: [{ ...newLine('120'), amount: '12.345' }],
    }),
    TODAY,
    true,
  )
  expect(Object.keys(errors).toSorted()).toEqual(
    ['deductible_percent', 'due_date', 'lines.0.amount', 'lines.0.vat_rate', 'paid_on'].toSorted(),
  )
  expect(validate(filled({ document_date: '2026-11-06' }), TODAY, true).document_date).toMatch(
    /future/,
  )
})

test('the input sends exact decimals, blanks as null and drops the empty last line', () => {
  const input = toInput(
    filled({ lines: [{ ...newLine('8.1'), amount: "1'080,50" }, newLine('8.1')] }),
    options,
  )
  expect(input).toMatchObject({
    supplier_name: 'SBB',
    reference: null,
    category_id: 'exc_travel',
    lines: [{ description: null, amount: '1080.50', vat_rate: '8.1' }],
    input_tax: 'full',
    payment_status: 'unpaid',
    exchange_rate_date: null,
  })
  expect(input).not.toHaveProperty('deductible_percent')
  expect(input).not.toHaveProperty('exchange_rate')
})

test('foreign currency, partial input tax and out-of-pocket payment', () => {
  const input = toInput(
    filled({
      currency: 'EUR',
      exchange_rate: '0,9412',
      exchange_rate_date: '2026-11-01',
      exchange_rate_source: 'estv_monthly',
      input_tax: 'partial',
      deductible_percent: '50',
      paid: true,
      out_of_pocket: true,
      reimbursed_on: '',
    }),
    options,
  )
  expect(input).toMatchObject({
    currency: 'EUR',
    exchange_rate: '0.9412',
    exchange_rate_source: 'estv_monthly',
    deductible_percent: '50',
    payment_status: 'paid',
    paid_on: null,
    paid_by_member_id: 'usr_1',
    reimbursed_on: null,
  })
})

test('editing an out-of-pocket expense keeps the original payer', () => {
  const values = {
    ...filled({ paid: true, out_of_pocket: true, note: 'Corrected note' }),
    paid_by_member_id: 'usr_original_payer',
  }
  expect(toInput(values, { ...options, userId: 'usr_editor', booked: true })).toMatchObject({
    paid_by_member_id: 'usr_original_payer',
    note: 'Corrected note',
  })
})

test('a booked expense sends only its payment and note', () => {
  expect(
    toInput(filled({ paid: true, paid_on: '2026-11-04', payment_method: 'twint', note: ' ok ' }), {
      ...options,
      booked: true,
    }),
  ).toEqual({
    payment_status: 'paid',
    paid_on: '2026-11-04',
    payment_method: 'twint',
    paid_by_member_id: null,
    reimbursed_on: null,
    note: 'ok',
  })
})

test('server errors map onto the form and focus follows the form order', () => {
  const errors = serverFieldErrors({
    fields: {
      'lines.1.amount': 'Too much.',
      category: 'Choose one.',
      supplier_vat_number: 'Bad UID.',
    },
  })
  expect(errors).toEqual({
    'lines.1.amount': 'Too much.',
    category_id: 'Choose one.',
    supplier_vat_number: 'Bad UID.',
  })
  expect(firstError(errors)).toBe('supplier_vat_number')
  expect(serverFieldErrors({})).toEqual({})
})

test('a foreign supplier defaults to no Swiss input tax; Swiss VAT is reclaimable again', () => {
  const german = withSupplierCountry(filled(), 'DE', true)
  expect(german).toMatchObject({
    supplier_country: 'DE',
    input_tax: 'none',
    deductible_percent: '0',
  })
  expect(toInput(german, options)).toMatchObject({ supplier_country: 'DE', input_tax: 'none' })
  expect(withSupplierCountry(german, 'LI', true)).toMatchObject({
    input_tax: 'full',
    deductible_percent: '100',
  })
  expect(withSupplierCountry(german, 'CH', false)).toMatchObject({ input_tax: 'none' })
  // The person may still choose otherwise afterwards: the default is only applied on a country change.
  expect(
    toInput({ ...german, input_tax: 'full', deductible_percent: '100' }, options),
  ).toMatchObject({
    input_tax: 'full',
  })
})

const linesAt = (...rates: string[]) => rates.map((rate) => ({ ...newLine(rate), amount: '10' }))

describe('withCategoryRate', () => {
  test.each([
    ['lines at the old suggestion take the new one', ['8.1', '8.1'], '8.1', '3.8', ['3.8', '3.8']],
    ['a rate someone chose stays', ['8.1', '2.6'], '8.1', '0', ['0', '2.6']],
    ['no suggestion leaves the lines', ['8.1'], '8.1', null, ['8.1']],
    ['a workspace outside VAT gets none', ['0'], null, '8.1', ['0']],
    ['back from an exempt category', ['0'], '0', '8.1', ['8.1']],
  ])('%s', (_, rates, from, to, want) => {
    const values = filled({ lines: linesAt(...rates) })
    expect(withCategoryRate(values, from, to).lines.map((line) => line.vat_rate)).toEqual(want)
  })
})
const item = (
  amount: string,
  vat_rate: string,
  change: Partial<FormValues['lines'][number]> = {},
) => ({
  ...newLine(vat_rate),
  amount,
  ...change,
})

test('items send their category, quantity and unit price; one amount sends none of them', () => {
  const values = filled({
    entry_mode: 'itemised',
    lines: [
      item('108.10', '8.1', { category_id: 'exc_it', quantity: '2', unit_price: '54.05' }),
      item('20', '0'),
    ],
  })
  expect(toInput(values, options)).toMatchObject({
    entry_mode: 'itemised',
    lines: [
      {
        amount: '108.10',
        vat_rate: '8.1',
        category_id: 'exc_it',
        quantity: '2',
        unit_price: '54.05',
      },
      { amount: '20.00', vat_rate: '0', category_id: null, quantity: null, unit_price: null },
    ],
  })
  const single = toInput(filled(), options)
  expect(single.entry_mode).toBe('single')
  expect(single.lines?.[0]).toEqual({ description: null, amount: '1080.50', vat_rate: '8.1' })
})

test('an item checks its quantity and unit price', () => {
  const errors = validate(
    filled({
      entry_mode: 'itemised',
      lines: [item('10', '8.1', { quantity: '0', unit_price: 'x' })],
    }),
    TODAY,
    false,
  )
  expect(errors).toMatchObject({
    'lines.0.quantity': expect.any(String),
    'lines.0.unit_price': expect.any(String),
  })
})

test('quantity × unit price is exact to the cent, rounded half up', () => {
  expect(itemAmount('3', '0.335')).toBeNull() // three decimals is no price
  expect(itemAmount('1.5', '2.35')).toBe('3.53')
  expect(itemAmount("1'000", '0.10')).toBe('100.00')
  expect(itemAmount('', '5')).toBeNull()
  expect(itemAmount('-1', '5')).toBeNull()
})

test("items become one amount per VAT rate, exactly, keeping a lone line's description", () => {
  const lines = [
    item('0.10', '8.1'),
    item('', '8.1'),
    item('5.00', '2.6', { description: 'Book' }),
    item('0.20', '8.1'),
  ]
  expect(
    mergedByRate(lines).map(({ amount, vat_rate, description }) => [amount, vat_rate, description]),
  ).toEqual([
    ['0.30', '8.1', ''],
    ['5.00', '2.6', 'Book'],
  ])
})

test('merging asks first only when it drops something entered', () => {
  expect(mergeLoses([item('10', '8.1', { description: 'Lunch' }), item('5', '2.6')])).toBe(false)
  expect(mergeLoses([item('10', '8.1', { description: 'Lunch' }), item('5', '8.1')])).toBe(true)
  expect(mergeLoses([item('10', '8.1', { category_id: 'exc_it' })])).toBe(true)
  expect(mergeLoses([item('10', '8.1', { quantity: '2' })])).toBe(true)
})

test('switching to items keeps the lines; back to one amount merges them', () => {
  const values = filled({ lines: [item('10', '8.1'), item('5', '8.1')] })
  const itemised = withEntryMode(values, 'itemised')
  expect(itemised.entry_mode).toBe('itemised')
  expect(itemised.lines).toBe(values.lines)
  const single = withEntryMode(itemised, 'single')
  expect(single.lines.map((line) => line.amount)).toEqual(['15.00'])
  expect(withEntryMode(single, 'single')).toBe(single)
})
