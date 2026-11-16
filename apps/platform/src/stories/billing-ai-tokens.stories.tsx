import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { AITokenPacks } from '@/components/billing/ai-token-packs'
import { billingFixture } from '@/components/billing/billing-fixture'
import type { Billing } from '@/lib/billing'

// Packs are no longer sold; tokens from packs bought earlier this month still count.
const withPacks = billingFixture({
  plan: 'basic',
  status: 'active',
  usage: [{ limit: 'ai_tokens_per_month', used: 4_700_000, max: 6_000_000 }],
  ai_tokens_bought: 5_000_000,
})

const meta = {
  title: 'Settings/Billing/AI tokens',
  args: { billing: withPacks },
  render: ({ billing }) => (
    <div className="max-w-4xl">
      <AITokenPacks billing={billing} />
    </div>
  ),
} satisfies Meta<{ billing: Billing }>
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: {
    options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
  },
}

export const BoughtPacks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = within(canvas.getByRole('region', { name: 'AI tokens' }))
    await expect(card.getByText('4.7 M')).toBeVisible()
    await expect(card.getByText('of 6 M used this month')).toBeVisible()
    await expect(card.getByText('Almost used up')).toBeVisible()
    await expect(
      card.getByText('1 M from the plan + 5 M from packs bought this month'),
    ).toBeVisible()
    // Nothing to buy: no pack offers, no best value, no Buy button.
    await expect(card.queryByRole('radio')).toBeNull()
    await expect(card.queryByText('Best value')).toBeNull()
    await expect(card.queryByRole('button', { name: /Buy/ })).toBeNull()

    // The longer explanation sits behind the (?) next to the subtitle.
    await userEvent.hover(card.getByRole('button', { name: 'About AI tokens' }))
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      /no longer sold/,
    )
    await userEvent.unhover(card.getByRole('button', { name: 'About AI tokens' }))
  },
}

export const BoughtPacksPhone: Story = {
  ...BoughtPacks,
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await BoughtPacks.play?.(context)
    const card = within(context.canvasElement).getByRole('region', { name: 'AI tokens' })
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  },
}

export const BoughtPacksDark: Story = { ...BoughtPacks, parameters: { dark: true } }

export const NoPacksBought: Story = {
  args: { billing: { ...withPacks, ai_tokens_bought: 0 } },
  play: async ({ canvasElement }) => {
    // The month's AI tokens are in the usage tiles; this card only explains packs bought earlier.
    await expect(within(canvasElement).queryByRole('region', { name: 'AI tokens' })).toBeNull()
  },
}
