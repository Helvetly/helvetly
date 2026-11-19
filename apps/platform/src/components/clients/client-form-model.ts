import { languageTag } from '@helvetly/i18n'
import { formatUid, isEmail, isValidUid, isWebsite } from '@helvetly/ui/lib/client-fields'
import { COUNTRIES, countryName } from '@helvetly/ui/lib/countries'
import { PHONE_ERROR, phoneDraft, toE164, type CountryCode } from '@helvetly/ui/lib/phone'

import {
  isLeitwegId,
  LANGUAGES,
  type AddressField,
  type Client,
  type ClientInput,
  type EInvoiceFormat,
  type Language,
} from '@/lib/clients'
import { translate } from '@/lib/i18n'

/** What the form edits: every text as typed, plus the phone's country for national numbers. */
export type FormValues = {
  is_company: boolean
  name: string
  preferred_name: string
  email: string
  billing_email: string
  website: string
  phone: string
  phone_country: CountryCode
  street: string
  street_number: string
  apt: string
  zip: string
  city: string
  country: string
  vat_number: string
  electronic_scheme: string
  electronic_id: string
  registration_number: string
  /** County code for a Romanian address (RO-CJ); '' elsewhere. */
  region: string
  /** '' = the workspace's default. */
  language: Language | ''
  currency: string
  /** Days as typed; '' = the workspace's default (30). */
  payment_terms_days: string
  tags: string[]
  internal_id: string
  note: string
  is_active: boolean
  dunning_enabled: boolean
  einvoice_format: EInvoiceFormat
  leitweg_id: string
  portal_enabled: boolean
}

export type FieldErrors = Partial<Record<keyof FormValues, string>>

export const NOTE_MAX = 1000
const MAX: Partial<Record<keyof FormValues, number>> = {
  name: 200,
  preferred_name: 200,
  street: 200,
  street_number: 20,
  apt: 50,
  zip: 20,
  city: 100,
  website: 200,
  vat_number: 30,
  electronic_scheme: 4,
  electronic_id: 200,
  registration_number: 100,
  internal_id: 100,
  note: NOTE_MAX,
}

/** The order fields appear in, so the first error is the first one on screen. */
export const FIELD_ORDER: (keyof FormValues)[] = [
  'name',
  'preferred_name',
  'email',
  'billing_email',
  'phone',
  'website',
  'street',
  'street_number',
  'apt',
  'zip',
  'city',
  'country',
  'region',
  'vat_number',
  'registration_number',
  'electronic_scheme',
  'electronic_id',
  'language',
  'currency',
  'payment_terms_days',
  'tags',
  'internal_id',
  'note',
]

export const ADDRESS_LABELS: Record<AddressField, string> = {
  street: 'street',
  street_number: 'number',
  zip: 'ZIP',
  city: 'city',
  country: 'country',
}

/** ISO 3166-2:RO: the counties and Bucharest, as RO e-Factura codes them. */
export const RO_COUNTIES: { value: string; label: string }[] = Object.entries({
  AB: translate('alba'),
  AG: translate('arge'),
  AR: translate('arad'),
  B: translate('bucureTi'),
  BC: translate('bacU'),
  BH: translate('bihor'),
  BN: translate('bistriANSUd'),
  BR: translate('brIla'),
  BT: translate('botoAni'),
  BV: translate('braOv'),
  BZ: translate('buzU'),
  CJ: translate('cluj'),
  CL: 'Călărași',
  CS: translate('caraSeverin'),
  CT: translate('constanA'),
  CV: translate('covasna'),
  DB: 'Dâmbovița',
  DJ: translate('dolj'),
  GJ: translate('gorj'),
  GL: translate('galaI'),
  GR: translate('giurgiu'),
  HD: translate('hunedoara'),
  HR: translate('harghita'),
  IF: translate('ilfov'),
  IL: translate('ialomiA'),
  IS: translate('iaI'),
  MH: translate('mehedinI'),
  MM: translate('maramure'),
  MS: translate('mure'),
  NT: translate('neam'),
  OT: translate('olt'),
  PH: translate('prahova'),
  SB: translate('sibiu'),
  SJ: 'Sălaj',
  SM: translate('satuMare'),
  SV: translate('suceava'),
  TL: translate('tulcea'),
  TM: translate('timi'),
  TR: translate('teleorman'),
  VL: 'Vâlcea',
  VN: translate('vrancea'),
  VS: translate('vaslui'),
}).map(([code, name]) => ({
  value: `RO-${code}`,
  label: translate('ro', { name: name, code: code }),
}))

export { COUNTRIES, countryName, formatUid, isValidUid }

/** The document language a new client starts with: the browser's, when we write documents in it. */
export function defaultLanguage(): FormValues['language'] {
  const browser = navigator.language.slice(0, 2)
  return LANGUAGE_OPTIONS.find(({ code }) => code === browser)?.code ?? 'en'
}
export const DEFAULT_CURRENCY = 'CHF'
export const DEFAULT_TERMS = '30'

