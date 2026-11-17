import {
  PHONE_ERROR,
  phoneCountryOr,
  phoneDraft,
  toE164,
  type CountryCode,
} from '@helvetly/ui/lib/phone'

import type { Country, Employee, EmployeeInput, EmploymentSettings } from '@/lib/employees'
import { translate } from '@/lib/i18n'

/** The form's fields, all as typed text (checkboxes: boolean). */
export type FormValues = {
  first_name: string
  last_name: string
  employee_number: string
  email: string
  phone: string
  /** Where a number typed without + belongs. */
  phone_country: CountryCode
  street: string
  street_number: string
  apt: string
  postal_code: string
  city: string
  address_country: string
  employment_type: string
  position: string
  department: string
  employment_start: string
  employment_end: string
  working_time: string
  weekly_hours: string
  notice_period: string
  employing_entity: string
  employer_country: string
  work_country: string
  work_region: string
  work_locality: string
  place_of_work: string
  residence_country: string
  social_security_country: string
  cross_border_note: string
  withholding_tax_canton: string
  pension_insurer: string
  accident_insurer: string
  sickness_insurer: string
  cross_border: boolean
  thirteenth_salary: boolean
  withholding_tax: boolean
  free_transport: boolean
  canteen_meals: boolean
  bank_account: string
  tax_id: string
  social_security_number: string
}
export type FieldErrors = Partial<Record<keyof FormValues | 'form', string>>

const TEXT_KEYS = [
  'first_name',
  'last_name',
  'employee_number',
  'email',
  'street',
  'street_number',
  'apt',
  'postal_code',
  'city',
  'address_country',
  'employment_type',
  'position',
  'department',
  'employment_start',
  'employment_end',
  'working_time',
  'weekly_hours',
  'notice_period',
  'employing_entity',
  'employer_country',
  'work_country',
  'work_region',
  'work_locality',
  'place_of_work',
  'residence_country',
  'social_security_country',
  'cross_border_note',
  'withholding_tax_canton',
  'pension_insurer',
  'accident_insurer',
  'sickness_insurer',
] as const satisfies readonly (keyof FormValues & keyof Employee)[]

const FLAG_KEYS = [
  'cross_border',
  'thirteenth_salary',
  'withholding_tax',
  'free_transport',
  'canteen_meals',
] as const satisfies readonly (keyof FormValues & keyof Employee)[]

/** Write-only: sent only when typed into, so an edit never clears a stored value by leaving it blank. */
const SEALED_KEYS = ['bank_account', 'tax_id', 'social_security_number'] as const

/** A new employee, pre-filled from the company's employment settings (a suggestion, never a decision). */
export function newValues(settings: EmploymentSettings | undefined): FormValues {
  return {
    first_name: '',
    last_name: '',
    employee_number: '',
    email: '',
    phone: '',
    phone_country: phoneCountryOr(settings?.country),
    street: '',
    street_number: '',
    apt: '',
    postal_code: '',
    city: '',
    address_country: '',
    employment_type: 'permanent',
    position: '',
    department: '',
    employment_start: '',
    employment_end: '',
    working_time: '',
    weekly_hours: '',
    notice_period: '',
    employing_entity: settings?.employing_entity ?? '',
    employer_country: settings?.country ?? '',
    work_country: settings?.country ?? '',
    work_region: settings?.region ?? '',
    work_locality: '',
    place_of_work: '',
    residence_country: '',
    social_security_country: '',
    cross_border_note: '',
    withholding_tax_canton: '',
    pension_insurer: '',
    accident_insurer: '',
    sickness_insurer: '',
    cross_border: false,
    thirteenth_salary: false,
    withholding_tax: false,
    free_transport: false,
    canteen_meals: false,
    bank_account: '',
    tax_id: '',
    social_security_number: '',
  }
}

export function valuesFromEmployee(employee: Employee): FormValues {
  const values = newValues(undefined)
  for (const key of TEXT_KEYS) values[key] = employee[key] ?? ''
  for (const key of FLAG_KEYS) values[key] = employee[key]
  const phone = phoneDraft(employee.phone, employee.address_country ?? employee.work_country)
  values.phone = phone.phone
  values.phone_country = phone.country
  return values
}

/** Swiss withholding tax, BVG, UVG, KTG and salary certificate boxes: recorded for work in Switzerland only. */
export const swissFields = (values: Pick<FormValues, 'work_country'>) =>
  values.work_country === 'CH'

/** A fixed-term contract ends on a known date. */
export const needsEnd = (values: Pick<FormValues, 'employment_type'>) =>
  values.employment_type === 'fixed_term'

const HOURS = /^\d{1,3}([.,]\d{1,3})?$/

/** What the browser can tell before sending; the server checks everything again. */
export function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}
  if (!values.first_name.trim()) errors.first_name = translate('employeeErrorFirstName')
  if (!values.last_name.trim()) errors.last_name = translate('employeeErrorLastName')
  if (!values.employment_start) errors.employment_start = translate('employeeErrorStart')
  if (!values.employer_country) errors.employer_country = translate('employeeErrorEmployerCountry')
  if (!values.work_country) errors.work_country = translate('employeeErrorWorkCountry')
  if (needsEnd(values) && !values.employment_end)
    errors.employment_end = translate('employeeErrorFixedTermEnd')
  else if (values.employment_end && values.employment_end < values.employment_start)
    errors.employment_end = translate('employeeErrorEndBeforeStart')
  if (values.phone.trim() && !toE164(values.phone, values.phone_country)) errors.phone = PHONE_ERROR
  const hours = values.weekly_hours.trim()
  if (hours) {
    const number = Number(hours.replace(',', '.'))
    if (!HOURS.test(hours) || number <= 0 || number > 168)
      errors.weekly_hours = translate('employeeErrorWeeklyHours')
  }
  if (swissFields(values) && values.withholding_tax && !values.withholding_tax_canton)
    errors.withholding_tax_canton = translate('employeeErrorWithholdingCanton')
  return errors
}

/** The region choices of a country (cantons, states), or none. */
export const regionsOf = (countries: Country[] | undefined, code: string) =>
  countries?.find((country) => country.code === code)

/**
 * What to send: every field on create (blank text is null), only the changed ones on edit. Withholding tax goes
 * off outside Switzerland, where the form hides it and the server refuses it. Sealed fields go only when typed.
 */
export function toInput(values: FormValues, before?: FormValues): EmployeeInput {
  const withholding = swissFields(values) && values.withholding_tax
  const next: FormValues = {
    ...values,
    withholding_tax: withholding,
    withholding_tax_canton: withholding ? values.withholding_tax_canton : '',
  }
  const input: EmployeeInput = {}
  for (const key of TEXT_KEYS) {
    if (before && next[key] === before[key]) continue
    const text = next[key].trim()
    input[key] = text === '' ? null : key === 'weekly_hours' ? text.replace(',', '.') : text
  }
  if (!before || next.phone !== before.phone || next.phone_country !== before.phone_country)
    input.phone = next.phone.trim() ? toE164(next.phone, next.phone_country) : null
  for (const key of FLAG_KEYS) if (!before || next[key] !== before[key]) input[key] = next[key]
  for (const key of SEALED_KEYS) if (next[key].trim()) input[key] = next[key].trim()
  return input
}
