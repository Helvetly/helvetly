import { render, screen } from '@testing-library/react'

import { UnitInput } from './unit-input'

test('the unit sits inside the field, after the value', () => {
  render(
    <>
      <label htmlFor="lead">Issue invoices</label>
      <UnitInput id="lead" unit="days before due" defaultValue="10" aria-invalid />
    </>,
  )
  const input = screen.getByRole('textbox', { name: 'Issue invoices' })
  expect(input).toHaveValue('10')
  const field = input.closest('[data-slot="unit-input"]')
  expect(field).toHaveTextContent('days before due')
  expect(field?.lastElementChild).toHaveTextContent('days before due')
})
