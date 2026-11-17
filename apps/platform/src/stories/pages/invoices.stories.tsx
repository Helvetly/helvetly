import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

import { InvoicesPage } from '@/components/invoices/invoices-page'
import type { Invoice } from '@/lib/invoices'
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

/** The drawer of `invoice`, served for the sample invoice's id. */
const drawerOf = (invoice: Invoice) =>
  pageParameters('/invoices', { id: invoice.id }, [
    http.get(`/api/v1/invoices/${invoice.id}`, () => HttpResponse.json({ data: invoice })),
  ])

/** The amount a summary label (Paid, Credited, Refunded, …) shows. */
const summary = async (sheet: HTMLElement, label: string) =>
  within(sheet).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

const refund = {
  id: 'ref_mock_1',
  amount: '432.40',
  refunded_on: '2026-11-10',
  method: 'bank_transfer' as const,
  note: null,
  created_at: '2026-11-10T09:00:00Z',
  created_by: null,
}

// Paid in full, then credited 432.40 (taken from the last instalment backwards) and refunded.
const creditedAndRefunded: Invoice = {
  ...scheduledInvoice,
  status: 'paid',
  amount_paid: '1081.00',
  amount_credited: '432.40',
  amount_refunded: '432.40',
  amount_due: '0.00',
  refund_due: '0.00',
  refunds: [refund],
  instalments: {
    interval: 'monthly',
    items: [
      { ...scheduledInvoice.instalments!.items[0]!, paid: '360.35', open: '0.00', status: 'paid' },
      {
        ...scheduledInvoice.instalments!.items[1]!,
        effective: '288.25',
        paid: '288.25',
        open: '0.00',
        status: 'paid',
      },
      {
        ...scheduledInvoice.instalments!.items[2]!,
        effective: '0.00',
        paid: '0.00',
        open: '0.00',
        status: 'credited',
      },
    ],
  },
}

/** Each movement under its own name, with the net; credited instalments say so instead of "Paid". */
export const CreditedAndRefunded: Story = {
  parameters: drawerOf(creditedAndRefunded),
  play: async ({ canvasElement }) => {
    const sheet = await within(canvasElement.ownerDocument.body).findByRole('dialog')
    await within(sheet).findByText('Refunded', { selector: 'dt' })
    await expect(await summary(sheet, 'Paid')).toBe('CHF 1’081.00')
    await expect(await summary(sheet, 'Credited')).toBe('CHF 432.40')
    await expect(await summary(sheet, 'Refunded')).toBe('CHF 432.40')
    await expect(within(sheet).getByText('Net CHF 648.60')).toBeVisible()
    await expect(within(sheet).queryByText(/Paid · credited/)).toBeNull()
    const schedule = within(within(sheet).getByRole('region', { name: 'Instalments' }))
    await expect(schedule.getByText('Credited')).toBeVisible()
    await expect(schedule.getAllByText('Paid')).toHaveLength(2)
    await expect(schedule.getByText('CHF 72.10 credited')).toBeVisible()
    await expect(schedule.getByText('CHF 360.30 credited')).toBeVisible()
  },
}
export const CreditedAndRefundedDark = dark(CreditedAndRefunded)
export const CreditedAndRefundedPhone = phone(CreditedAndRefunded)

/** Paid, then credited in full and refunded: the server's void reads "Credited", never "Void". */
export const FullyCreditedAfterPaying: Story = {
  parameters: drawerOf({
    ...scheduledInvoice,
    status: 'void',
    amount_paid: '1081.00',
    amount_credited: '1081.00',
    amount_refunded: '1081.00',
    amount_due: '0.00',
    refund_due: '0.00',
    refunds: [{ ...refund, amount: '1081.00' }],
    instalments: null,
  }),
  play: async ({ canvasElement }) => {
    const sheet = await within(canvasElement.ownerDocument.body).findByRole('dialog')
    await within(sheet).findByText('Refunded', { selector: 'dt' })
    await expect(within(sheet).getAllByText('Credited').length).toBeGreaterThan(0)
    await expect(within(sheet).queryByText('Void')).toBeNull()
    await expect(within(sheet).getByText('Net CHF 0.00')).toBeVisible()
  },
}
export const FullyCreditedAfterPayingDark = dark(FullyCreditedAfterPaying)
