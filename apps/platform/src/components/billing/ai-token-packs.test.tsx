import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render as renderPlain, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { AITokenPacks } from './ai-token-packs'
import { billingFixture } from './billing-fixture'

const withPacks = billingFixture({
  plan: 'basic',
  status: 'active',
  usage: [{ limit: 'ai_tokens_per_month', used: 1_200_000, max: 6_000_000 }],
  ai_tokens_bought: 5_000_000,
})

const render = (ui: ReactElement) => renderPlain(<TooltipProvider>{ui}</TooltipProvider>)

test('shows the month’s AI tokens and how the allowance is made up, with nothing to buy', () => {
  render(<AITokenPacks billing={withPacks} />)
  expect(screen.getByText(/used this month/).closest('p')).toHaveTextContent(
    '1.2Mof 6M used this month',
  )
  expect(screen.getByLabelText('AI tokens: 1.2M of 6M used')).toBeInTheDocument()
  expect(screen.getByText('1M from the plan + 5M from packs bought this month')).toBeVisible()
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.queryByRole('button', { name: /Buy/ })).toBeNull()
})

test('nothing is shown without tokens from packs bought this month', () => {
  const { container } = render(<AITokenPacks billing={{ ...withPacks, ai_tokens_bought: 0 }} />)
  expect(container).toBeEmptyDOMElement()
})
