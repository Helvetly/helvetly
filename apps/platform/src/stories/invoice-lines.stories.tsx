import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { newLine, type EditorLine } from '@/components/invoices/editor-model'
import { LinesEditor } from '@/components/invoices/lines-editor'

const meta = {
  title: 'Invoices/Line editor',
  parameters: {
    msw: { handlers: [http.get('/api/v1/products/search', () => HttpResponse.json({ data: [] }))] },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const blank = () => newLine({ vat_mode: 'exclusive' }, '8.1')

function Editor({ initial }: { initial: EditorLine[] }) {
  const [lines, setLines] = useState(initial)
  return (
    <LinesEditor
      lines={lines}
      vatMode="exclusive"
      defaultRate="8.1"
      amounts={lines.map(() => '0.00')}
      errors={{}}
      onChange={setLines}
      currency="CHF"
    />
  )
}

export const KeyboardAddsLine: Story = {
  render: () => <Editor initial={[blank()]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Line 1 description' }), 'Consulting')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('textbox', { name: 'Line 2 description' })).toHaveFocus()
    await userEvent.keyboard('{Backspace}')
    await expect(
      canvas.queryByRole('textbox', { name: 'Line 2 description' }),
    ).not.toBeInTheDocument()
  },
}

export const IntegerQuantitiesStayIntact: Story = {
  render: () => (
    <Editor
      initial={[
        { ...blank(), description: 'Ten hours', quantity: '10', unit_price: '100', vat_rate: '20' },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Line 1 quantity')).toHaveValue('10')
    await expect(canvas.getByLabelText('Line 1 price')).toHaveValue('100')
    await expect(canvas.getByRole('button', { name: /20%/ })).toBeVisible()
  },
}

export const ExemptionNeedsExplicitCode: Story = {
  render: () => (
    <Editor
      initial={[{ ...blank(), description: 'Exempt service', vat_category: 'E', vat_rate: '0' }]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const code = canvas.getByLabelText('Line 1 VAT exemption code')
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await userEvent.selectOptions(code, 'VATEX-EU-132-1A')
    await expect(code).not.toHaveAttribute('aria-invalid')
    await expect(canvas.getByLabelText('Line 1 VAT exemption reason')).toHaveAttribute(
      'maxlength',
      '300',
    )
  },
}

export const ForeignPriceRequiresRepricing: Story = {
  render: () => (
    <Editor
      initial={[{ ...blank(), description: 'EUR service', unit_price: '', price_currency: 'EUR' }]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Priced in EUR. Enter the CHF price.')).toBeVisible()
    const price = canvas.getByLabelText('Line 1 price')
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(price, '95')
    await expect(canvas.queryByText('Priced in EUR. Enter the CHF price.')).not.toBeInTheDocument()
  },
}
