import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { billingFixture, publicOfferFixture } from '@/components/billing/billing-fixture'
import { PlanCards } from '@/components/billing/plan-cards'

const meta = {
  title: 'Billing/Plan picker',
  component: PlanCards,
  parameters: { layout: 'padded' },
  args: { billing: billingFixture(), offer: publicOfferFixture },
} satisfies Meta<typeof PlanCards>

export default meta
type Story = StoryObj<typeof meta>

/** A workspace on Free: Free as a compact current-plan strip, the paid plans as upgrades, yearly first. */
export const FreeCurrentPlan: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const free = canvas.getByRole('region', { name: 'Free' })
    await expect(free).toHaveTextContent('Your current plan')
    await expect(free).toHaveTextContent('CHF 0 forever · 1 person · no card needed')
    await expect(within(free).queryByRole('button')).toBeNull()
    await expect(canvas.queryByRole('article', { name: 'Free' })).toBeNull()
    await Promise.all(
      ['Basic', 'Pro', 'Business'].map((name) =>
        expect(canvas.getByRole('article', { name })).toBeVisible(),
      ),
    )
    await expect(
      within(canvas.getByRole('article', { name: 'Pro' })).getByText('Recommended'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Start 14-day free trial' })).toBeEnabled()
  },
}

/** The toggle starts on yearly with what it saves, and the arrow keys switch it. */
export const IntervalByKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const yearly = canvas.getByRole('radio', { name: 'Yearly' })
    const monthly = canvas.getByRole('radio', { name: 'Monthly' })
    await expect(yearly).toBeChecked()
    await expect(canvas.getByText('Save CHF 45 a year on Basic')).toBeVisible()
    const basic = canvas.getByRole('article', { name: 'Basic' })
    await expect(basic).toHaveTextContent('CHF 183 / year · save CHF 45')

    yearly.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(monthly).toBeChecked()
    await expect(monthly).toHaveFocus()
    await expect(basic).toHaveTextContent('1 person incl. · +CHF 10 / person')
    await expect(canvas.getByRole('article', { name: 'Pro' })).toHaveTextContent(
      'Then CHF 64 a month for 3 people.',
    )

    await userEvent.keyboard('{ArrowRight}')
    await expect(yearly).toBeChecked()
  },
}

/** A paid workspace sees no Free strip; its own interval is chosen. Every feature opens in place under the cards. */
export const CompareInPlace: Story = {
  args: { billing: billingFixture({ plan: 'basic', status: 'active', interval: 'month' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'Free' })).toBeNull()
    await expect(canvas.getByRole('radio', { name: 'Monthly' })).toBeChecked()
    await expect(
      within(canvas.getByRole('article', { name: 'Basic' })).getByText('Current'),
    ).toBeVisible()
    const compare = canvas.getByRole('button', { name: 'Compare every feature' })
    await userEvent.click(compare)
    await expect(compare).toHaveAttribute('aria-expanded', 'true')
    await expect(canvasElement.querySelector('[data-slot=plan-comparison]')).toBeInTheDocument()
    await userEvent.click(compare)
    await expect(canvasElement.querySelector('[data-slot=plan-comparison]')).toBeNull()
  },
}
