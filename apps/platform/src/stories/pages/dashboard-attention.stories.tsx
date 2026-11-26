import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

import { Dashboard } from '@/components/dashboard/dashboard'
import { endedMonths } from '@/components/settings/periods-settings'
import type { Period } from '@/lib/books'
import { dueLabel, today, type InvoiceListItem } from '@/lib/invoices'
import { scheduledInvoice } from '@/mocks/data'
import { sampleSettings } from '@/test/invoice-api'

import { sessionHandler, unavailable } from '../screen-fixtures'
import { attentionHandlers } from './api'
import { closeHeidi, desktop, Frame, pageParameters, shows } from './frame'

// Relative to today, so the stories never age: the three latest ended months, newest first. The
// mocked VAT return is monthly, so the latest one to file is the month that ended last.
const [last = '', previous = '', oldest = ''] = endedMonths(today(), 3)
const vatRow = `VAT return ${last}`
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' })
const ALL_DONE = 'All done. Nothing needs your attention.'

const closedMonths = (...months: string[]) =>
  months.map((month): Period => ({ month, closed_at: `${last}-28T09:00:00Z`, closed_by: null }))
const allClosed = closedMonths(last, previous, oldest)
const notRegistered = http.get('/api/v1/invoice-settings', () =>
  HttpResponse.json({ data: sampleSettings({ vat_registered: false }) }),
)
const noOpenInvoices = http.get('/api/v1/invoices', () =>
  HttpResponse.json({ data: [], meta: { page: 1, page_size: 50, total: 0, total_pages: 0 } }),
)

const meta = {
  title: 'Pages/Dashboard/Needs attention',
  beforeEach: closeHeidi,
  render: () => (
    <Frame>
      <Dashboard />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The "Needs attention" card, once the page is in. */
const card = async (context: Parameters<NonNullable<Story['play']>>[0]) => {
  await shows(/Cash flow/i)?.(context)
  const heading = await within(document.body).findByRole('heading', { name: 'Needs attention' })
  const section = heading.closest('section')
  if (!section) throw new Error('Needs attention is not a section')
  return within(section)
}

export const VATReturnDue: Story = {
  parameters: pageParameters('/', {}, attentionHandlers(allClosed)),
  play: async (context) => {
    const list = await card(context)
    const vat = await list.findByRole('link', { name: new RegExp(vatRow) })
    await expect(vat).toHaveAttribute('href', '/books/vat-return/')
    await expect(vat).toHaveTextContent(/Due in \d+ days/)
    await expect(list.queryByText(/ready to close/)).toBeNull()
  },
}

export const OneMonthToClose: Story = {
  parameters: pageParameters('/', {}, [
    notRegistered,
    ...attentionHandlers(closedMonths(last, previous)),
  ]),
  play: async (context) => {
    const list = await card(context)
    const closing = await list.findByRole('link', {
      name: `${monthLabel(oldest)} is ready to close Close the month`,
    })
    await expect(closing).toHaveAttribute('href', '/books/')
    await expect(list.queryByText(/VAT return/)).toBeNull()
  },
}

export const MonthsToClose: Story = {
  parameters: pageParameters('/', {}, [notRegistered, ...attentionHandlers()]),
  play: async (context) => {
    const list = await card(context)
    await list.findByText(
      `${monthLabel(oldest)}, ${monthLabel(previous)} and ${monthLabel(last)} are ready to close`,
    )
    await expect(list.getByText('Close the months')).toBeVisible()
  },
}

/** Most important first: the VAT return, then the months to close, then the open invoices. */
export const EverythingPending: Story = {
  parameters: pageParameters('/', {}, attentionHandlers()),
  play: async (context) => {
    const list = await card(context)
    await list.findByText(vatRow)
    const links = list.getAllByRole('link').map((link) => link.getAttribute('href'))
    await expect(links.slice(0, 3)).toEqual([
      '/invoices/?status=open&status=refund_due&kind=invoice',
      '/books/vat-return/',
      '/books/',
    ])
    await expect(links.slice(3).every((href) => href?.startsWith('/invoices'))).toBe(true)
    await expect(links.length).toBeGreaterThan(3)
  },
}

export const OverdueInstalments: Story = {
  parameters: pageParameters('/', {}, [
    notRegistered,
    ...attentionHandlers(allClosed),
    http.get('/api/v1/invoices', () => {
      const invoice: InvoiceListItem = {
        ...scheduledInvoice,
        is_overdue: true,
        amount_due: '581.00',
        open_instalments: [
          { seq: 1, due_date: '2025-11-01', open: '65.00', is_overdue: true },
          { seq: 2, due_date: '2025-12-01', open: '100.00', is_overdue: true },
          { seq: 3, due_date: today(), open: '416.00', is_overdue: false },
        ],
      }
      return HttpResponse.json({ data: [invoice] })
    }),
  ]),
  play: async (context) => {
    const list = await card(context)
    const first = await list.findByRole('link', { name: /Instalment 1/ })
    const second = list.getByRole('link', { name: /Instalment 2/ })
    await expect(first).toHaveTextContent(dueLabel('2025-11-01').toLowerCase())
    await expect(second).toHaveTextContent(dueLabel('2025-12-01').toLowerCase())
    await expect(within(first).getByText('65.00')).toBeVisible()
    await expect(within(second).getByText('100.00')).toBeVisible()
    await expect(list.queryByText('581.00')).not.toBeInTheDocument()
    await expect(list.queryByRole('link', { name: /Instalment 3/ })).not.toBeInTheDocument()
  },
}

export const NothingPending: Story = {
  parameters: pageParameters('/', {}, [
    notRegistered,
    noOpenInvoices,
    ...attentionHandlers(allClosed),
  ]),
  play: async (context) => {
    const list = await card(context)
    await list.findByText(ALL_DONE)
    await expect(list.queryAllByRole('listitem')).toHaveLength(0)
  },
}

/** The VAT return can't be checked: that source says so, the others still show. */
export const OneSourceFails: Story = {
  parameters: pageParameters('/', {}, [
    http.get('/api/v1/vat-return/settings', unavailable),
    ...attentionHandlers(),
  ]),
  play: async (context) => {
    const list = await card(context)
    await expect(await list.findByRole('alert')).toHaveTextContent(
      'The VAT return couldn’t be checked: The service is temporarily unavailable.',
    )
    await expect(list.getByRole('button', { name: 'Retry VAT return' })).toBeVisible()
    await list.findByText(/are ready to close/)
    await expect(list.getAllByRole('listitem').length).toBeGreaterThan(1)
    await expect(list.queryByText(ALL_DONE)).toBeNull()
  },
}

/** A member who reads invoices but not the books sees only the invoices. */
export const WithoutBooksPermission: Story = {
  parameters: pageParameters('/', {}, [
    sessionHandler({ role: 'member', scopes: ['read:invoices', 'read:expenses'] }),
    ...attentionHandlers(),
  ]),
  play: async (context) => {
    const list = await card(context)
    await waitFor(() => expect(list.getAllByRole('listitem').length).toBeGreaterThan(0))
    await expect(list.queryByText(/VAT return|ready to close/)).toBeNull()
    await expect(list.queryByRole('alert')).toBeNull()
  },
}
