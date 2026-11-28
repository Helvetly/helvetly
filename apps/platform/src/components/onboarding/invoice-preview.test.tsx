import { render, screen } from '@testing-library/react'

import type { InvoiceSettings } from '@/lib/invoices'

import { InvoicePreview } from './invoice-preview'
import type { Values } from './onboarding-model'

const values: Values = {
  name: 'Dein Deutsch Coach',
  street: 'Lerchenstrasse',
  street_number: '21',
  apt: '',
  zip: '8045',
  city: 'Zurich',
  country: 'CH',
  legal_form: '',
  vat_registered: false,
  vat_number: '',
  iban: '',
  bank_name: '',
  bic: '',
  language: 'de',
  currency: 'CHF',
  default_terms_days: 30,
  number_format: '{YYYY}-{NNN}',
}
const registered: Values = { ...values, vat_registered: true }

type Vat = Pick<InvoiceSettings, 'default_vat_rate' | 'default_vat_mode'>
const net = (rate: string): Vat => ({ default_vat_rate: rate, default_vat_mode: 'exclusive' })
const gross = (rate: string): Vat => ({ default_vat_rate: rate, default_vat_mode: 'inclusive' })

/** The sample's lines come to CHF 2'450.00 before VAT. */
const row = (label: string | RegExp) => screen.getByText(label).parentElement

test('prints the apartment on the street line, in Poland after a slash', () => {
  const { rerender } = render(
    <InvoicePreview values={{ ...values, apt: 'Apt 21' }} logo={null} vat={net('8.1')} />,
  )
  expect(screen.getByText('Lerchenstrasse 21, Apt 21')).toBeInTheDocument()
  expect(screen.queryByText('Apt 21')).not.toBeInTheDocument()

  rerender(
    <InvoicePreview
      values={{ ...values, country: 'PL', street_number: '3A', apt: '2' }}
      logo={null}
      vat={net('8.1')}
    />,
  )
  expect(screen.getByText('Lerchenstrasse 3A/2')).toBeInTheDocument()
})

test('adds no line without an apartment', () => {
  render(<InvoicePreview values={{ ...values, apt: '  ' }} logo={null} vat={net('8.1')} />)
  expect(screen.getByText('Lerchenstrasse 21')).toBeInTheDocument()
  expect(screen.getByText('8045 Zurich')).toBeInTheDocument()
})

test.each([
  ['8.1', 'MWST 8.1%', '198.45', '2.648.45'],
  ['19', 'MWST 19%', '465.50', '2.915.50'],
  ['2.6', 'MWST 2.6%', '63.70', '2.513.70'],
  ['0', 'MWST 0%', '0.00', '2.450.00'],
])('adds the configured %s%% to net prices', (rate, label, vat, total) => {
  render(<InvoicePreview values={registered} logo={null} vat={net(rate)} />)
  expect(row(label)?.textContent).toMatch(new RegExp(`CHF ${vat}$`))
  expect(row('Total')?.textContent).toMatch(new RegExp(`CHF ${total}$`))
})

test('shows the VAT contained in gross prices, whose total stays the same', () => {
  render(<InvoicePreview values={registered} logo={null} vat={gross('8.1')} />)
  // 2450 × 8.1 / 108.1 = 183.580…
  expect(row('inkl. MWST 8.1%')?.textContent).toMatch(/CHF 183\.58$/)
  expect(row('Total')?.textContent).toMatch(/CHF 2.450\.00$/)
  expect(screen.queryByText(/^MWST/)).not.toBeInTheDocument()
})

test('prints no VAT for a company not registered for VAT, whatever the saved rate', () => {
  render(<InvoicePreview values={values} logo={null} vat={net('8.1')} />)
  expect(screen.queryByText(/MWST/)).not.toBeInTheDocument()
  expect(row('Total')?.textContent).toMatch(/CHF 2.450\.00$/)
})

test('follows changed settings without keeping the previous rate or mode', () => {
  const { rerender } = render(<InvoicePreview values={registered} logo={null} vat={net('8.1')} />)
  expect(row('Total')?.textContent).toMatch(/CHF 2.648\.45$/)

  rerender(<InvoicePreview values={registered} logo={null} vat={net('19')} />)
  expect(screen.queryByText('MWST 8.1%')).not.toBeInTheDocument()
  expect(row('MWST 19%')?.textContent).toMatch(/CHF 465\.50$/)
  expect(row('Total')?.textContent).toMatch(/CHF 2.915\.50$/)

  rerender(<InvoicePreview values={registered} logo={null} vat={gross('19')} />)
  expect(row('inkl. MWST 19%')?.textContent).toMatch(/CHF 391\.18$/)
  expect(row('Total')?.textContent).toMatch(/CHF 2.450\.00$/)

  rerender(<InvoicePreview values={values} logo={null} vat={gross('19')} />)
  expect(screen.queryByText(/MWST/)).not.toBeInTheDocument()
  expect(row('Total')?.textContent).toMatch(/CHF 2.450\.00$/)
})

test('writes the rate the way the document language writes decimals', () => {
  render(<InvoicePreview values={{ ...registered, language: 'fr' }} logo={null} vat={net('2.6')} />)
  expect(row(/^TVA 2,6\s?%$/)?.textContent).toMatch(/63,70$/)
})
