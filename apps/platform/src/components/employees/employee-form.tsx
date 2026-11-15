'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { COUNTRIES } from '@helvetly/ui/lib/countries'
import { cn } from '@helvetly/ui/lib/utils'
import { CircleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { inputClass, NativeSelect } from '@/components/clients/fields'
import { FormSection } from '@/components/form-section'
import { apiFieldErrors } from '@/components/section-form'
import { ApiError, errorMessage } from '@/lib/api'
import {
  EMPLOYMENT_TYPES,
  fullName,
  useCountries,
  useSaveEmployee,
  type Employee,
  type EmploymentSettings,
} from '@/lib/employees'

import {
  newValues,
  regionsOf,
  toInput,
  validate,
  valuesFromEmployee,
  type FieldErrors,
  type FormValues,
} from './employee-form-model'

const fieldId = (field: keyof FormValues) => `employee-${field}`

function CountrySelect({
  field,
  value,
  invalid,
  optional,
  onChange,
}: {
  field: keyof FormValues
  value: string
  invalid?: boolean
  optional?: boolean
  onChange: (code: string) => void
}) {
  return (
    <NativeSelect
      id={fieldId(field)}
      value={value}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${fieldId(field)}-error` : undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{optional ? 'Not set' : 'Choose a country'}</option>
      {COUNTRIES.map((country) => (
        <option key={country.code} value={country.code}>
          {country.name}
        </option>
      ))}
    </NativeSelect>
  )
}

/** Creates or edits an employee in a drawer from the right (full width on phones). */
export function EmployeeForm({
  employee,
  settings,
  onClose,
  onSaved,
}: {
  employee?: Employee
  /** The company's employment profile: pre-fills a new employee. */
  settings?: EmploymentSettings
  onClose: () => void
  onSaved: (employee: Employee, created: boolean) => void
}) {
  const [initial] = useState(() => (employee ? valuesFromEmployee(employee) : newValues(settings)))
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [discarding, setDiscarding] = useState(false)
  const countries = useCountries().data
  const save = useSaveEmployee()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const suggested = !employee && Boolean(settings?.country)
  const work = regionsOf(countries, values.work_country)
  const title = employee ? 'Edit employee' : 'New employee'

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  const submit = () => {
    if (save.isPending) return
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return focusFirst(found)
    save.mutate(
      { id: employee?.id, input: toInput(values, employee ? initial : undefined) },
      {
        onSuccess: (saved) => {
          toast.success(employee ? `${fullName(saved)} saved.` : `${fullName(saved)} added.`)
          onSaved(saved, !employee)
        },
        onError: (error) => {
          const fields = apiFieldErrors(error)
          if (fields && Object.keys(fields).length > 0) {
            setErrors(fields)
            focusFirst(fields)
          } else if (error instanceof ApiError && error.status === 409)
            // e.g. protected_fields_unavailable: the server cannot store bank account and tax id.
            setErrors({ form: error.message })
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  const requestClose = () => {
    if (save.isPending) return
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const field = (
    name: keyof FormValues,
    label: string,
    control: ReactNode,
    extra: { required?: boolean; tip?: string; hint?: ReactNode; className?: string } = {},
  ) => (
    <FormField id={fieldId(name)} label={label} error={errors[name]} {...extra}>
      {control}
    </FormField>
  )
  const text = (
    name: keyof FormValues,
    props: {
      type?: string
      placeholder?: string
      autoComplete?: string
      inputMode?: 'decimal'
    } = {},
  ) => {
    const value = values[name]
    return (
      <input
        id={fieldId(name)}
        value={typeof value === 'string' ? value : ''}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${fieldId(name)}-error` : undefined}
        onChange={(event) => set(name, event.target.value)}
        className={inputClass}
        {...props}
      />
    )
  }
  const suggestion = suggested ? (
    <span className="text-xs text-muted-foreground">Suggested from company settings</span>
  ) : undefined

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">Employee record</SheetDescription>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid shrink-0 gap-0.5 border-b px-5 py-4 md:px-8">
            <h2 className="truncate text-lg font-semibold">
              {employee ? `Edit ${fullName(employee)}` : title}
            </h2>
            <p className="text-body-sm text-muted-foreground">
              A staff record only: it gives no access to Helvetly and adds no paid seat.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {errors.form && (
              <div className="px-5 pt-5 md:px-8">
                <Callout tone="danger" icon={CircleAlert} role="alert">
                  {errors.form}
                </Callout>
              </div>
            )}
            <FormSection title="Personal" description="Who the employee is and how to reach them.">
              <div className="grid gap-4 sm:grid-cols-2">
                {field('first_name', 'First name', text('first_name', { autoComplete: 'off' }), {
                  required: true,
                })}
                {field('last_name', 'Last name', text('last_name', { autoComplete: 'off' }), {
                  required: true,
                })}
                {field(
                  'employee_number',
                  'Employee number',
                  text('employee_number', { placeholder: 'E-001' }),
                  { tip: 'Your own number; the payroll import can match employees by it.' },
                )}
                {field('email', 'Email', text('email', { type: 'email' }))}
                {field('phone', 'Phone', text('phone', { type: 'tel' }))}
                {field('street', 'Street', text('street'))}
                {field('postal_code', 'Postcode', text('postal_code'))}
                {field('city', 'City', text('city'))}
                {field(
                  'address_country',
                  'Country',
                  <CountrySelect
                    field="address_country"
                    optional
                    value={values.address_country}
                    onChange={(code) => set('address_country', code)}
                  />,
                )}
              </div>
            </FormSection>

            <FormSection title="Employment" description="The role and the dates it runs.">
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  'employment_type',
                  'Employment type',
                  <NativeSelect
                    id={fieldId('employment_type')}
                    value={values.employment_type}
                    onChange={(event) => set('employment_type', event.target.value)}
                  >
                    {EMPLOYMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </NativeSelect>,
                )}
                {field('position', 'Position', text('position'))}
                {field('department', 'Department', text('department'))}
                {field(
                  'working_time',
                  'Working time %',
                  text('working_time', { inputMode: 'decimal', placeholder: '100' }),
                )}
                {field(
                  'employment_start',
                  'Start date',
                  text('employment_start', { type: 'date' }),
                  {
                    required: true,
                  },
                )}
                {field('employment_end', 'End date', text('employment_end', { type: 'date' }), {
                  tip: 'Leave empty for an open-ended employment.',
                })}
              </div>
            </FormSection>

            <FormSection
              title="Place of work & jurisdiction"
              description="Where the work happens decides which rules apply, not the company’s seat."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {field('employing_entity', 'Employing company', text('employing_entity'), {
                  className: 'sm:col-span-2',
                  hint: suggestion,
                  tip: 'Empty takes the company name from the employment settings.',
                })}
                {field(
                  'employer_country',
                  'Employer country',
                  <CountrySelect
                    field="employer_country"
                    value={values.employer_country}
                    invalid={Boolean(errors.employer_country)}
                    onChange={(code) => set('employer_country', code)}
                  />,
                  { required: true, hint: suggestion },
                )}
                {field(
                  'work_country',
                  'Work country',
                  <CountrySelect
                    field="work_country"
                    value={values.work_country}
                    invalid={Boolean(errors.work_country)}
                    onChange={(code) => {
                      set('work_country', code)
                      set('work_region', '')
                    }}
                  />,
                  { required: true, hint: suggestion },
                )}
                {work?.region_label &&
                  field(
                    'work_region',
                    work.region_label,
                    <NativeSelect
                      id={fieldId('work_region')}
                      value={values.work_region}
                      aria-invalid={errors.work_region ? true : undefined}
                      onChange={(event) => set('work_region', event.target.value)}
                    >
                      <option value="">Choose a {work.region_label.toLowerCase()}</option>
                      {work.regions?.map((region) => (
                        <option key={region.code} value={region.code}>
                          {region.name}
                        </option>
                      ))}
                    </NativeSelect>,
                    { hint: suggestion },
                  )}
                {work?.locality &&
                  field('work_locality', 'City or county', text('work_locality'), {
                    tip: 'Some cities and counties have their own rules.',
                  })}
                {field('place_of_work', 'Place of work', text('place_of_work'), {
                  tip: 'The office or site, e.g. “Zürich office” or “Remote”.',
                })}
                {field(
                  'residence_country',
                  'Residence country',
                  <CountrySelect
                    field="residence_country"
                    optional
                    value={values.residence_country}
                    onChange={(code) => set('residence_country', code)}
                  />,
                )}
                {field(
                  'social_security_country',
                  'Social security country',
                  <CountrySelect
                    field="social_security_country"
                    optional
                    value={values.social_security_country}
                    onChange={(code) => set('social_security_country', code)}
                  />,
                )}
              </div>
              <label
                htmlFor={fieldId('cross_border')}
                className="flex items-center gap-2 text-body-sm"
              >
                <Checkbox
                  id={fieldId('cross_border')}
                  checked={values.cross_border}
                  onCheckedChange={(checked) => set('cross_border', checked === true)}
                />
                Works across a border (lives or works in more than one country)
              </label>
              {values.cross_border &&
                field(
                  'cross_border_note',
                  'Cross-border note',
                  <textarea
                    id={fieldId('cross_border_note')}
                    rows={2}
                    value={values.cross_border_note}
                    onChange={(event) => set('cross_border_note', event.target.value)}
                    className={cn(inputClass, 'h-auto min-h-16 resize-y py-2')}
                  />,
                )}
            </FormSection>

            <FormSection
              title="Protected"
              description="Stored encrypted. Only people who may see pay can reveal them."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  'bank_account',
                  'Bank account (IBAN)',
                  text('bank_account', { autoComplete: 'off' }),
                  {
                    hint: employee?.bank_account_hint ? (
                      <span className="text-xs text-muted-foreground">
                        Stored: ending {employee.bank_account_hint}. Leave empty to keep it.
                      </span>
                    ) : undefined,
                  },
                )}
                {field('tax_id', 'Tax ID', text('tax_id', { autoComplete: 'off' }), {
                  hint: employee?.tax_id_hint ? (
                    <span className="text-xs text-muted-foreground">
                      Stored: ending {employee.tax_id_hint}. Leave empty to keep it.
                    </span>
                  ) : undefined,
                })}
              </div>
            </FormSection>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
            <Button type="button" variant="ghost" className="ml-auto" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>

          {discarding && (
            <ConfirmDialog
              title="Discard your changes?"
              body="What you entered in this form will be lost."
              confirmLabel="Discard"
              cancelLabel="Keep editing"
              tone="destructive"
              onDecide={(discard) => {
                setDiscarding(false)
                if (discard) onClose()
              }}
            />
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}

function focusFirst(errors: FieldErrors) {
  const first = Object.keys(errors).find((key) => key !== 'form')
  if (first) requestAnimationFrame(() => document.getElementById(`employee-${first}`)?.focus())
}
