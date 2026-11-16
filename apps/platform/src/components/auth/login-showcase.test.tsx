import { render, screen, within } from '@testing-library/react'

import { translate } from '@/lib/i18n'

import { LoginShowcase } from './login-showcase'

describe('LoginShowcase', () => {
  it('names every area and Heidi in text, so the meaning survives without animation', () => {
    render(<LoginShowcase />)

    const areas = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(areas.map((area) => area.textContent)).toEqual([
      translate('invoices'),
      translate('clients'),
      translate('expenses'),
      translate('billing'),
      translate('team'),
      translate('aiImports'),
      translate('scheduledActions'),
      translate('documents'),
    ])
    expect(screen.getByText(translate('heidi'))).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  })
})
