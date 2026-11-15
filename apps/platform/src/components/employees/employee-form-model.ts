import type { Country, Employee, EmployeeInput, EmploymentSettings } from '@/lib/employees'

/** The form's fields, all as typed text (checkbox: boolean). */
export type FormValues = {
  first_name: string
  last_name: string
  employee_number: string
  email: string
  phone: string
  street: string
  postal_code: string
  city: string
  address_country: string
  employment_type: string
  position: string
  department: string
  employment_start: string
  employment_end: string
  working_time: string
  employing_entity: string
  employer_country: string
  work_country: string
  work_region: string
  work_locality: string
  place_of_work: string
  residence_country: string
  social_security_country: string
  cross_border: boolean
  cross_border_note: string
  bank_account: string
  tax_id: string
}
export type FieldErrors = Partial<Record<keyof FormValues | 'form', string>>

const TEXT_KEYS = [
  'first_name',
  'last_name',
  'employee_number',
  'email',
  'phone',
  'street',
  'postal_code',
  'city',
  'address_country',
  'employment_type',
  'position',
  'department',
  'employment_start',
  'employment_end',
  'working_time',
  'employing_entity',
  'employer_country',
  'work_country',
  'work_region',
  'work_locality',
  'place_of_work',
  'residence_country',
  'social_security_country',
  'cross_border_note',
] as const satisfies readonly (keyof FormValues & keyof Employee)[]

/** A new employee, pre-filled from the company's employment settings (a suggestion, never a decision). */
export function newValues(settings: EmploymentSettings | undefined): FormValues {
  return {
    first_name: '',
    last_name: '',
    employee_number: '',
    email: '',
    phone: '',
    street: '',
    postal_code: '',
    city: '',
    address_country: '',
    employment_type: 'permanent',
    position: '',
    department: '',
    employment_start: '',
    employment_end: '',
    working_time: '',
    employing_entity: settings?.employing_entity ?? '',
    employer_country: settings?.country ?? '',
    work_country: settings?.country ?? '',
    work_region: settings?.region ?? '',
    work_locality: '',
    place_of_work: '',
    residence_country: '',
    social_security_country: '',
    cross_border: false,
    cross_border_note: '',
    bank_account: '',
    tax_id: '',
  }
}

export function valuesFromEmployee(employee: Employee): FormValues {
  const values = newValues(undefined)
  for (const key of TEXT_KEYS) values[key] = employee[key] ?? ''
  values.cross_border = employee.cross_border
  return values
}

/** The fields the server requires on create; it checks them again. */
export function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}
  if (!values.first_name.trim()) errors.first_name = 'Enter the first name.'
  if (!values.last_name.trim()) errors.last_name = 'Enter the last name.'
  if (!values.employment_start) errors.employment_start = 'Enter the start date.'
  if (!values.employer_country) errors.employer_country = 'Choose the employer’s country.'
  if (!values.work_country) errors.work_country = 'Choose the country of work.'
  if (values.employment_end && values.employment_end < values.employment_start)
    errors.employment_end = 'The end date cannot be before the start date.'
  return errors
}

/** The region choices of a country (cantons, states), or none. */
export const regionsOf = (countries: Country[] | undefined, code: string) =>
  countries?.find((country) => country.code === code)

/**
 * What to send: every text field (blank is null) on create, only the changed ones on edit. The protected
 * fields go only when typed into, so an edit never clears a stored bank account by leaving it blank.
 */
export function toInput(values: FormValues, before?: FormValues): EmployeeInput {
  const input: EmployeeInput = {}
  for (const key of TEXT_KEYS) {
    if (before && values[key] === before[key]) continue
    const text = values[key].trim()
    input[key] = text === '' ? null : text
  }
  if (!before || values.cross_border !== before.cross_border)
    input.cross_border = values.cross_border
  if (values.bank_account.trim()) input.bank_account = values.bank_account.trim()
  if (values.tax_id.trim()) input.tax_id = values.tax_id.trim()
  return input
}
