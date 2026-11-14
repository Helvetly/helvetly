import { render, screen } from '@testing-library/react'

import { billingFixture } from './billing-fixture'
import { PaymentCard } from './card-brand'
import { Countdown } from './countdown'
import { byPressure, UsageOverview } from './usage-overview'

test('usage sorts closest to the limit first and unlimited items last', () => {
  const sorted = byPressure([
    { limit: 'members', used: 9, max: null },
    { limit: 'clients', used: 10, max: 50 },
    { limit: 'signatures_per_month', used: 5, max: 5 },
    { limit: 'invoices_per_month', used: 24, max: 30 },
  ])
  expect(sorted.map((item) => item.limit)).toEqual([
    'signatures_per_month',
    'invoices_per_month',
    'clients',
    'members',
  ])
})

test('the nudge names the item at its limit and what the next plan includes', () => {
  render(
    <UsageOverview
      billing={billingFixture({
        plan: 'pro',
        status: 'active',
        usage: [
          { limit: 'clients', used: 10, max: 1000 },
          { limit: 'signatures_per_month', used: 50, max: 50 },
        ],
      })}
    />,
  )
  expect(
    screen.getByText(/the plan’s limit is reached/).closest('[data-slot=usage-nudge]'),
  ).toHaveTextContent(
    'Signature requests: the plan’s limit is reached. Business includes unlimited signature requests.',
  )
  expect(screen.getByRole('link', { name: 'See Business' })).toHaveAttribute(
    'href',
    '/settings/billing/plans',
  )
  expect(screen.getByText('Limit reached')).toBeInTheDocument()
})

test('no nudge while every item has room', () => {
  const { container } = render(
    <UsageOverview
      billing={billingFixture({
        plan: 'basic',
        status: 'active',
        usage: [{ limit: 'clients', used: 1, max: 50 }],
      })}
    />,
  )
  expect(container.querySelector('[data-slot=usage-nudge]')).toBeNull()
})

test('the countdown shows the days left and carries the progress for assistive tech', () => {
  render(<Countdown value={2} max={7} left={5} label="Trial days used" />)
  expect(screen.getByRole('progressbar', { name: 'Trial days used' })).toHaveAttribute('value', '2')
  expect(screen.getByText('5')).toBeInTheDocument()
  expect(screen.getByText('days left')).toBeInTheDocument()
})

test('the payment card shows the last four digits and expiry, or an empty outline', () => {
  const { rerender, container } = render(
    <PaymentCard card={{ brand: 'mastercard', last4: '4444', exp_month: 3, exp_year: 2031 }} />,
  )
  const card = container.querySelector('[data-slot=payment-card]')
  expect(card).toHaveAttribute('data-brand', 'mastercard')
  expect(card).toHaveTextContent('Card ending in 4444')
  expect(card).toHaveTextContent('Expires 03/31')
  rerender(<PaymentCard card={null} />)
  expect(screen.getByText('No card on file')).toBeInTheDocument()
})