export const emptyValues = (): FormValues => ({
  is_company: true,
  name: '',
  preferred_name: '',
  email: '',
  billing_email: '',
  website: '',
  phone: '',
  phone_country: 'CH',
  street: '',
  street_number: '',
  apt: '',
  zip: '',
  city: '',
  country: 'CH',
  vat_number: '',
  electronic_scheme: '',
  electronic_id: '',
  registration_number: '',
  region: '',
  language: defaultLanguage(),
  currency: DEFAULT_CURRENCY,
  payment_terms_days: DEFAULT_TERMS,
  tags: [],
  internal_id: '',
  note: '',
  is_active: true,
  dunning_enabled: true,
  einvoice_format: 'none',
  leitweg_id: '',
  portal_enabled: false,
})

export function valuesFromClient(client: Client): FormValues {
  const phone = phoneDraft(client.phone, client.country)
  return {
    is_company: client.is_company,
    name: client.name,
    preferred_name: client.preferred_name ?? '',
    email: client.email ?? '',
    billing_email: client.billing_email ?? '',
    website: client.website ?? '',
    phone: phone.phone,
    phone_country: phone.country,
    street: client.street ?? '',
    street_number: client.street_number ?? '',
    apt: client.apt ?? '',
    zip: client.zip ?? '',
    city: client.city ?? '',
    country: client.country ?? '',
    vat_number: client.vat_number ?? '',
    electronic_scheme: client.electronic_address?.scheme ?? '',
    electronic_id: client.electronic_address?.id ?? '',
    registration_number: client.registration_number ?? '',
    region: client.region ?? '',
    language: client.language ?? defaultLanguage(),
    currency: client.currency ?? DEFAULT_CURRENCY,
    payment_terms_days: String(client.payment_terms_days ?? DEFAULT_TERMS),
    tags: client.tags,
    internal_id: client.internal_id ?? '',
    note: client.note ?? '',
    is_active: client.is_active,
    dunning_enabled: client.dunning_enabled ?? true,
    einvoice_format: client.einvoice_format ?? 'none',
    leitweg_id: client.leitweg_id ?? '',
    portal_enabled: client.portal_enabled ?? false,
  }
}

/** The same checks the server makes, so most mistakes show before saving. */
export function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}
  if (values.electronic_scheme.trim() || values.electronic_id.trim()) {
    if (!/^\d{4}$/.test(values.electronic_scheme.trim()))
      errors.electronic_scheme = translate('enterTheFourDigitEASSchemeCode')
    if (!values.electronic_id.trim())
      errors.electronic_id = translate('enterTheElectronicAddressRegisteredWithYourProvider')
  }
  if (!values.name.trim())
    errors.name = values.is_company
      ? translate('enterTheCompanyName')
      : translate('enterTheFullName')
  const email = values.email.trim()
  if (email && !isEmail(email)) errors.email = translate('enterAValidEmailAddress')
  const billing = values.billing_email.trim()
  if (billing && !isEmail(billing)) errors.billing_email = translate('enterAValidEmailAddress')
  const website = values.website.trim()
  if (website && !isWebsite(website)) errors.website = translate('enterAWebsiteEGExampleCh')
  const vat = values.vat_number.trim()
  // The server checks every number starting with CH as a Swiss UID.
  if (vat && /^CH/i.test(vat) && !isValidUid(vat))
    errors.vat_number = translate('thisUIDNumberIsnTValidCheckTheDigits')
  const terms = values.payment_terms_days.trim()
  if (terms && !(/^\d+$/.test(terms) && Number(terms) <= 365))
    errors.payment_terms_days = translate('enter0To365Days')
  if (values.currency && !/^[A-Z]{3}$/.test(values.currency))
    errors.currency = translate('chooseACurrency')
  if (values.phone.trim() && !toE164(values.phone, values.phone_country)) errors.phone = PHONE_ERROR
  if (values.country.trim() && !/^[A-Z]{2}$/i.test(values.country.trim()))
    errors.country = translate('chooseACountry')
  if (values.leitweg_id.trim() && !isLeitwegId(values.leitweg_id))
    errors.leitweg_id = translate('checkTheLeitwegIDEG04011000123451234506')
  for (const [field, max] of Object.entries(MAX) as [keyof FormValues, number][]) {
    const value = values[field]
    if (typeof value === 'string' && value.trim().length > max && !errors[field])
      errors[field] = translate('useAtMostCharacters', { max: max })
  }
  return errors
}

const text = (value: string) => value.trim() || null

