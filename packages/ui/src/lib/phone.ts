import { COUNTRIES } from '@helvetly/ui/lib/countries'
import {
  AsYouType,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'
import examples from 'libphonenumber-js/mobile/examples'

export type { CountryCode }

export const PHONE_ERROR = 'Enter a valid phone number.'

/** The code itself when it is a country with a dialling code, else Switzerland. */
export const phoneCountryOr = (code: string | null | undefined): CountryCode =>
  COUNTRIES.find((country) => country.code === code?.toUpperCase())?.code ?? 'CH'

/** The number in E.164 ("+41441234567"), or null when it isn't a valid number. */
export function toE164(phone: string, country: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(phone, country)
  return parsed?.isValid() ? parsed.number : null
}

/** The country a typed number belongs to, when it says (e.g. "+49…"). */
export const phoneCountry = (phone: string, fallback: CountryCode) =>
  parsePhoneNumberFromString(phone, fallback)?.country ?? null

/** A stored E.164 number as a form edits it: national format and its country, else `fallback`. */
export function phoneDraft(
  stored: string | null | undefined,
  fallback: string | null | undefined,
): { phone: string; country: CountryCode } {
  const parsed = stored ? parsePhoneNumberFromString(stored) : undefined
  return {
    phone: parsed ? parsed.formatNational() : (stored ?? ''),
    country: parsed?.country ?? phoneCountryOr(fallback),
  }
}

/** How a stored number reads: "+41 78 239 09 99". */
export const displayPhone = (phone: string) =>
  parsePhoneNumberFromString(phone)?.formatInternational() ?? phone

/**
 * Groups a phone number as it is typed, e.g. "782390999" → "78 239 09 99" in Switzerland.
 * Deleting is left alone, so backspace can remove a space the formatter would put back.
 */
export function formatPhoneTyping(previous: string, next: string, country: CountryCode) {
  if (next.length <= previous.length) return next
  const typed = next.trim()
  // With "+" or the trunk 0 the formatter knows the number; without, it is national digits
  // after the picked "+41", so format it as international and drop that prefix again.
  if (/^[+0]/.test(typed)) return new AsYouType(country).input(typed)
  return withoutCallingCode(
    new AsYouType(country).input(`+${getCountryCallingCode(country)}${typed}`),
    country,
  )
}

const withoutCallingCode = (international: string, country: CountryCode) =>
  international.replace(`+${getCountryCallingCode(country)}`, '').trim()

/** A sample mobile number for the picked country, as the placeholder: "78 123 45 67" for CH. */
export function phonePlaceholder(country: CountryCode) {
  const example = getExampleNumber(country, examples)
  return example ? withoutCallingCode(example.formatInternational(), country) : ''
}
