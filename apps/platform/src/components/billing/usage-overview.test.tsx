import { render, screen } from '@testing-library/react'

import { billingFixture, entitlementsFixture } from './billing-fixture'
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
          { limit: 'clients', used: 10, max: 300 },
          { limit: 'signatures_per_month', used: 50, max: 50 },
        ],
      })}
    />,
  )
  expect(
    screen.getByText(/the plan’s limit is reached/).closest('[data-slot=usage-nudge]'),
  ).toHaveTextContent(
    'Signature requests: the plan’s limit is reached. Business includes 200 signature requests a month per paid person.',
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

const withEntitlements = (used: Record<string, number | null>, over = {}) =>
  billingFixture({
    plan: 'basic',
    status: 'active',
    locked: false,
    entitlements: entitlementsFixture('basic', { used, over }),
  })

test('12 of 15 invoice issues is near the limit, with what Pro gives per paid person', () => {
  render(<UsageOverview billing={withEntitlements({ invoices_per_month: 12 })} />)
  const tile = screen.getByText('Invoice issues').closest('li')
  expect(tile).toHaveAttribute('data-state', 'near')
  expect(tile).toHaveTextContent('12of 15')
  expect(tile).toHaveTextContent('Per paid person, shared · Resets 1 Dec, 00:00 UTC')
  expect(
    screen.getByText(/almost at the plan’s limit/).closest('[data-slot=usage-nudge]'),
  ).toHaveTextContent(
    'Invoice issues: almost at the plan’s limit. Pro includes 150 invoice issues a month per paid person.',
  )
})

test('at 15 of 15 issuing stops and the nudge says drafts are kept', () => {
  render(<UsageOverview billing={withEntitlements({ invoices_per_month: 15 })} />)
  expect(screen.getByText('Invoice issues').closest('li')).toHaveAttribute('data-state', 'full')
  expect(
    screen.getByText(/the plan’s limit is reached/).closest('[data-slot=usage-nudge]'),
  ).toHaveTextContent(
    'Drafts stay saved and can be issued once the allowance resets or the plan grows.',
  )
})

test('excluded, unlimited, workspace-wide and custom limits read as such', () => {
  render(
    <UsageOverview
      billing={withEntitlements(
        { clients: 12 },
        {
          clients: { source: 'workspace', value: 60, expires_at: '2027-01-31T00:00:00Z' },
          emails_per_month: { state: 'unlimited', value: null },
        },
      )}
    />,
  )
  const expenses = screen.getByText('Expenses').closest('li')
  expect(expenses).toHaveAttribute('data-state', 'off')
  expect(expenses).toHaveTextContent('Not included')
  expect(screen.getByText('Email recipients').closest('li')).toHaveTextContent('of unlimited')
  const clients = screen.getByText('Clients').closest('li')
  expect(clients).toHaveTextContent('12of 60')
  expect(clients).toHaveTextContent('Per workspace')
  expect(clients).toHaveTextContent('Custom limit until')
  expect(clients).not.toHaveTextContent('Resets')
})
