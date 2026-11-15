import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { fireEvent, render as renderPlain, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type * as Billing from '@/lib/billing'

import { AITokenPacks, bestValue } from './ai-token-packs'
import { billingFixture } from './billing-fixture'

const mutate = vi.fn<(input: { tokens: number }, options: unknown) => void>()
const pending = { value: false }
vi.mock('@/lib/billing', async (original) => ({
  ...(await original<typeof Billing>()),
  useBuyAITokens: () => ({ mutate, isPending: pending.value }),
}))

const packs: Billing.AIPack[] = [
  { tokens: 1_000_000, amount: 1000, currency: 'chf' },
  { tokens: 5_000_000, amount: 4000, currency: 'chf' },
  { tokens: 20_000_000, amount: 15000, currency: 'chf' },
]
const onPlan = billingFixture({
  plan: 'basic',
  status: 'active',
  usage: [{ limit: 'ai_tokens_per_month', used: 1_200_000, max: 6_000_000 }],
  ai_tokens_bought: 5_000_000,
  ai_packs: packs,
})

const render = (ui: ReactElement) => renderPlain(<TooltipProvider>{ui}</TooltipProvider>)

beforeEach(() => {
  mutate.mockClear()
  pending.value = false
})

test('shows the month’s AI tokens and how the allowance is made up', () => {
  render(<AITokenPacks billing={onPlan} />)
  expect(screen.getByText(/used this month/).closest('p')).toHaveTextContent(
    '1.2 Mof 6 M used this month',
  )
  expect(screen.getByLabelText('AI tokens: 1.2 M of 6 M used')).toBeInTheDocument()
  expect(screen.getByText('1 M from the plan + 5 M from packs bought this month')).toBeVisible()
})

test('prices each pack per 1 M tokens and marks the cheapest', () => {
  render(<AITokenPacks billing={onPlan} />)
  expect(screen.getByText('CHF 7.50 per 1 M')).toBeVisible()
  expect(screen.getAllByText('Best value')).toHaveLength(1)
  expect(screen.getByText('Best value').closest('label')).toHaveTextContent('20 M tokens')
})

test('buys the chosen pack with one button', () => {
  render(<AITokenPacks billing={onPlan} />)
  fireEvent.click(screen.getByRole('radio', { name: '5 M tokens for CHF 40' }))
  fireEvent.click(screen.getByRole('button', { name: 'Buy 5 M tokens · CHF 40' }))
  expect(mutate).toHaveBeenCalledWith({ tokens: 5_000_000 }, expect.anything())
})

test('the smallest pack is chosen to start with', () => {
  render(<AITokenPacks billing={onPlan} />)
  expect(screen.getByRole('radio', { name: '1 M tokens for CHF 10' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Buy 1 M tokens · CHF 10' })).toBeEnabled()
})

test('the choice and the button wait while checkout opens', () => {
  pending.value = true
  render(<AITokenPacks billing={onPlan} />)
  expect(screen.getByRole('button', { name: /Buy/ })).toBeDisabled()
  for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
})

test('nothing is shown when no pack is on sale', () => {
  const { container } = render(<AITokenPacks billing={{ ...onPlan, ai_packs: [] }} />)
  expect(container).toBeEmptyDOMElement()
})

test('best value needs packs that differ in price per token', () => {
  const [one, , twenty] = packs
  expect(bestValue(packs)).toBe(twenty)
  if (!one) throw new Error('no pack')
  expect(bestValue([one, { ...one, tokens: 2_000_000, amount: 2000 }])).toBeUndefined()
  expect(bestValue([one])).toBeUndefined()
})
