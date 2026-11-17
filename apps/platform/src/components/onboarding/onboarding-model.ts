import { isValidUid } from '@/components/clients/client-form-model'
import { translate } from '@/lib/i18n'
import {
  formatIban,
  ibanInfo,
  type DocLanguage,
  type InvoiceSettings,
  type NumberFormat,
  type SettingsInput,
  unsupportedSellerCountry,
} from '@/lib/invoices'

/** What the welcome asks for: the seller settings that make invoices issuable, and the defaults. */
export type Values = {
  name: string
  street: string
  street_number: string
  apt: string
  zip: string
  city: string
  country: string
  vat_registered: boolean
  vat_number: string
  iban: string
  language: DocLanguage
  currency: string
  default_terms_days: number
  number_format: NumberFormat
}

/**
 * `interfaceLanguage`: until the company is set up, its documents start in the language the person uses
 * Helvetly in (they pick another on the language step), so the preview speaks it too.
 */
export function valuesFrom(settings: InvoiceSettings, interfaceLanguage?: DocLanguage): Values {
  const { seller } = settings
  return {
    name: seller.name,
    street: seller.street,
    street_number: seller.street_number,
    apt: seller.apt ?? '',
    zip: seller.zip,
    city: seller.city,
    // Helvetly is for Swiss companies first.
    country: seller.country || 'CH',
    vat_registered: settings.vat_registered,
    vat_number: seller.vat_number ?? '',
    iban: settings.iban ? formatIban(settings.iban) : '',
    language: settings.is_complete ? settings.language : (interfaceLanguage ?? settings.language),
    currency: settings.currency || 'CHF',
    default_terms_days: settings.default_terms_days,
    number_format: settings.number_format,
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
      apt: values.apt.trim() || null,
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
    number_format: values.number_format,
  }
}

/** The company's name and address (not the apartment) are required, and the server refuses to finish without them. */
const REQUIRED = ['name', 'street', 'street_number', 'zip', 'city', 'country'] as const

/** What can be checked here: the required company details and the formats; the server checks them again. */
export function validate(values: Values): Partial<Record<keyof Values, string>> {
  const errors: Partial<Record<keyof Values, string>> = {}
  for (const field of REQUIRED)
    if (!values[field].trim()) errors[field] = translate('thisIsRequired')
  const vat = values.vat_number.trim()
  if (values.vat_registered && !vat) errors.vat_number = translate('thisIsRequired')
  // The server checks every number starting with CH as a Swiss UID.
  if (values.vat_registered && /^CH/i.test(vat) && !isValidUid(vat))
    errors.vat_number = translate('thisUIDNumberIsnTValidCheckTheDigits')
  if (values.iban.trim() && !ibanInfo(values.iban).valid)
    errors.iban = translate('thisIBANSCheckDigitsDonTMatchCheck')
  // The server takes whole days from 0 (the invoice date itself) to 365; a saved 10, 60 or other value in range stays valid.
  if (
    !Number.isInteger(values.default_terms_days) ||
    values.default_terms_days < 0 ||
    values.default_terms_days > 365
  )
    errors.default_terms_days = translate('enter0To365Days')
  const market = unsupportedSellerCountry(values.country)
  if (market && !errors.country) errors.country = market
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

/** The longest name a person or a workspace can be given; the API checks the same limits (older, longer names stay readable). */
export const MAX_PERSON_NAME = 60
export const MAX_WORKSPACE_NAME = 50

const withinLength = (name: string, max: number) => {
  const length = Array.from(name.trim()).length
  return length >= 1 && length <= max
}

/** A person's name as the account takes it: 1 to MAX_PERSON_NAME characters once trimmed (PATCH /account). */
export const validPersonName = (name: string) => withinLength(name, MAX_PERSON_NAME)

/** A workspace's name as the workspace takes it: 1 to MAX_WORKSPACE_NAME characters once trimmed. */
export const validWorkspaceName = (name: string) => withinLength(name, MAX_WORKSPACE_NAME)

export type StepId = 'welcome' | 'company' | 'logo' | 'preferences' | 'import' | 'done'

/** The "Bring your data" step needs the server's AI model and the right to read documents; without either it is absent. */
export const stepsFor = (canImport: boolean): StepId[] => [
  'welcome',
  'company',
  'logo',
  'preferences',
  ...(canImport ? (['import'] as const) : []),
  'done',
]
