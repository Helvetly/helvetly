import { translate } from '@/lib/i18n'
import type { RegisterCompany } from '@/lib/uid-register'

import { ADDRESS_LABELS, formatUid, isValidUid, type FormValues } from './client-form-model'

/** The register lookup applies to a Swiss company only. */
export const registerApplies = (values: Pick<FormValues, 'is_company' | 'country'>) =>
  values.is_company && values.country === 'CH'

/** What picking a company sets: only what differs from the form, so undo restores exactly that. */
export function registerFill(values: FormValues, company: RegisterCompany): Partial<FormValues> {
  const fill: Partial<FormValues> = {
    name: company.name,
    street: company.street,
    street_number: company.house_number,
    zip: company.zip,
    city: company.city,
    country: 'CH',
    registration_number: company.uid,
    // A company without VAT keeps whatever number was typed; the VAT field's check says so.
    vat_number: company.vat ? `${company.uid} MWST` : undefined,
  }
  return Object.fromEntries(
    Object.entries(fill).filter(
      ([field, value]) => value && values[field as keyof FormValues] !== value,
    ),
  )
}

const FIELD_NAMES: Partial<Record<keyof FormValues, () => string>> = {
  ...Object.fromEntries(
    Object.entries(ADDRESS_LABELS).map(([field, label]) => [field, () => label]),
  ),
  registration_number: () => translate('businessRegistrationNumber'),
  vat_number: () => translate('vatUIDNumber'),
}

/** The fields that held something else before the fill (the name is what was typed to search, so it isn't one). */
export function replacedFields(values: FormValues, fill: Partial<FormValues>): string[] {
  return (Object.keys(fill) as (keyof FormValues)[])
    .filter((field) => field !== 'name' && field !== 'country')
    .filter((field) => {
      const before = values[field]
      return typeof before === 'string' && before.trim() !== ''
    })
    .map((field) => FIELD_NAMES[field]?.() ?? field)
}

/** The UID to check in the register (CHE-123.456.789), or null when the field holds no valid Swiss UID. */
export function uidToCheck(vat: string): string | null {
  if (!isValidUid(vat)) return null
  return formatUid(vat.replace(/\s*(MWST|TVA|IVA)\s*$/i, ''))
}

export type RegisterCheck = { tone: 'ok' | 'warn' | 'muted'; text: string }

/** What the VAT / UID field says about its number in the register. */
export function registerCheck(
  vat: string,
  answer: { loading: boolean; failed: boolean; company: RegisterCompany | null | undefined },
): RegisterCheck {
  if (answer.loading) return { tone: 'muted', text: translate('uidCheckLoading') }
  if (answer.failed) return { tone: 'muted', text: translate('uidRegisterUnavailable') }
  const company = answer.company
  if (!company) return { tone: 'warn', text: translate('uidCheckNotFound') }
  if (!company.active)
    return { tone: 'warn', text: translate('uidCheckInactive', { name: company.name }) }
  if (company.vat) return { tone: 'ok', text: translate('uidCheckVat', { name: company.name }) }
  return /(MWST|TVA|IVA)\s*$/i.test(vat)
    ? { tone: 'warn', text: translate('uidCheckNoVatSuffix', { name: company.name }) }
    : { tone: 'ok', text: translate('uidCheckNoVat', { name: company.name }) }
}
