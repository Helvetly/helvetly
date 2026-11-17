import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalHandlers, portalInvoices } from '@/mocks/portal'

import { PortalInvoices } from './portal-invoices'

const url = '/api/v1/public/portal/invoices'
const meta = {
  title: 'Portal/Invoices',
  component: PortalInvoices,
  parameters: { msw: { handlers: portalHandlers } },
} satisfies Meta<typeof PortalInvoices>
export default meta
type Story = StoryObj<typeof meta>

const withInvoices = (handler: Parameters<typeof http.get>[1]) => ({
  msw: { handlers: [http.get(url, handler), ...portalHandlers] },
})
const year = new Date().getFullYear()

/** Summary from the list, counts per filter, and filtering to overdue and paid. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const open = await canvas.findByText('Open', { selector: 'dt' })
    await expect(open.nextElementSibling).toHaveTextContent('CHF 4’800.00')
    await expect(
      canvas.getByText('Overdue', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('CHF 860.00')
    await expect(
      canvas.getByText(`Paid in ${year}`, { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('CHF 1’500.00')

    await expect(canvas.getByRole('tab', { name: 'All 5' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('tab', { name: 'Open 3' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Paid 2' })).toBeVisible()
    await expect(canvas.getByText('Due in 5 days')).toBeVisible()
    await expect(canvas.getByText('CHF 700.00 open')).toBeVisible()
    await expect(canvas.getByText('Pay with the Swiss QR bill in each PDF.')).toBeVisible()

    await userEvent.click(canvas.getByRole('tab', { name: 'Overdue 1' }))
    const list = canvas.getByRole('tabpanel')
    await expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    await expect(within(list).getByText('12 days overdue')).toBeVisible()

    await userEvent.click(canvas.getByRole('tab', { name: 'Paid 2' }))
    await expect(within(canvas.getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(2)
  },
}

export const FilledDark: Story = { ...Filled, parameters: { ...meta.parameters, dark: true } }

export const FilteredEmpty: Story = {
  parameters: withInvoices(() =>
    HttpResponse.json({ data: portalInvoices.filter((i) => !i.is_overdue) }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Overdue 0' }))
    await expect(canvas.getByText('No overdue invoices')).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: withInvoices(async () => {
    await delay('infinite')
    return HttpResponse.json({ data: [] })
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status', { name: 'Loading invoices' })).toBeVisible(),
    )
  },
}

export const Empty: Story = {
  parameters: withInvoices(() => HttpResponse.json({ data: [] })),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No invoices yet')).toBeVisible()
  },
}

export const ErrorState: Story = {
  parameters: withInvoices(() =>
    HttpResponse.json({ error: { code: 'internal', message: 'Server is down.' } }, { status: 500 }),
  ),
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert', {}, { timeout: 10000 })
    await expect(alert).toBeVisible()
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

export const DownloadLink: Story = {
  play: async ({ canvasElement }) => {
    const link = await within(canvasElement).findByRole('link', {
      name: `Download PDF of invoice ${year}-014`,
    })
    await expect(link).toHaveAttribute('href', '/api/v1/public/portal/invoices/inv_1/pdf')
  },
}

/** Paid, then fully credited and refunded: the server's void reads "Credited", never "Void". */
export const CreditedAfterPaying: Story = {
  parameters: withInvoices(() =>
    HttpResponse.json({
      data: [
        { ...portalInvoices[3]!, id: 'inv_c', status: 'void', amount_paid: '1000.00' },
        { ...portalInvoices[4]!, id: 'inv_v', status: 'void' },
      ],
    }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Credited')).toBeVisible()
    await expect(canvas.getByText('Void')).toBeVisible()
  },
}
