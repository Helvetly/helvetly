import { isValidUid } from '@/components/clients/client-form-model'
import {
  formatIban,
  ibanInfo,
  type DocLanguage,
  type InvoiceSettings,
  type SettingsInput,
  unsupportedSellerCountry,
} from '@/lib/invoices'

/** What the welcome asks for: the seller settings that make invoices issuable, and the defaults. */
export type Values = {
  name: string
  street: string
  street_number: string
  zip: string
  city: string
  country: string
  vat_registered: boolean
  vat_number: string
  iban: string
  language: DocLanguage
  currency: string
  default_terms_days: number
}

export function valuesFrom(settings: InvoiceSettings): Values {
  const { seller } = settings
  return {
    name: seller.name,
    street: seller.street,
    street_number: seller.street_number,
    zip: seller.zip,
    city: seller.city,
    // Helvetly is for Swiss companies first.
    country: seller.country || 'CH',
    vat_registered: settings.vat_registered,
    vat_number: seller.vat_number ?? '',
    iban: settings.iban ? formatIban(settings.iban) : '',
    language: settings.language,
    currency: settings.currency || 'CHF',
    default_terms_days: settings.default_terms_days,
  }
}

/** The UID's suffix in the invoice's language (MWST, TVA, IVA). */
export const vatSuffix = (language: DocLanguage) =>
  language === 'fr' ? 'TVA' : language === 'it' ? 'IVA' : 'MWST'

/** The nine digits of a Swiss UID as typed or stored ("CHE-123.456.789 MWST" → "123456789"). */
export const uidDigits = (vat: string) =>
  vat
    .replace(/\s*(MWST|TVA|IVA)\s*$/i, '')
    .replace(/^\s*CHE/i, '')
    .replace(/\D/g, '')
    .slice(0, 9)

/** A Swiss company's VAT number ends with the suffix of the language its invoices are in. */
export function vatNumber(values: Values) {
  const vat = values.vat_number.trim()
  if (!/^CHE/i.test(vat) || uidDigits(vat).length < 9) return vat || null
  const digits = uidDigits(vat)
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)} ${vatSuffix(values.language)}`
}

/** The settings as read, with the welcome's values on top: what PUT /invoice-settings takes. */
export function toSettingsInput(settings: InvoiceSettings, values: Values): SettingsInput {
  const vatMode = settings.default_vat_mode === 'none' ? 'exclusive' : settings.default_vat_mode
  return {
    ...settings,
    seller: {
      ...settings.seller,
      name: values.name.trim(),
      street: values.street.trim(),
      street_number: values.street_number.trim(),
      zip: values.zip.trim(),
      city: values.city.trim(),
      country: values.country,
      vat_number: values.vat_registered ? vatNumber(values) : null,
    },
    vat_registered: values.vat_registered,
    // The two must agree (docs/invoices-contract.md).
    default_vat_mode: values.vat_registered ? vatMode : 'none',
    iban: values.iban.replace(/\s/g, '').toUpperCase() || null,
    language: values.language,
    currency: values.currency,
    default_terms_days: values.default_terms_days,
  }
}

/** Only what can be checked here; the rest is optional now and checked by the server. */
export function validate(values: Values): Partial<Record<keyof Values, string>> {
  const errors: Partial<Record<keyof Values, string>> = {}
  const vat = values.vat_number.trim()
  // The server checks every number starting with CH as a Swiss UID.
  if (values.vat_registered && /^CH/i.test(vat) && !isValidUid(vat))
    errors.vat_number = 'This UID number isn’t valid. Check the digits.'
  if (values.iban.trim() && !ibanInfo(values.iban).valid)
    errors.iban = 'This IBAN’s check digits don’t match. Check for a typo.'
  const market = unsupportedSellerCountry(values.country)
  if (market) errors.country = market
  return errors
}

/** The server's 422 field names ("seller.city", "iban") on the welcome's fields. */
export function fieldErrors(details: Record<string, unknown>): Partial<Record<string, string>> {
  const fields = details.fields
  if (typeof fields !== 'object' || fields === null) return {}
  const errors: Partial<Record<string, string>> = {}
  for (const [name, message] of Object.entries(fields))
    if (typeof message === 'string') errors[name.replace('seller.', '')] = message
  return errors
}
