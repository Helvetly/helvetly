import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture, publicOfferFixture } from '@/components/billing/billing-fixture'
import { PlanCards } from '@/components/billing/plan-cards'

const meta = { title: 'Design system/Billing actions' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const SharedActions: Story = {
  render: () => (
    <div className="grid gap-6">
      <div className="flex gap-3">
        <Button size="xl">Shared action</Button>
        <Button size="xl" variant="outline">
          Secondary action
        </Button>
      </div>
      <PlanCards billing={billingFixture()} offer={publicOfferFixture} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reference = canvas.getByRole('button', { name: 'Shared action' })
    const secondary = canvas.getByRole('button', { name: 'Secondary action' })
    const actions = [
      ['Basic', 'Choose Basic'],
      ['Pro', 'Start 14-day free trial'],
      ['Business', 'Choose Business'],
    ] satisfies [string, string][]
    // Pro (recommended, and the one with the trial) is the primary way on; the rest are secondary.
    await Promise.all(
      actions.map(([plan, label]) => {
        const button = within(canvas.getByRole('article', { name: plan })).getByRole('button', {
          name: label,
        })
        const expected = getComputedStyle(plan === 'Pro' ? reference : secondary)
        const actual = getComputedStyle(button)
        return Promise.all([
          expect(button.getBoundingClientRect().height).toBe(
            reference.getBoundingClientRect().height,
          ),
          expect(actual.borderRadius).toBe(expected.borderRadius),
          expect(actual.fontSize).toBe(expected.fontSize),
          expect(actual.backgroundColor).toBe(expected.backgroundColor),
          expect(actual.color).toBe(expected.color),
        ])
      }),
    )
  },
}

export const SharedActionsDark: Story = { ...SharedActions, parameters: { dark: true } }

const launch20 = {
  code: 'LAUNCH20',
  percent_off: 20,
  amount_off: null,
  currency: null,
  duration: 'repeating',
  duration_in_months: 3,
  plans: ['basic', 'pro'],
  expires_at: null,
}

/** The one promotion code entry: the link opens the popover, Apply shows the discount, Cancel closes. */
export const PromotionCodeEntry: Story = {
  render: () => <PlanCards billing={billingFixture()} offer={publicOfferFixture} />,
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/billing/promotion-code', () => HttpResponse.json({ data: launch20 })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const link = () => canvas.getByRole('button', { name: 'Have a promotion code?' })

    await userEvent.click(link())
    await expect(await body.findByText('Promotion code')).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(body.queryByText('Promotion code')).not.toBeInTheDocument())

    await userEvent.click(link())
    await userEvent.type(await body.findByLabelText(/^Code/), 'launch20')
    await userEvent.click(body.getByRole('button', { name: 'Apply' }))
    await expect(await canvas.findByText('LAUNCH20')).toBeVisible()
    await expect(canvas.getByText('LAUNCH20').parentElement).toHaveTextContent(
      'LAUNCH20 · −20% for 3 months',
    )
    await expect(canvas.getByRole('button', { name: 'Change' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Remove' })).toBeVisible()
  },
}
