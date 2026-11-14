import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { PaymentToggles } from '@/components/invoices/payment-methods'
import type { InvoiceSettings, PaymentMethods } from '@/lib/invoices'
import { sampleSettings } from '@/test/invoice-api'

function Toggles({ settings, currency = 'CHF' }: { settings: InvoiceSettings; currency?: string }) {
  const [value, setValue] = useState<PaymentMethods>({ qr_bill: true, revolut: false })
  return (
    <div className="p-6">
      <PaymentToggles settings={settings} currency={currency} value={value} onChange={setValue} />
    </div>
  )
}

const meta = {
  title: 'Invoices/Payment methods',
  component: Toggles,
  args: {
    settings: sampleSettings({
      iban: 'CH9300762011623852957',
      revolut_enabled: true,
      revolut_username: 'muster',
    }),
  },
} satisfies Meta<typeof Toggles>
export default meta
type Story = StoryObj<typeof meta>

const box = (checkbox: HTMLElement) => checkbox.nextElementSibling ?? checkbox

/** Checkbox chips: each method on or off on its own, the state readable at a glance, one control height. */
export const Chips: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const qr = canvas.getByRole('checkbox', { name: 'QR bill' })
    const revolut = canvas.getByRole('checkbox', { name: 'Revolut' })
    await expect(qr).toBeChecked()
    await expect(revolut).not.toBeChecked()
    // A checked method fills its box; an unchecked one stays an empty box.
    expect(getComputedStyle(box(qr)).backgroundColor).not.toBe(
      getComputedStyle(box(revolut)).backgroundColor,
    )
    await userEvent.click(revolut)
    await expect(revolut).toBeChecked()
    await expect(qr).toBeChecked()
    await userEvent.click(qr)
    await expect(qr).not.toBeChecked()
    for (const checkbox of [qr, revolut])
      expect(checkbox.closest('label')?.getBoundingClientRect().height).toBe(32)
  },
}
export const ChipsDark: Story = { ...Chips, parameters: { dark: true } }

/** A method not set up yet is a dashed chip that links to its setting. */
export const NotSetUp: Story = {
  args: { settings: sampleSettings({ iban: 'CH9300762011623852957' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('link', { name: 'Revolut' }).getAttribute('href')).toMatch(
      /^\/settings\/invoices\/?\?focus=revolut_enabled$/,
    )
  },
}

/** Where the QR bill cannot exist (USD), its chip is off and says why. */
export const Blocked: Story = {
  args: { ...meta.args, currency: 'USD' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('checkbox', { name: 'QR bill' })).toBeDisabled()
  },
}
