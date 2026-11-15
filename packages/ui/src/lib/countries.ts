import { languageTag } from '@helvetly/i18n'
import type { Option } from '@helvetly/ui/components/combobox'
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min'

const regionNames = new Intl.DisplayNames([languageTag], { type: 'region' })
export const countryName = (code: string) => regionNames.of(code) ?? code

/** Every country, Switzerland first, then by name. */
export const COUNTRIES: { code: CountryCode; name: string; dial: string }[] = getCountries()
  .map((code) => ({ code, name: countryName(code), dial: `+${getCountryCallingCode(code)}` }))
  .toSorted((a, b) => (a.code === 'CH' ? -1 : b.code === 'CH' ? 1 : a.name.localeCompare(b.name)))

export const COUNTRY_OPTIONS: Option[] = COUNTRIES.map(({ code, name }) => ({
  value: code,
  label: name,
  hint: code,
}))
