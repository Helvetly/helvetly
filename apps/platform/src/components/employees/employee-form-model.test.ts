import { employee, employmentSettings } from '@/mocks/employees'

import { newValues, toInput, validate, valuesFromEmployee } from './employee-form-model'

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
  expect(toInput({ ...before, bank_account: ' CH93 0076 2011 6238 5301 2 ' }, before)).toEqual({
    bank_account: 'CH93 0076 2011 6238 5301 2',
  })
})
