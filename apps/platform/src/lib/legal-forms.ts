import { locale } from '@helvetly/i18n'
import type { Option } from '@helvetly/ui/components/combobox'
import { useQuery } from '@tanstack/react-query'

import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'

export type LegalFormGroup = 'sole' | 'partnership' | 'company' | 'association'

/** One legal form of a country (GET /invoice-settings/legal-forms); the API keeps the list. */
export type LegalForm = {
  code: string
  group: LegalFormGroup
  name: string
  names?: Partial<Record<string, string>>
  suffixes?: string[]
}

/** Every country's forms by ISO code; a country without a list has no entry. */
export type LegalForms = Record<string, LegalForm[]>

export const legalFormsApi = {
  list: async () => (await request<{ data: LegalForms }>('/invoice-settings/legal-forms')).data,
}

export function useLegalForms() {
  return useQuery({
    queryKey: ['invoice-settings', 'legal-forms'],
    queryFn: legalFormsApi.list,
    staleTime: Infinity,
  })
}

const groupTitle = (group: LegalFormGroup) =>
  ({
    sole: translate('legalFormGroupSole'),
    partnership: translate('legalFormGroupPartnership'),
    company: translate('legalFormGroupCompany'),
    association: translate('legalFormGroupAssociation'),
  })[group]

export const legalFormName = (form: LegalForm, language: string = locale) =>
  form.names?.[language] ?? form.name

/** The country's forms as Combobox options, grouped by kind; none for a country without a list. */
export const legalFormOptions = (forms: LegalForms | undefined, country: string): Option[] =>
  (forms?.[country] ?? []).map((form) => ({
    value: form.code,
    label: legalFormName(form),
    group: groupTitle(form.group),
  }))

/** Letters and digits of each word, lower case: "Sp. z o. o." → ["sp", "z", "o", "o"]. */
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)

/**
 * The form a company's name ends with ("Muster GmbH" → gmbh), the longest ending first ("GmbH & Co. KG" is not a KG);
 * whole words only, so "Bag" is no AG.
 */
export function suggestLegalForm(forms: LegalForms | undefined, country: string, name: string) {
  const tail = words(name)
  let best: { code: string; length: number } | null = null
  for (const form of forms?.[country] ?? [])
    for (const suffix of form.suffixes ?? []) {
      const ending = words(suffix).join('')
      for (let count = 1; count <= tail.length; count++)
        if (tail.slice(-count).join('') === ending && count >= (best?.length ?? 0))
          best = { code: form.code, length: count }
    }
  return best?.code ?? null
}
