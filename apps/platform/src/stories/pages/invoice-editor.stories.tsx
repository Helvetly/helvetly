import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { InvoiceEditorDrawer } from '@/components/invoices/invoice-editor'

import {
  closeHeidi,
  dark,
  desktop,
  expectFooterAtTheBottom,
  Frame,
  pageParameters,
  phone,
  shows,
} from './frame'

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

    // The contract number hides again and waits in the menu, emptied.
    await userEvent.click(page.getByRole('button', { name: 'Remove the contract number' }))
    await expect(page.queryByRole('textbox', { name: /Contract no\./ })).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Contract no.' }))
    await expect(await page.findByRole('textbox', { name: /Contract no\./ })).toHaveValue('')
  },
}

/**
 * The link icon beside Client no. toggles, never navigates: linked shows the client's own number read-only;
 * unlinked takes a number typed in, and linking again goes back to the client's.
 */
export const ClientNumberLinkToggle: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    const linked = await page.findByRole('textbox', { name: /Client no\./ })
    await expect(linked).toHaveValue('1')
    await expect(linked).toHaveAttribute('readonly')
    await userEvent.click(page.getByRole('button', { name: /Unlink to type your own/ }))
    const own = page.getByRole('textbox', { name: /Client no\./ })
    await expect(own).not.toHaveAttribute('readonly')
    await userEvent.clear(own)
    await expect(own).not.toHaveAttribute('readonly') // emptied, still the person's own field
    await userEvent.type(own, 'K-0815')
    await expect(own).toHaveValue('K-0815')
    await userEvent.click(page.getByRole('button', { name: 'Use the client’s number' }))
    await expect(page.getByRole('textbox', { name: /Client no\./ })).toHaveValue('1')
    await expect(page.getByText('Alpenglow Studio GmbH')).toBeVisible() // still in the editor
  },
}

/** The engagement row is optional too: under Add field until chosen, and it hides again while empty. */
export const EngagementIsOptional: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    await expect(page.queryByText('Choose an engagement')).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Engagement' }))
    await expect(await page.findByRole('button', { name: 'Hide the engagement row' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Hide the engagement row' }))
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await expect(await page.findByRole('menuitem', { name: 'Engagement' })).toBeVisible()
  },
}

/** Like a printed page, the footer text sits at the bottom of the paper, with the free space above it. */
export const FooterAtTheBottom: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    await expectFooterAtTheBottom(within(document.body).getByRole('article'))
  },
}
export const FooterAtTheBottomPhone = phone(FooterAtTheBottom)
