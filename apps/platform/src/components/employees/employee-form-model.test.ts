import { employee, employmentSettings } from '@/mocks/employees'

import {
  needsEnd,
  newValues,
  swissFields,
  toInput,
  validate,
  valuesFromEmployee,
} from './employee-form-model'

test('a new employee is pre-filled from the company settings', () => {
  expect(newValues(employmentSettings)).toMatchObject({
    employing_entity: 'Muster AG',
    employer_country: 'CH',
    work_country: 'CH',
    work_region: 'ZH',
  })
  expect(newValues(undefined).work_country).toBe('')
})

test('names, start date and both countries are required', () => {
  expect(Object.keys(validate(newValues(undefined))).toSorted()).toEqual([
    'employer_country',
    'employment_start',
    'first_name',
    'last_name',
    'work_country',
  ])
  const values = { ...valuesFromEmployee(employee()), employment_end: '2020-01-01' }
  expect(validate(values)).toEqual({
    employment_end: 'The end date cannot be before the start date.',
  })
})

test('create sends every field, blank as null; edit sends only changes', () => {
  const values = { ...newValues(undefined), first_name: ' Lara ', bank_account: '' }
  const input = toInput(values)
  expect(input.first_name).toBe('Lara')
  expect(input.email).toBeNull()
  expect(input.cross_border).toBe(false)
  expect(input).not.toHaveProperty('bank_account')

  const before = valuesFromEmployee(employee())
  expect(toInput({ ...before, position: 'Lead designer' }, before)).toEqual({
    position: 'Lead designer',
  })
})

test('protected fields go only when typed, so an edit never clears them', () => {
  const before = valuesFromEmployee(employee())
  expect(
    toInput(
      { ...before, bank_account: ' CH93 0076 2011 6238 5301 2 ', social_security_number: '' },
      before,
    ),
  ).toEqual({ bank_account: 'CH93 0076 2011 6238 5301 2' })
  expect(toInput({ ...before, social_security_number: '756.1234.5678.97' }, before)).toEqual({
    social_security_number: '756.1234.5678.97',
  })
})

test('a fixed-term contract needs its end date', () => {
  const values = { ...valuesFromEmployee(employee()), employment_type: 'fixed_term' }
  expect(needsEnd(values)).toBe(true)
  expect(validate(values)).toEqual({ employment_end: 'A fixed-term contract needs its end date.' })
  expect(validate({ ...values, employment_end: '2027-01-31' })).toEqual({})
  expect(needsEnd({ employment_type: 'hourly' })).toBe(false)
})

test.each([
  ['42', undefined],
  ['42,5', undefined],
  ['168', undefined],
  ['0', 'Enter the weekly hours, above 0 and up to 168.'],
  ['169', 'Enter the weekly hours, above 0 and up to 168.'],
  ['forty', 'Enter the weekly hours, above 0 and up to 168.'],
])('weekly hours %j: %s', (weekly_hours, error) => {
  expect(validate({ ...valuesFromEmployee(employee()), weekly_hours }).weekly_hours).toBe(error)
})

test('Swiss fields show for work in Switzerland only, and withholding tax needs its canton', () => {
  const swiss = valuesFromEmployee(employee())
  expect(swissFields(swiss)).toBe(true)
  expect(swissFields({ work_country: 'DE' })).toBe(false)
  expect(validate({ ...swiss, withholding_tax: true })).toEqual({
    withholding_tax_canton: 'Choose the canton the withholding tax is settled with.',
  })
  expect(validate({ ...swiss, withholding_tax: true, withholding_tax_canton: 'ZH' })).toEqual({})
  // Outside Switzerland the hidden fields cannot block saving, and withholding tax goes off.
  const abroad = { ...swiss, work_country: 'DE', withholding_tax: true }
  expect(validate(abroad)).toEqual({})
  expect(
    toInput(abroad, { ...swiss, withholding_tax: true, withholding_tax_canton: 'ZH' }),
  ).toEqual({
    work_country: 'DE',
    withholding_tax: false,
    withholding_tax_canton: null,
  })
})

test('weekly hours go with a decimal point', () => {
  expect(toInput({ ...newValues(undefined), weekly_hours: '42,5' }).weekly_hours).toBe('42.5')
})

test('phone: validated with its country, sent as E.164, read back nationally', () => {
  const values = { ...newValues(undefined), phone: '079 123 45 67', phone_country: 'CH' as const }
  expect(validate(values).phone).toBeUndefined()
  expect(toInput(values).phone).toBe('+41791234567')
  expect(validate({ ...values, phone: '12' }).phone).toBeTruthy()
  const stored = valuesFromEmployee(employee())
  expect(stored).toMatchObject({ phone: '044 555 01 01', phone_country: 'CH' })
  expect(toInput(stored, stored)).not.toHaveProperty('phone')
  expect(toInput({ ...stored, phone_country: 'DE' }, stored)).toHaveProperty('phone')
})

test('house number and apartment are their own fields', () => {
  const values = { ...newValues(undefined), street: 'Seefeldstrasse', street_number: '12', apt: '' }
  expect(toInput(values)).toMatchObject({
    street: 'Seefeldstrasse',
    street_number: '12',
    apt: null,
  })
})
