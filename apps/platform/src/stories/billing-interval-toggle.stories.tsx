import {
  type BillingInterval,
  BillingIntervalToggle,
} from '@helvetly/ui/components/billing-interval-toggle'
import { translate } from '@helvetly/ui/lib/i18n'
import { YEARLY_DISCOUNT_PERCENT, yearlyFreeMonths } from '@helvetly/ui/lib/price'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

const meta = {
  title: 'Billing/Interval toggle',
  parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// The offer's base prices (rappen): the free months are computed from Pro's, never written down.
const freeMonths = yearlyFreeMonths([
  { id: 'basic', name: 'Basic', month: 1900, year: 18300 },
  { id: 'pro', name: 'Pro', month: 4900, year: 47100 },
])
const saving =
  freeMonths && translate('planYearlyFreeMonths', { ...freeMonths, over: String(freeMonths.over) })

function Toggle() {
  const [value, setValue] = useState<BillingInterval>('year')
  return (
    <div className="grid justify-items-center gap-4">
      <BillingIntervalToggle
        value={value}
        onValueChange={setValue}
        discount={YEARLY_DISCOUNT_PERCENT}
        saving={saving}
      />
      <output aria-label="chosen">{value}</output>
    </div>
  )
}

/**
 * Yearly by default with its discount inside and the saving under it; arrow keys move between the options and
 * choose, and the saving's line keeps its room on monthly so nothing below moves.
 */
export const Default: Story = {
  render: () => <Toggle />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const yearly = canvas.getByRole('radio', { name: 'Yearly' })
    const monthly = canvas.getByRole('radio', { name: 'Monthly' })
    await expect(canvas.getByRole('radiogroup', { name: 'Billing interval' })).toBeVisible()
    await expect(yearly).toBeChecked()
    await expect(yearly).toHaveAccessibleDescription('−20%')
    const saved = canvas.getByText('Pay yearly: over 2 months of Pro free')
    await expect(saved).toBeVisible()
    const toggle = canvasElement.querySelector('[data-slot=billing-interval]')
    const height = toggle?.getBoundingClientRect().height

    // Arrows choose the other option and move focus with it.
    yearly.focus()
    const box = yearly.closest('label')?.getBoundingClientRect()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(monthly).toBeChecked()
    await expect(monthly).toHaveFocus()
    await expect(canvas.getByLabelText('chosen')).toHaveTextContent('month')
    await expect(saved).not.toBeVisible()
    await expect(canvas.getByText('−20%')).toBeVisible()
    await expect(toggle?.getBoundingClientRect().height).toBe(height)
    await userEvent.keyboard('{ArrowRight}')
    await expect(yearly).toBeChecked()
    // Focus and choice never move the options.
    await expect(yearly.closest('label')?.getBoundingClientRect()).toEqual(box)
    await expect(
      canvas.getByRole('radiogroup').getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44)

    await userEvent.click(monthly)
    await expect(canvas.getByLabelText('chosen')).toHaveTextContent('month')
  },
}

/** Without a discount or saving to show (prices unavailable): the two options alone. */
export const WithoutSaving: Story = {
  render: () => <BillingIntervalToggle value="month" onValueChange={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'Monthly' })).toBeChecked()
    await expect(canvas.queryByText(/Save|%/)).toBeNull()
  },
}
