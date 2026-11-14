import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
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
      <PlanCards billing={billingFixture()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reference = canvas.getByRole('button', { name: 'Shared action' })
    const secondary = canvas.getByRole('button', { name: 'Secondary action' })
    const actions = [
      ['Basic', 'Start 7-day free trial'],
      ['Pro', 'Choose Pro'],
      ['Business', 'Choose Business'],
    ] satisfies [string, string][]
    // The trial and the recommended plan are the primary way on; the rest are secondary.
    await Promise.all(
      actions.map(([plan, label]) => {
        const button = within(canvas.getByRole('region', { name: plan })).getByRole('button', {
          name: label,
        })
        const expected = getComputedStyle(plan === 'Business' ? secondary : reference)
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
