import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AITokenPacks } from '@/components/billing/ai-token-packs'
import { billingFixture } from '@/components/billing/billing-fixture'
import type { Billing } from '@/lib/billing'

const buyRequest = fn()
const packs = [
  { tokens: 1_000_000, amount: 1000, currency: 'chf' },
  { tokens: 5_000_000, amount: 4000, currency: 'chf' },
  { tokens: 20_000_000, amount: 15000, currency: 'chf' },
]
const manager = billingFixture({
  plan: 'basic',
  status: 'active',
  usage: [{ limit: 'ai_tokens_per_month', used: 4_700_000, max: 6_000_000 }],
  ai_tokens_bought: 5_000_000,
  ai_packs: packs,
})
// The API sends no packs to someone who cannot manage billing.
const member: Billing = { ...manager, can_manage: false, ai_packs: [] }

const meta = {
  title: 'Settings/Billing/AI tokens',
  args: { billing: manager },
  render: ({ billing }) => (
    <div className="max-w-4xl">
      <AITokenPacks billing={billing} />
    </div>
  ),
  parameters: {
    msw: {
      handlers: [
        // Never answers, so the story stays on the pending state instead of leaving for Checkout.
        http.post('/api/v1/billing/ai-tokens', async ({ request }) => {
          buyRequest(await request.json())
          await delay('infinite')
          return HttpResponse.json({ data: { url: '#' } })
        }),
      ],
    },
  },
} satisfies Meta<{ billing: Billing }>
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: {
    options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
  },
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = within(canvas.getByRole('region', { name: 'AI tokens' }))
    await expect(card.getByText('4.7 M')).toBeVisible()
    await expect(card.getByText('of 6 M used this month')).toBeVisible()
    await expect(card.getByText('Almost used up')).toBeVisible()
    await expect(
      card.getByText('1 M from the plan + 5 M from packs bought this month'),
    ).toBeVisible()
    await expect(card.getByText('Best value').closest('label')).toHaveTextContent('20 M tokens')
    await expect(card.getByText('CHF 7.50 per 1 M')).toBeVisible()
    await expect(card.getByRole('radio', { name: '1 M tokens for CHF 10' })).toBeChecked()

    // The longer explanation sits behind the (?) next to the subtitle.
    await userEvent.hover(card.getByRole('button', { name: 'About AI tokens' }))
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(/lapse/)
    await userEvent.unhover(card.getByRole('button', { name: 'About AI tokens' }))

    // Choosing a pack changes the one Buy button, without moving it.
    const button = card.getByRole('button', { name: 'Buy 1 M tokens · CHF 10' })
    const top = button.getBoundingClientRect().top
    await userEvent.click(card.getByText('20 M tokens'))
    await expect(card.getByRole('radio', { name: '20 M tokens for CHF 150' })).toBeChecked()
    await expect(card.getByRole('button', { name: 'Buy 20 M tokens · CHF 150' })).toBe(button)
    await expect(button.getBoundingClientRect().top).toBe(top)
  },
}

export const Phone: Story = {
  ...Default,
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await Default.play?.(context)
    const card = within(context.canvasElement).getByRole('region', { name: 'AI tokens' })
    // No sideways scroll, and the packs stack in one column.
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
    const [first, second] = [...card.querySelectorAll('[data-slot=ai-pack]')]
    if (!first || !second) throw new Error('expected two packs')
    await expect(second.getBoundingClientRect().top).toBeGreaterThan(
      first.getBoundingClientRect().bottom,
    )
  },
}

export const Dark: Story = { ...Default, parameters: { dark: true } }

export const MemberWithoutManageRights: Story = {
  args: { billing: member },
  play: async ({ canvasElement }) => {
    // Only a manager can buy packs; a member sees the month's AI tokens in the usage tiles instead.
    await expect(within(canvasElement).queryByRole('region', { name: 'AI tokens' })).toBeNull()
    await expect(within(canvasElement).queryByRole('radio')).toBeNull()
  },
}

export const BuyingPending: Story = {
  play: async ({ canvasElement }) => {
    buyRequest.mockClear()
    const card = within(within(canvasElement).getByRole('region', { name: 'AI tokens' }))
    await userEvent.click(card.getByRole('radio', { name: '5 M tokens for CHF 40' }))
    const button = card.getByRole('button', { name: 'Buy 5 M tokens · CHF 40' })
    await userEvent.click(button)
    await waitFor(() => expect(buyRequest).toHaveBeenCalledWith({ tokens: 5_000_000 }))
    await waitFor(() => expect(button).toBeDisabled())
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await Promise.all(card.getAllByRole('radio').map((radio) => expect(radio).toBeDisabled()))
    // A second click while Checkout opens sends nothing more.
    await userEvent.click(button, { pointerEventsCheck: 0 })
    await expect(buyRequest).toHaveBeenCalledTimes(1)
  },
}
