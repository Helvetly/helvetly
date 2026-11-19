import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { InvoicesPage } from '@/components/invoices/invoices-page'
import type { Invoice } from '@/lib/invoices'
import { scheduledInvoice } from '@/mocks/data'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'
import { dropOpensImport, emptyList, emptyOffersImport, noDropTarget, readOnly } from './page-drop'

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

/** A valid PDF of `count` blank A4 pages, so the preview has pages to scroll. */
function blankPdf(count: number) {
  const pages = Array.from({ length: count }, (_, i) => 3 + i)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((n) => `${n} 0 R`).join(' ')}] /Count ${count} >>`,
    ...pages.map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

/** The PDF tab: the preview is its own scroller, so the wheel over it moves the pages, not the drawer. */
export const DetailPdf: Story = {
  parameters: pageParameters('/invoices', { id: scheduledInvoice.id }, [
    http.get(`/api/v1/invoices/${scheduledInvoice.id}`, () =>
      HttpResponse.json({ data: scheduledInvoice }),
    ),
    http.get(`/api/v1/invoices/${scheduledInvoice.id}/pdf`, () =>
      HttpResponse.text(blankPdf(3), { headers: { 'Content-Type': 'application/pdf' } }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const sheet = await within(canvasElement.ownerDocument.body).findByRole('dialog')
    await userEvent.click(await within(sheet).findByRole('tab', { name: 'PDF' }))
    const viewer = await within(sheet).findByRole('document')
    await waitFor(() => expect(viewer.querySelectorAll('canvas')).toHaveLength(3))
    expect(getComputedStyle(viewer).overscrollBehaviorY).toBe('contain')
    await waitFor(() => expect(viewer.scrollHeight).toBeGreaterThan(viewer.clientHeight))
    // The viewer stays within the drawer instead of growing with its pages.
    expect(viewer.clientHeight).toBeLessThan(sheet.clientHeight)
  },
}
export const DetailPdfDark = dark(DetailPdf)

/** Record a payment: paying the whole rest today is a visible button next to the main action. */
export const RecordPayment: Story = {
  parameters: Detail.parameters,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const sheet = await body.findByRole('dialog')
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Record payment' }))
    const dialog = await body.findByRole('dialog', { name: 'Record a payment' })
    const markPaid = within(dialog).getByRole('button', { name: 'Mark fully paid today' })
    expect(markPaid).toHaveAttribute('data-variant', 'outline')
    expect(markPaid.querySelector('svg')).not.toBeNull()
  },
}
export const RecordPaymentDark = dark(RecordPayment)
export const RecordPaymentPhone = phone(RecordPayment)

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

/** A new workspace: next to its first action the empty list offers Import, and a drop anywhere works too. */
export const Empty: Story = {
  parameters: emptyList('/invoices', '/api/v1/invoices'),
  play: emptyOffersImport('No invoices yet'),
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** Files dropped anywhere on the page open its import with them chosen. */
export const DropStartsImport: Story = {
  parameters: emptyList('/invoices', '/api/v1/invoices'),
  play: dropOpensImport(
    'No invoices yet',
    'Drop to import these invoices',
    'invoices',
    new File(['%PDF-1.4'], 'invoice-2025-118.pdf', { type: 'application/pdf' }),
  ),
}

/** Whoever may only read has no drop target and no hint. */
export const ReadOnlyNoDrop: Story = {
  parameters: readOnly('/invoices'),
  play: noDropTarget('Sophie Meier', 'invoices'),
}
