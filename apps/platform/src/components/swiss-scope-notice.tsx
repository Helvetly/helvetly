'use client'
import { Callout } from '@helvetly/ui/components/callout'
import { countryName } from '@helvetly/ui/lib/countries'

import { isForeignVat } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

/** The business's country when it is outside Switzerland and Liechtenstein, where these rules apply; else null. */
export const countryOutsideSwissRules = (country: string | undefined) =>
  country && isForeignVat(country) ? country : null

const AREAS = {
  'vat-return': { title: 'swissVATReturnInCHF', body: 'swissVATReturnScope' },
  expenses: { title: 'inputTaxFollowsSwissRules', body: 'expensesSwissVATScope' },
} as const

/**
 * Says that the VAT return or the expenses' input-tax defaults follow Swiss rules, to a business in another country.
 * The country comes from the session, which every member reads, never from the invoice settings or the language.
 */
export function SwissScopeNotice({
  area,
  className,
}: {
  area: keyof typeof AREAS
  className?: string
}) {
  const country = countryOutsideSwissRules(useSession().data?.workspace.country)
  if (!country) return null
  const { title, body } = AREAS[area]
  return (
    <Callout tone="info" title={translate(title)} className={className}>
      {translate(body, { country: countryName(country) })}
    </Callout>
  )
}
