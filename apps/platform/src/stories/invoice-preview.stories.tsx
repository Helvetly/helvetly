import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { InvoicePreview } from '@/components/onboarding/invoice-preview'
import { valuesFrom } from '@/components/onboarding/onboarding-model'
import type { InvoiceSettings } from '@/lib/invoices'
import { sampleSettings } from '@/test/invoice-api'

type Vat = Pick<InvoiceSettings, 'default_vat_rate' | 'default_vat_mode'>
type Args = { registered: boolean; vat: Vat }

const net = (rate: string): Vat => ({ default_vat_rate: rate, default_vat_mode: 'exclusive' })
const gross = (rate: string): Vat => ({ default_vat_rate: rate, default_vat_mode: 'inclusive' })
const values = valuesFrom(sampleSettings())

const meta = {
  title: 'Onboarding/Invoice preview',
  args: { registered: true, vat: net('8.1') },
  render: ({ registered, vat }) => (
    <div className="p-6">
      <InvoicePreview values={{ ...values, vat_registered: registered }} logo={null} vat={vat} />
    </div>
  ),
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>

/** The sample's two lines come to CHF 2'450.00 before VAT. */
const expectRows = async (
  canvasElement: HTMLElement,
  vat: [string, string] | null,
  total: RegExp,
) => {
  const canvas = within(canvasElement)
  if (vat) await expect(canvas.getByText(vat[0]).parentElement).toHaveTextContent(vat[1])
  else await expect(canvas.queryByText(/MWST/)).not.toBeInTheDocument()
  await expect(canvas.getByText('Total').parentElement).toHaveTextContent(total)
}

export const StandardRate: Story = {
  play: ({ canvasElement }) => expectRows(canvasElement, ['MWST 8.1%', '198.45'], /2.648\.45$/),
}

export const OtherRate: Story = {
  args: { vat: net('19') },
  play: ({ canvasElement }) => expectRows(canvasElement, ['MWST 19%', '465.50'], /2.915\.50$/),
}

export const ReducedRate: Story = {
  args: { vat: net('2.6') },
  play: ({ canvasElement }) => expectRows(canvasElement, ['MWST 2.6%', '63.70'], /2.513\.70$/),
}

export const ZeroRate: Story = {
  args: { vat: net('0') },
  play: ({ canvasElement }) => expectRows(canvasElement, ['MWST 0%', '0.00'], /2.450\.00$/),
}

export const GrossPrices: Story = {
  args: { vat: gross('8.1') },
  play: ({ canvasElement }) =>
    expectRows(canvasElement, ['inkl. MWST 8.1%', '183.58'], /2.450\.00$/),
}

export const NotRegistered: Story = {
  args: { registered: false },
  play: ({ canvasElement }) => expectRows(canvasElement, null, /2.450\.00$/),
}

/** Changed settings redraw the sample at once; nothing of the previous rate or mode stays. */
export const SettingsChange: Story = {
  render: function Render() {
    const [vat, setVat] = useState(net('8.1'))
    const [registered, setRegistered] = useState(true)
    return (
      <div className="grid justify-items-start gap-4 p-6">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setVat(net('19'))}>
            19% net
          </Button>
          <Button variant="outline" onClick={() => setVat(gross('19'))}>
            19% gross
          </Button>
          <Button variant="outline" onClick={() => setRegistered(false)}>
            Not registered
          </Button>
        </div>
        <InvoicePreview values={{ ...values, vat_registered: registered }} logo={null} vat={vat} />
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectRows(canvasElement, ['MWST 8.1%', '198.45'], /2.648\.45$/)

    await userEvent.click(canvas.getByRole('button', { name: '19% net' }))
    await expect(canvas.queryByText('MWST 8.1%')).not.toBeInTheDocument()
    await expectRows(canvasElement, ['MWST 19%', '465.50'], /2.915\.50$/)

    await userEvent.click(canvas.getByRole('button', { name: '19% gross' }))
    await expect(canvas.queryByText('MWST 19%')).not.toBeInTheDocument()
    await expectRows(canvasElement, ['inkl. MWST 19%', '391.18'], /2.450\.00$/)

    await userEvent.click(canvas.getByRole('button', { name: 'Not registered' }))
    await expectRows(canvasElement, null, /2.450\.00$/)
  },
}
