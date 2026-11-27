import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

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
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
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
    await expect(list.getByRole('region', { name: 'To do' })).toHaveTextContent('1')
    await expect(closing).toHaveAttribute('href', '/books/')
    await expect(list.queryByText(/VAT return/)).toBeNull()
  },
}

export const MonthsToClose: Story = {
  parameters: pageParameters('/', {}, [notRegistered, ...attentionHandlers()]),
  play: async (context) => {
    const list = await card(context)
    // One row per month, oldest first, each its own to-do.
    await list.findByText(`${monthLabel(oldest)} is ready to close`)
    const rows = within(list.getByRole('region', { name: 'To do' }))
      .getAllByRole('link')
      .map((link) => link.textContent)
    await expect(rows).toEqual(
      [oldest, previous, last].map((m) => `${monthLabel(m)} is ready to closeClose the month`),
    )
  },
}

/** A dashboard card's section by its title. */
const section = (title: string) =>
  within(document.body).getByRole('heading', { name: title, level: 2 }).closest('section')

/**
 * Most important first, in groups with a count: the to-dos (VAT return, then months to close), then
 * the invoices. The card keeps its row's height and shows each group's first rows; "View all 4"
 * opens every row in a drawer.
 */
export const EverythingPending: Story = {
  parameters: pageParameters('/', {}, attentionHandlers()),
  play: async (context) => {
    const list = await card(context)
    await list.findByText(vatRow)
    const tasks = within(list.getByRole('region', { name: 'To do' }))
    const links = tasks.getAllByRole('link').map((link) => link.getAttribute('href'))
    await expect(links.length).toBeLessThanOrEqual(3)
    await expect(links[0]).toBe('/books/vat-return/')
    const [first, ...money] = list.getAllByRole('region')
    await expect(first).toHaveAccessibleName('To do')
    await expect(money.length).toBeGreaterThan(0)
    const hrefs = money.flatMap((group) =>
      within(group)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href') ?? ''),
    )
    await expect(hrefs.every((href) => href.startsWith('/invoices'))).toBe(true)

    // The card is as tall as the charts in its row, whatever it lists.
    await expect(section('Needs attention')?.getBoundingClientRect().height).toBe(
      section('Cash flow')?.getBoundingClientRect().height,
    )

    await userEvent.click(tasks.getByRole('button', { name: 'View all 4' }))
    const drawer = within(
      await within(document.body).findByRole('dialog', { name: 'Needs attention' }),
    )
    await expect(
      within(drawer.getByRole('region', { name: 'To do' })).getAllByRole('link'),
    ).toHaveLength(4)
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog', { name: 'Needs attention' })).toBeNull(),
    )
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
    const group = within(await list.findByRole('region', { name: 'Instalments' }))
    await expect(
      group.getByRole('heading', { name: 'Instalments' }).parentElement,
    ).toHaveTextContent(/2.*CHF\s*165\.00/)
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
    await list.findAllByText(/is ready to close/)
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
