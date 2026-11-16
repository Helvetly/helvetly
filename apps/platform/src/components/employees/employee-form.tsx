'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField, HelpTip } from '@helvetly/ui/components/form-field'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { COUNTRIES } from '@helvetly/ui/lib/countries'
import { cn } from '@helvetly/ui/lib/utils'
import { Briefcase, CircleAlert, Lock, MapPin, ShieldCheck, UserRound } from 'lucide-react'
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
import { translate } from '@/lib/i18n'

import {
  needsEnd,
  newValues,
  regionsOf,
  swissFields,
  toInput,
  validate,
  valuesFromEmployee,
  type FieldErrors,
  type FormValues,
} from './employee-form-model'

const fieldId = (field: keyof FormValues) => `employee-${field}`
const describe = (field: keyof FormValues, error: string | undefined) => ({
  id: fieldId(field),
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${fieldId(field)}-error` : undefined,
})

type TextKey = {
  [K in keyof FormValues]: FormValues[K] extends string ? K : never
}[keyof FormValues]
type FlagKey = {
  [K in keyof FormValues]: FormValues[K] extends boolean ? K : never
}[keyof FormValues]

const stored = (hint: string | null | undefined) =>
  hint ? translate('employeeStoredHint', { hint }) : undefined

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
  const cantons = regionsOf(countries, 'CH')?.regions ?? []
  const title = employee ? translate('employeeEditTitle') : translate('employeeNewTitle')

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
          toast.success(
            translate(employee ? 'employeeSavedToast' : 'employeeAddedToast', {
              name: fullName(saved),
            }),
          )
          onSaved(saved, !employee)
        },
        onError: (error) => {
          const fields = apiFieldErrors(error)
          if (fields && Object.keys(fields).length > 0) {
            setErrors(fields)
            focusFirst(fields)
          } else if (error instanceof ApiError && (error.status === 409 || error.status === 403))
            // e.g. protected_fields_unavailable, restricted, or a plan without the module
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
    name: TextKey,
    props: {
      type?: string
      placeholder?: string
      autoComplete?: string
      inputMode?: 'decimal'
    } = {},
  ) => (
    <input
      {...describe(name, errors[name])}
      value={values[name]}
      onChange={(event) => set(name, event.target.value)}
      className={inputClass}
      {...props}
    />
  )
  const country = (name: TextKey, optional = false) => (
    <NativeSelect
      {...describe(name, errors[name])}
      value={values[name]}
      onChange={(event) => set(name, event.target.value)}
    >
      <option value="">
        {optional ? translate('employeeNotSet') : translate('employeeChooseCountry')}
      </option>
      {COUNTRIES.map((entry) => (
        <option key={entry.code} value={entry.code}>
          {entry.name}
        </option>
      ))}
    </NativeSelect>
  )
  const flag = (name: FlagKey, label: string, tip?: string) => (
    <div className="grid gap-1">
      <span className="flex min-h-8 items-center gap-2 text-body-sm">
        <Checkbox
          {...describe(name, errors[name])}
          checked={values[name]}
          onCheckedChange={(checked) => set(name, checked === true)}
        />
        <label htmlFor={fieldId(name)}>{label}</label>
        {tip && <HelpTip label={label}>{tip}</HelpTip>}
      </span>
      {errors[name] && (
        <p id={`${fieldId(name)}-error`} className="text-xs text-destructive">
          {errors[name]}
        </p>
      )}
    </div>
  )

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('employeeRecord')}</SheetDescription>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b px-5 py-4 md:px-8">
            <h2 className="truncate text-lg font-semibold">
              {employee ? translate('employeeEditName', { name: fullName(employee) }) : title}
            </h2>
            <HelpTip label={translate('employeeStaffRecordLabel')}>
              {translate('employeeStaffRecordTip')}
            </HelpTip>
          </div>

          <div className="min-h-0 flex-1 scroll-py-4 overflow-y-auto">
            {errors.form && (
              <div className="px-5 pt-5 md:px-8">
                <Callout tone="danger" icon={CircleAlert} role="alert">
                  {errors.form}
                </Callout>
              </div>
            )}
            <FormSection
              icon={UserRound}
              title={translate('employeeSectionPerson')}
              description={translate('employeeSectionPersonDesc')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  'first_name',
                  translate('employeeFirstName'),
                  text('first_name', { autoComplete: 'off' }),
                  { required: true },
                )}
                {field(
                  'last_name',
                  translate('employeeLastName'),
                  text('last_name', { autoComplete: 'off' }),
                  { required: true },
                )}
                {field('email', translate('employeeEmail'), text('email', { type: 'email' }))}
                {field('phone', translate('employeePhone'), text('phone', { type: 'tel' }))}
                {field('street', translate('employeeStreet'), text('street'), {
                  className: 'sm:col-span-2',
                })}
                {field('postal_code', translate('employeePostcode'), text('postal_code'))}
                {field('city', translate('employeeCity'), text('city'))}
                {field(
                  'address_country',
                  translate('employeeAddressCountry'),
                  country('address_country', true),
                )}
              </div>
            </FormSection>

            <FormSection
              icon={Briefcase}
              title={translate('employeeSectionContract')}
              description={translate('employeeSectionContractDesc')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  'employment_type',
                  translate('employeeEmploymentType'),
                  <NativeSelect
                    {...describe('employment_type', errors.employment_type)}
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
                {field(
                  'employee_number',
                  translate('employeeNumber'),
                  text('employee_number', { placeholder: 'E-001' }),
                  { tip: translate('employeeNumberTip') },
                )}
                {field('position', translate('employeePosition'), text('position'))}
                {field('department', translate('employeeDepartment'), text('department'))}
                {field(
                  'employment_start',
                  translate('employeeStart'),
                  text('employment_start', { type: 'date' }),
                  { required: true },
                )}
                {field(
                  'employment_end',
                  translate('employeeEnd'),
                  text('employment_end', { type: 'date' }),
                  needsEnd(values) ? { required: true } : { tip: translate('employeeEndTip') },
                )}
                {field(
                  'weekly_hours',
                  translate('employeeWeeklyHours'),
                  text('weekly_hours', { inputMode: 'decimal', placeholder: '42' }),
                )}
                {field(
                  'working_time',
                  translate('employeeWorkingTime'),
                  text('working_time', { inputMode: 'decimal', placeholder: '100' }),
                  { tip: translate('employeeWorkingTimeTip') },
                )}
                {field(
                  'notice_period',
                  translate('employeeNoticePeriod'),
                  text('notice_period', { placeholder: translate('employeeNoticePlaceholder') }),
                  { className: 'sm:col-span-2' },
                )}
              </div>
              {flag(
                'thirteenth_salary',
                translate('employeeThirteenth'),
                translate('employeeThirteenthTip'),
              )}
            </FormSection>

            <FormSection
              icon={MapPin}
              title={translate('employeeSectionWork')}
              description={translate('employeeSectionWorkDesc')}
              tip={
                suggested
                  ? `${translate('employeeWorkTip')} ${translate('employeeSuggestedTip')}`
                  : translate('employeeWorkTip')
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  'employing_entity',
                  translate('employeeEmployingEntity'),
                  text('employing_entity'),
                  {
                    className: 'sm:col-span-2',
                    tip: translate('employeeEmployingEntityTip'),
                  },
                )}
                {field(
                  'employer_country',
                  translate('employeeEmployerCountry'),
                  country('employer_country'),
                  { required: true },
                )}
                {field(
                  'work_country',
                  translate('employeeWorkCountry'),
                  <NativeSelect
                    {...describe('work_country', errors.work_country)}
                    value={values.work_country}
                    onChange={(event) => {
                      set('work_country', event.target.value)
                      set('work_region', '')
                    }}
                  >
                    <option value="">{translate('employeeChooseCountry')}</option>
                    {COUNTRIES.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </NativeSelect>,
                  { required: true },
                )}
                {work?.region_label &&
                  field(
                    'work_region',
                    work.region_label,
                    <NativeSelect
                      {...describe('work_region', errors.work_region)}
                      value={values.work_region}
                      onChange={(event) => set('work_region', event.target.value)}
                    >
                      <option value="">
                        {translate('employeeChooseRegion', {
                          region: work.region_label.toLowerCase(),
                        })}
                      </option>
                      {work.regions?.map((region) => (
                        <option key={region.code} value={region.code}>
                          {region.name}
                        </option>
                      ))}
                    </NativeSelect>,
                  )}
                {work?.locality &&
                  field('work_locality', translate('employeeLocality'), text('work_locality'), {
                    tip: translate('employeeLocalityTip'),
                  })}
                {field('place_of_work', translate('employeePlaceOfWork'), text('place_of_work'), {
                  tip: translate('employeePlaceOfWorkTip'),
                })}
                {field(
                  'residence_country',
                  translate('employeeResidenceCountry'),
                  country('residence_country', true),
                )}
                {field(
                  'social_security_country',
                  translate('employeeSocialSecurityCountry'),
                  country('social_security_country', true),
                )}
              </div>
              {flag(
                'cross_border',
                translate('employeeCrossBorder'),
                translate('employeeCrossBorderTip'),
              )}
              {values.cross_border &&
                field(
                  'cross_border_note',
                  translate('employeeCrossBorderNote'),
                  <textarea
                    {...describe('cross_border_note', errors.cross_border_note)}
                    rows={2}
                    value={values.cross_border_note}
                    onChange={(event) => set('cross_border_note', event.target.value)}
                    className={cn(inputClass, 'h-auto min-h-16 resize-y py-2')}
                  />,
                )}
            </FormSection>

            {swissFields(values) && (
              <FormSection
                icon={ShieldCheck}
                title={translate('employeeSectionSwiss')}
                description={translate('employeeSectionSwissDesc')}
                tip={translate('employeeSectionSwissTip')}
              >
                {flag(
                  'withholding_tax',
                  translate('employeeWithholdingTax'),
                  translate('employeeWithholdingTaxTip'),
                )}
                {values.withholding_tax && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field(
                      'withholding_tax_canton',
                      translate('employeeWithholdingCanton'),
                      <NativeSelect
                        {...describe('withholding_tax_canton', errors.withholding_tax_canton)}
                        value={values.withholding_tax_canton}
                        onChange={(event) => set('withholding_tax_canton', event.target.value)}
                      >
                        <option value="">{translate('employeeChooseCanton')}</option>
                        {cantons.map((region) => (
                          <option key={region.code} value={region.code}>
                            {region.name}
                          </option>
                        ))}
                      </NativeSelect>,
                      { required: true },
                    )}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {field(
                    'pension_insurer',
                    translate('employeePensionInsurer'),
                    text('pension_insurer'),
                    {
                      tip: translate('employeePensionInsurerTip'),
                    },
                  )}
                  {field(
                    'accident_insurer',
                    translate('employeeAccidentInsurer'),
                    text('accident_insurer'),
                    { tip: translate('employeeAccidentInsurerTip') },
                  )}
                  {field(
                    'sickness_insurer',
                    translate('employeeSicknessInsurer'),
                    text('sickness_insurer'),
                    { tip: translate('employeeSicknessInsurerTip') },
                  )}
                </div>
                <div className="grid gap-1">
                  {flag(
                    'free_transport',
                    translate('employeeFreeTransport'),
                    translate('employeeFreeTransportTip'),
                  )}
                  {flag(
                    'canteen_meals',
                    translate('employeeCanteenMeals'),
                    translate('employeeCanteenMealsTip'),
                  )}
                </div>
              </FormSection>
            )}

            <FormSection
              icon={Lock}
              title={translate('employeeSectionProtected')}
              description={translate('employeeSectionProtectedDesc')}
              tip={translate('employeeSectionProtectedTip')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  'bank_account',
                  translate('employeeBankAccount'),
                  text('bank_account', { autoComplete: 'off' }),
                  { hint: stored(employee?.bank_account_hint) },
                )}
                {field(
                  'tax_id',
                  translate('employeeTaxId'),
                  text('tax_id', { autoComplete: 'off' }),
                  {
                    hint: stored(employee?.tax_id_hint),
                  },
                )}
                {field(
                  'social_security_number',
                  translate('employeeSocialSecurityNumber'),
                  text('social_security_number', {
                    autoComplete: 'off',
                    placeholder: swissFields(values) ? '756.0000.0000.00' : undefined,
                  }),
                  {
                    hint: stored(employee?.social_security_number_hint),
                    tip: translate('employeeSocialSecurityNumberTip'),
                  },
                )}
              </div>
            </FormSection>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
            <Button type="button" variant="ghost" className="ml-auto" onClick={requestClose}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? translate('employeeSaving') : translate('employeeSave')}
            </Button>
          </div>

          {discarding && (
            <ConfirmDialog
              title={translate('employeeDiscardTitle')}
              body={translate('employeeDiscardBody')}
              confirmLabel={translate('employeeDiscard')}
              cancelLabel={translate('employeeKeepEditing')}
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
