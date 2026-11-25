import type { Locale } from '@helvetly/i18n'
import { LanguageProvider } from '@helvetly/ui/components/language-provider'
import { translatorFor } from '@helvetly/ui/lib/i18n'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PlanTable } from './plan-table'

vi.mock('@/components/offer-provider', () => ({
  useOfferStatus: () => ({ status: 'current' }),
}))

const cellsOf = (table: HTMLElement, name: string) =>
  within(within(table).getByRole('rowheader', { name }).closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent)

it.each(['en', 'de', 'fr', 'it', 'nl', 'cs', 'sv'] satisfies Locale[])(
  '%s shows allowances with their unit, unlimited in words',
  (language) => {
    const translate = translatorFor(language)
    render(
      <LanguageProvider language={language}>
        <PlanTable />
      </LanguageProvider>,
    )
    const table = screen.getByRole('table')
    expect(cellsOf(table, translate('planRowIncludedPeople'))).toEqual(['1', '1', '2', '5'])
    const month = translate('planPerMonth')
    expect(cellsOf(table, translate('planRowInvoices'))).toEqual([
      `3 ${month}`,
      `15 ${month}`,
      `100 ${month}`,
      translate('planUnlimited'),
    ])
    expect(cellsOf(table, translate('planRowDocuments'))).toEqual([
      '100 MB',
      '500 MB',
      '5 GB',
      '20 GB',
    ])
    expect(table.textContent).not.toContain('∞')
    const legends = document.querySelectorAll('[data-slot="allowance-legend"]')
    expect([...legends].map((l) => l.textContent)).toEqual([translate('planFootnote')])
  },
)

it('keeps the Pro comparison header to its name, price and trial link', () => {
  render(<PlanTable />)
  const header = within(screen.getByRole('table')).getByRole('columnheader', { name: /^Pro\b/ })
  expect(header).toHaveAccessibleName(/^Pro (?:CHF|EUR|USD) 39\.25 \/ month Try Pro free$/)
  expect(within(header).getByRole('link', { name: 'Try Pro free' })).toHaveAttribute('href')
})

it('explains a row in its (?) popover', async () => {
  render(<PlanTable />)
  const table = screen.getByRole('table')
  await userEvent.click(within(table).getByRole('button', { name: 'About E-invoices (XML)' }))
  expect(await screen.findByText(/XRechnung \(UBL and CII\), Peppol BIS Billing 3\.0/)).toBeTruthy()
})
