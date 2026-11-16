import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render as renderPlain, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { PublicOffer } from '@/lib/billing'

// the website's copy, written by apps/api/internal/billing/public_offer_golden_test.go
import golden from '../../../../web/src/lib/public-offer.golden.json'
import { PlanComparison } from './plan-extras'
import fixture from './public-offer.fixture.json'

const offer: PublicOffer = { ...fixture, comparison: fixture.comparison.map((row) => ({ ...row })) }

const render = (ui: ReactElement) => renderPlain(<TooltipProvider>{ui}</TooltipProvider>)

test('the fixture is the public offer the API publishes (the Go golden file the website checks too)', () => {
  expect({
    comparison: fixture.comparison,
    usage_details: fixture.usage_details,
    limits: fixture.limits,
  }).toEqual({
    comparison: golden.comparison,
    usage_details: golden.usage_details,
    limits: golden.limits,
  })
})

const row = (key: string) => {
  const found = document.querySelector(`[data-row="${key}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`no row ${key}`)
  return (plan: string) =>
    within(found).getAllByRole('cell')[['basic', 'pro', 'business'].indexOf(plan)]
}

test('thirteen business rows and twelve allowances, per team member or per workspace', () => {
  render(<PlanComparison offer={offer} current="basic" />)
  expect(document.querySelectorAll('tbody:first-of-type tr')).toHaveLength(13)
  expect(document.querySelectorAll('tbody:last-of-type tr[data-row]')).toHaveLength(12)
  expect(row('heidi')('basic')).toHaveTextContent('Not included')
  expect(row('heidi')('pro')).toHaveTextContent('5M / month')
  expect(row('client_portal')('pro')).toHaveTextContent('Not included')
  expect(row('employees')('pro')).toHaveTextContent('Not included')
  expect(
    within(row('client_portal')('business') ?? document.body).getByLabelText('Included'),
  ).toBeVisible()
  expect(row('invoicing')('basic')).toHaveTextContent('15 / month')
  expect(row('invoicing')('pro')).toHaveTextContent('100 / month')
  // unlimited reads as such, without a per-unit suffix
  expect(row('invoicing')('business')?.textContent).toBe('Unlimited')
  expect(row('quotes_per_month')('basic')).toHaveTextContent('5')
  expect(row('quotes_per_month')('pro')).toHaveTextContent('100')
  expect(row('quotes_per_month')('business')).toHaveTextContent('Unlimited')
  expect(row('clients')('business')).toHaveTextContent('Unlimited')
  expect(row('signatures_per_month')('business')?.textContent).not.toMatch(/\d/)
  expect(row('engagements')('basic')).toHaveTextContent('3 / workspace')
  expect(row('expenses_per_month')('basic')).toHaveTextContent('Not included')
  expect(row('storage_bytes')('pro')).toHaveTextContent('5 GB')
  expect(screen.getByRole('rowheader', { name: /^Clients/ })).toHaveTextContent('Per workspace')
  expect(screen.getByRole('rowheader', { name: /^AI tokens/ })).toHaveTextContent('Monthly')
  expect(screen.getByRole('rowheader', { name: /^Quotes sent/ })).toHaveTextContent('Monthly')
  // Whose allowance it is, and that storage is not monthly, is said once in the legend, not on every row.
  expect(screen.getByRole('rowheader', { name: /^Storage/ }).textContent).not.toMatch(
    /month|team member/i,
  )
  expect(document.body.textContent).not.toMatch(/per team member/i)
  expect(screen.getAllByText(/combine in one shared workspace pool/)).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'About Automated actions' })).toBeInTheDocument()
  expect(screen.queryByText(/identity|credits/i)).toBeNull()
})
