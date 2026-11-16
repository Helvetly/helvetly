import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

import { InvoicesPage } from '@/components/invoices/invoices-page'
import { scheduledInvoice } from '@/mocks/data'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Invoices',
  beforeEach: closeHeidi,
  parameters: pageParameters('/invoices'),
  render: () => (
    <Frame>
      <InvoicesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Sophie Meier', 'Overdue') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

// A long one-line footer must wrap or truncate, never widen the drawer.
const longFooter = { ...scheduledInvoice, footer: 'Payment within 30 days. '.repeat(12).trim() }

/** The invoice drawer, opened from the list by its id in the URL. */
export const Detail: Story = {
  parameters: pageParameters('/invoices', { id: scheduledInvoice.id }, [
    http.get(`/api/v1/invoices/${scheduledInvoice.id}`, () =>
      HttpResponse.json({ data: longFooter }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const sheet = await within(canvasElement.ownerDocument.body).findByRole('dialog')
    // The drawer never scrolls sideways.
    await waitFor(() => expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth))
  },
}
export const DetailPhone = phone(Detail)
