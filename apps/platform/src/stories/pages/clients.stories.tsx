import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ClientsPage } from '@/components/clients/clients-page'

import { ringClipper } from '../focus-ring'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Clients',
  beforeEach: closeHeidi,
  parameters: pageParameters('/clients'),
  render: () => (
    <Frame>
      <ClientsPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

// Keller asked for a profile change in the portal, so its row carries the badge.
export const List: Story = { play: shows('Keller Holzbau AG', 'Changes pending') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

export const Detail: Story = {
  parameters: pageParameters('/clients', { id: 'cli_1' }),
  play: shows('hello@alpenglow.ch'),
}
export const DetailDark = dark(Detail)
export const DetailPhone = phone(Detail)

/** "Add VAT number" in the Billing card turns into an input whose whole focus ring shows. */
export const DetailInlineFocus: Story = {
  parameters: pageParameters('/clients', { id: 'cli_2' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText('Billing', {}, { timeout: 8000 })
    await userEvent.click(await body.findByRole('button', { name: 'Add VAT number' }))
    const input = body.getByRole('textbox', { name: 'Add VAT number' })
    await expect(input).toHaveFocus()
    await expect(ringClipper(input)).toBeNull()
  },
}

/** The status quick view sits in the toolbar; other filters show as removable chips under it. */
export const Filtered: Story = {
  parameters: pageParameters('/clients', { status: 'active', type: 'company' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole('button', { name: 'Remove filter Companies' }, { timeout: 8000 }),
    ).toBeVisible()
    await expect(body.getByRole('radio', { name: /Active/ })).toBeChecked()
    await expect(body.queryByRole('button', { name: 'Remove filter Active' })).toBeNull()
    await expect(body.queryByRole('button', { name: 'Clear all' })).toBeNull()
    await expect(body.queryByRole('navigation', { name: 'Views' })).toBeNull()
  },
}

/** All, Active, Drafts and Inactive each show how many clients they hold; a click goes to the URL. */
export const StatusViews: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const views = await body.findByRole('group', { name: 'Status' }, { timeout: 8000 })
    await waitFor(() => expect(views).toHaveTextContent('All4Active4Drafts1Inactive0'))
    await expect(within(views).getByRole('radio', { name: /All/ })).toBeChecked()

    await userEvent.click(within(views).getByRole('radio', { name: /Drafts/ }))
    const url = new URL(canvasElement.ownerDocument.location.href)
    await expect(url.searchParams.getAll('status')).toEqual(['draft'])
  },
}

/** The Drafts view lists only clients still missing address details, its counts unchanged. */
export const DraftsView: Story = {
  parameters: pageParameters('/clients', { status: 'draft' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const views = await body.findByRole('group', { name: 'Status' }, { timeout: 8000 })
    await expect(within(views).getByRole('radio', { name: /Drafts/ })).toBeChecked()
    await waitFor(() => expect(body.getAllByText('Frei Logistik GmbH')[0]).toBeVisible())
    await expect(body.queryAllByText('Keller Holzbau AG')).toHaveLength(0)
    await waitFor(() => expect(views).toHaveTextContent('All4Active4Drafts1Inactive0'))
  },
}
export const StatusViewsPhone = phone(StatusViews)

/** A status combination no quick view stands for (from a link) shows as chips, none chosen. */
export const StatusOutsideViews: Story = {
  parameters: pageParameters('/clients', { status: 'complete' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole(
        'button',
        { name: 'Remove filter Complete address' },
        { timeout: 8000 },
      ),
    ).toBeVisible()
    await expect(body.queryAllByRole('radio', { checked: true })).toEqual([])
  },
}

/** An invoice opened from the client's drawer stacks on top of it; closing it uncovers the client again. */
export const DetailOpensInvoiceOnTop: Story = {
  parameters: pageParameters('/clients', { id: 'cli_1' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('tab', { name: 'Invoices' }, { timeout: 8000 }))
    await userEvent.click(await body.findByRole('link', { name: /2026-042/ }))

    const invoice = await body.findByRole('dialog', { name: /2026-042/ })
    await waitFor(() =>
      expect(within(invoice).getByRole('link', { name: /Alpenglow Studio GmbH/ })).toBeVisible(),
    )
    await expect(body.getAllByRole('dialog', { hidden: true })).toHaveLength(2)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog', { name: /2026-042/ })).toBeNull())
    await expect(body.getByRole('tab', { name: 'Invoices' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(body.getAllByRole('dialog')).toHaveLength(1)
  },
}
