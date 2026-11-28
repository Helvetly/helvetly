'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { cn } from '@helvetly/ui/lib/utils'
import type { ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { ibanInfo } from '@/lib/invoices'

export type BankValues = { iban: string; bank_name: string; bic: string }

/**
 * IBAN over the whole row, bank name and BIC side by side: the company's bank details in onboarding and
 * Settings → Company. Fragments of FormFields, so a settings section's grid places them (`width`) and
 * a plain two-column grid does too (the IBAN spans it).
 */
export function BankFields({
  idPrefix,
  values,
  errors,
  required,
  disabled,
  inputClassName,
  ibanStatus,
  onChange,
}: {
  idPrefix: string
  values: BankValues
  errors: Partial<Record<keyof BankValues, string>>
  required?: boolean
  disabled?: boolean
  inputClassName: string
  /** Live feedback under the IBAN; when given (even empty) its line is always reserved. */
  ibanStatus?: ReactNode
  onChange: (field: keyof BankValues, value: string) => void
}) {
  const id = (field: keyof BankValues) => `${idPrefix}-${field}`
  const code = cn(inputClassName, 'font-code tracking-wide')
  return (
    <>
      <FormField
        id={id('iban')}
        label="IBAN"
        required={required}
        error={errors.iban}
        tip={translate('ibanTip')}
        // The line is kept while empty, so the IBAN's status appearing never moves the fields below it.
        status={ibanStatus !== undefined && <span className="block min-h-4">{ibanStatus}</span>}
        width="full"
        className="sm:col-span-2"
      >
        <input
          {...describedBy(id('iban'), errors.iban)}
          className={code}
          value={values.iban}
          maxLength={42}
          placeholder="CH93 0076 2011 6238 5295 7"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange('iban', event.target.value.toUpperCase())}
          onBlur={(event) => {
            const info = ibanInfo(event.target.value)
            if (info.valid) onChange('iban', info.formatted)
          }}
        />
      </FormField>
      <FormField
        id={id('bank_name')}
        label={translate('bankName')}
        error={errors.bank_name}
        tip={translate('bankNameTip')}
        width="md"
      >
        <input
          {...describedBy(id('bank_name'), errors.bank_name)}
          className={inputClassName}
          value={values.bank_name}
          maxLength={100}
          placeholder="UBS Switzerland AG"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange('bank_name', event.target.value)}
        />
      </FormField>
      <FormField
        id={id('bic')}
        label="BIC / SWIFT"
        error={errors.bic}
        tip={translate('bicTip')}
        width="md"
      >
        <input
          {...describedBy(id('bic'), errors.bic)}
          className={code}
          value={values.bic}
          maxLength={14}
          placeholder="UBSWCHZH80A"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange('bic', event.target.value.toUpperCase())}
        />
      </FormField>
    </>
  )
}
