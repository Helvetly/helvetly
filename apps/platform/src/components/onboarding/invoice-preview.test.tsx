import { render, screen } from '@testing-library/react'

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
  vat_registered: false,
  vat_number: '',
  iban: '',
  language: 'de',
  currency: 'CHF',
  default_terms_days: 30,
  number_format: 'YYYY-NNN',
}

test('prints the apartment on the street line, in Poland after a slash', () => {
  const { rerender } = render(<InvoicePreview values={{ ...values, apt: 'Apt 21' }} logo={null} />)
  expect(screen.getByText('Lerchenstrasse 21, Apt 21')).toBeInTheDocument()
  expect(screen.queryByText('Apt 21')).not.toBeInTheDocument()

  rerender(
    <InvoicePreview
      values={{ ...values, country: 'PL', street_number: '3A', apt: '2' }}
      logo={null}
    />,
  )
  expect(screen.getByText('Lerchenstrasse 3A/2')).toBeInTheDocument()
})

test('adds no line without an apartment', () => {
  render(<InvoicePreview values={{ ...values, apt: '  ' }} logo={null} />)
  expect(screen.getByText('Lerchenstrasse 21')).toBeInTheDocument()
  expect(screen.getByText('8045 Zurich')).toBeInTheDocument()
})
