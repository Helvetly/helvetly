import { fireEvent, render, screen } from '@testing-library/react'

import type * as Billing from '@/lib/billing'

import { AITokenPacks } from './ai-token-packs'
import { billingFixture } from './billing-fixture'

const mutate = vi.fn<(input: { tokens: number }, options: unknown) => void>()
vi.mock('@/lib/billing', async (original) => ({
  ...(await original<typeof Billing>()),
  useBuyAITokens: () => ({ mutate, isPending: false }),
}))

const onPlan = billingFixture({
  plan: 'basic',
  status: 'active',
  usage: [{ limit: 'ai_tokens_per_month', used: 1_200_000, max: 6_000_000 }],
  ai_tokens_bought: 5_000_000,
  ai_packs: [
    { tokens: 1_000_000, amount: 1000, currency: 'chf' },
    { tokens: 5_000_000, amount: 4000, currency: 'chf' },
  ],
})

test('shows the month’s AI tokens and buys the chosen pack', () => {
  render(<AITokenPacks billing={onPlan} />)
  expect(screen.getByText(/used this month/)).toHaveTextContent(
    '1.2 M of 6 M used this month (5 M bought)',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Buy 5 M AI tokens' }))
  expect(mutate).toHaveBeenCalledWith({ tokens: 5_000_000 }, expect.anything())
})

test('nothing is shown when no pack is on sale', () => {
  const { container } = render(<AITokenPacks billing={{ ...onPlan, ai_packs: [] }} />)
  expect(container).toBeEmptyDOMElement()
})