/** The API's input: trimmed, blanks as null, email lowercased, phone in E.164. */
export function toInput(values: FormValues, editing: boolean): Partial<ClientInput> {
  const input: Partial<ClientInput> = {
    name: values.name.trim(),
    preferred_name: text(values.preferred_name),
    is_company: values.is_company,
    email: text(values.email)?.toLowerCase() ?? null,
    billing_email: text(values.billing_email)?.toLowerCase() ?? null,
    website: text(values.website),
    vat_number: text(values.vat_number),
    registration_number: text(values.registration_number),
    region: values.country === 'RO' ? text(values.region) : null,
    electronic_address:
      values.electronic_scheme.trim() || values.electronic_id.trim()
        ? { scheme: values.electronic_scheme.trim(), id: values.electronic_id.trim() }
        : null,
    language: values.language || null,
    currency: values.currency || null,
    payment_terms_days: values.payment_terms_days.trim() ? Number(values.payment_terms_days) : null,
    tags: values.tags,
    phone: values.phone.trim() ? toE164(values.phone, values.phone_country) : null,
    street: text(values.street),
    street_number: text(values.street_number),
    apt: text(values.apt),
    zip: text(values.zip),
    city: text(values.city),
    country: text(values.country)?.toUpperCase() ?? null,
    internal_id: text(values.internal_id),
    note: text(values.note),
    dunning_enabled: values.dunning_enabled,
    einvoice_format: values.einvoice_format,
    leitweg_id: text(values.leitweg_id)?.toUpperCase() ?? null,
    portal_enabled: values.portal_enabled,
  }
  // A new client is active; only editing can switch that.
  if (editing) input.is_active = values.is_active
  return input
}

/** The address parts still missing: until there are none, the client is a draft. */
export function missingAddress(values: FormValues): AddressField[] {
  return (['street', 'street_number', 'zip', 'city', 'country'] as const).filter(
    (field) => !values[field].trim(),
  )
}

/** "Draft until the address is complete: add street, ZIP and city." */
export function draftHint(missing: AddressField[]): string | null {
  if (!missing.length) return null
  const names = missing.map((field) => ADDRESS_LABELS[field])
  const list =
    names.length > 1
      ? translate('dynamicAnd', { value1: names.slice(0, -1).join(', '), value2: names.at(-1) })
      : names[0]
  return translate('draftUntilTheAddressIsCompleteAdd', { list: list })
}

/** Server field errors (422 `details.fields`) for the fields this form has. */
export function serverFieldErrors(details: Record<string, unknown>): FieldErrors {
  const fields = details.fields
  if (typeof fields !== 'object' || fields === null) return {}
  const errors: FieldErrors = {}
  for (const [field, message] of Object.entries(fields)) {
    if (field === 'electronic_address' && typeof message === 'string') {
      errors.electronic_id = message
      continue
    }
    if (typeof message === 'string' && (FIELD_ORDER as string[]).includes(field))
      errors[field as keyof FormValues] = message
  }
  return errors
}

// Tags

export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 32

/** Adds a tag the way the server keeps them: trimmed, ≤30 chars, unique ignoring case, ≤10. */
/** A tag's shape everywhere (as the API's internal/tags): a–z, A–Z, 0–9 and hyphens, not at its start or end. */
const TAG_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

/** What a tag field shows while typing: a space becomes a hyphen, anything else outside the shape is not typed. */
export const typedTag = (typed: string) =>
  typed
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_TAG_LENGTH)

export function addTag(tags: string[], input: string): { tags: string[]; error?: string } {
  const tag = typedTag(input.trim()).replace(/-+$/, '')
  if (!tag) return { tags }
  if (!TAG_SHAPE.test(tag)) return { tags, error: translate('tagShape') }
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return { tags }
  if (tags.length >= MAX_TAGS)
    return { tags, error: translate('aClientHasAtMostTags', { MAX_TAGS: MAX_TAGS }) }
  return { tags: [...tags, tag] }
}

// Billing defaults

const languageNames = new Intl.DisplayNames([languageTag], { type: 'language' })
export const LANGUAGE_OPTIONS = LANGUAGES.map((code) => ({
  code,
  name: languageNames.of(code) ?? code,
}))

const currencyNames = new Intl.DisplayNames([languageTag], { type: 'currency' })
const FIRST_CURRENCIES = ['CHF', 'EUR']
const currencyRank = (code: string) => {
  const index = FIRST_CURRENCIES.indexOf(code)
  return index === -1 ? FIRST_CURRENCIES.length : index
}
/** ISO 4217 currencies, CHF and EUR first. */
export const CURRENCIES = Intl.supportedValuesOf('currency')
  .map((code) => ({ code, name: currencyNames.of(code) ?? code }))
  .toSorted((a, b) => currencyRank(a.code) - currencyRank(b.code) || a.code.localeCompare(b.code))

export const TERM_PRESETS = ['7', '14', '30']

/** What a new client starts with from this person's habits (lib/habits). */
export const CLIENT_HABITS = [
  'is_company',
  'country',
  'phone_country',
  'language',
  'currency',
  'payment_terms_days',
] as const satisfies readonly (keyof FormValues)[]

export const CLIENT_HABIT_OPTIONS = {
  country: (code: string) => COUNTRIES.some((country) => country.code === code),
  phone_country: (code: string) => COUNTRIES.some((country) => country.code === code),
  language: (code: string) => LANGUAGE_OPTIONS.some((language) => language.code === code),
  currency: (code: string) => /^[A-Z]{3}$/.test(code),
  payment_terms_days: (days: string) => /^\d{1,3}$/.test(days),
}
