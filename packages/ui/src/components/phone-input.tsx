'use client'
import { Combobox, inputClass, type Option } from '@helvetly/ui/components/combobox'
import { COUNTRIES } from '@helvetly/ui/lib/countries'
import { translate } from '@helvetly/ui/lib/i18n'
import { formatPhoneTyping, phonePlaceholder, type CountryCode } from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'

const DIAL_OPTIONS: Option[] = COUNTRIES.map(({ code, name, dial }) => ({
  value: code,
  label: name,
  hint: dial,
}))

/** The phone's country (for numbers typed without +) and the number itself. */
export function PhoneInput({
  id,
  value,
  country,
  onChange,
  onCountryChange,
  invalid,
  className,
  'aria-describedby': describedBy,
}: {
  id: string
  value: string
  country: CountryCode
  onChange: (value: string) => void
  onCountryChange: (country: string) => void
  invalid?: boolean
  /** For both parts, e.g. a taller height to match the form's other inputs. */
  className?: string
  'aria-describedby'?: string
}) {
  return (
    <div className="flex gap-1.5">
      <Combobox
        value={country}
        options={DIAL_OPTIONS}
        onChange={onCountryChange}
        placeholder={translate('country')}
        label={translate('phoneCountry')}
        className={cn('w-[104px] shrink-0', className)}
        renderValue={(option) => (
          <span className="tabular-nums">
            {option.value} {option.hint}
          </span>
        )}
      />
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(formatPhoneTyping(value, event.target.value, country))}
        placeholder={phonePlaceholder(country)}
        className={cn(inputClass, className)}
      />
    </div>
  )
}
