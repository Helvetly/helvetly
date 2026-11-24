import {
  type BillingInterval,
  BillingIntervalToggle,
} from '@helvetly/ui/components/billing-interval-toggle'
import { translate } from '@helvetly/ui/lib/i18n'
import { formatPrice, YEARLY_DISCOUNT_PERCENT, savingOf } from '@helvetly/ui/lib/price'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

const meta = {
  title: 'Billing/Interval toggle',
  parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// Basic's base price in the offer (rappen): what yearly saves is computed from it, never written down.
const BASIC_MONTH = { amount: 1900, currency: 'chf' }
const saving = translate('planYearlySaving', {
  percent: YEARLY_DISCOUNT_PERCENT,
  amount: formatPrice(savingOf(BASIC_MONTH)),
  plan: 'Basic',
})

function Toggle() {
  const [value, setValue] = useState<BillingInterval>('year')
  return (
    <div className="grid justify-items-center gap-4">
      <BillingIntervalToggle value={value} onValueChange={setValue} saving={saving} />
      <output aria-label="chosen">{value}</output>
    </div>
  )
}

/** Yearly by default, the saving beside it; arrow keys move between the options and choose. */
export const Default: Story = {
  render: () => <Toggle />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const yearly = canvas.getByRole('radio', { name: 'Yearly' })
    const monthly = canvas.getByRole('radio', { name: 'Monthly' })
    await expect(canvas.getByRole('group', { name: 'Billing interval' })).toBeVisible()
    await expect(yearly).toBeChecked()
    await expect(canvas.getByText('Save 20% — CHF 45 a year on Basic')).toBeVisible()

    // Arrows choose the other option and move focus with it.
    yearly.focus()
    const box = yearly.closest('label')?.getBoundingClientRect()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(monthly).toBeChecked()
    await expect(monthly).toHaveFocus()
    await expect(canvas.getByLabelText('chosen')).toHaveTextContent('month')
    await userEvent.keyboard('{ArrowRight}')
    await expect(yearly).toBeChecked()
    // Focus and choice never move the options.
    await expect(yearly.closest('label')?.getBoundingClientRect()).toEqual(box)
    await expect(canvas.getByRole('group').getBoundingClientRect().height).toBeGreaterThanOrEqual(
      44,
    )

    await userEvent.click(monthly)
    await expect(canvas.getByLabelText('chosen')).toHaveTextContent('month')
  },
}

/** Without a saving to show (prices unavailable): the pill alone. */
export const WithoutSaving: Story = {
  render: () => <BillingIntervalToggle value="month" onValueChange={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'Monthly' })).toBeChecked()
    await expect(canvas.queryByText(/Save/)).toBeNull()
  },
}
