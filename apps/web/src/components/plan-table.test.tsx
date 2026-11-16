import type { Locale } from '@helvetly/i18n'
import { LanguageProvider } from '@helvetly/ui/components/language-provider'
import { render, screen, within } from '@testing-library/react'

import { translatorFor } from '@/lib/i18n'

import { PlanTable } from './plan-table'

vi.mock('@/components/offer-provider', () => ({
  useOfferStatus: () => ({ status: 'current' }),
}))

const cases = [
  { language: 'en', monthly: '/ month', repeated: 'per team member a month' },
  { language: 'de', monthly: '/ Monat', repeated: 'pro Teammitglied und Monat' },
  { language: 'fr', monthly: '/ mois', repeated: 'par membre de l’équipe et par mois' },
  { language: 'it', monthly: '/ mese', repeated: 'per membro del team al mese' },
] satisfies { language: Locale; monthly: string; repeated: string }[]

it.each(cases)(
  '$language keeps comparison allowances compact and preserves their scope',
  ({ language, monthly, repeated }) => {
    const translate = translatorFor(language)
    render(
      <LanguageProvider language={language}>
        <PlanTable />
      </LanguageProvider>,
    )

    const table = screen.getByRole('table')
    expect(within(table).getAllByText(monthly, { exact: true }).length).toBeGreaterThan(0)
    expect(screen.queryByText(repeated, { exact: true })).toBeNull()
    expect(screen.getAllByText(translate('allowanceLegend'), { exact: false })).toHaveLength(1)
    expect(table).toHaveTextContent(translate('perWorkspaceShort'))
    expect(table).toHaveTextContent(translate('personMonth').trim())

    const storage = within(table)
      .getByRole('rowheader', { name: translate('featureDocumentLibrary') })
      .closest('tr')
    expect(storage).toHaveTextContent('500 MB')
    expect(storage).not.toHaveTextContent(monthly)
  },
)
