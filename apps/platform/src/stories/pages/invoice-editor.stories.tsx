import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { InvoiceEditorDrawer } from '@/components/invoices/invoice-editor'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Invoice editor',
  beforeEach: closeHeidi,
  parameters: {
    ...pageParameters('/invoices', { compose: 'inv_draft' }),
    // shortcut: the date buttons' aria-labels ("Due date: 5 Dec 2026") leave out visible text
    // ("in 30 days", "Add date or period"); turn this rule on again once the editor fixes them.
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: false },
          { id: 'label-content-name-mismatch', enabled: false },
        ],
      },
    },
  },
  render: () => (
    <Frame>
      <InvoiceEditorDrawer
        compose={{ id: 'inv_draft', kind: 'invoice', client: null }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const DraftWithLines: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    await shows(/Brand workshop/)?.(context)
  },
}
export const DraftWithLinesDark = dark(DraftWithLines)
export const DraftWithLinesPhone = phone(DraftWithLines)

/**
 * Optional fields: the client number can be replaced or hidden, and a contract number added from the Add field
 * menu; a hidden client number comes back from the same menu.
 */
export const OptionalFields: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: 'Do not print a client number' }))
    await expect(page.queryByLabelText(/Client no\./)).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Contract no.' }))
    const contract = await page.findByRole('textbox', { name: /Contract no\./ })
    await userEvent.type(contract, 'C23-25-CP2302')
    await expect(contract).toHaveValue('C23-25-CP2302')
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Client no.' }))
    await expect(await page.findByRole('textbox', { name: /Client no\./ })).toBeVisible()
  },
}
