import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientDetail } from '@/components/clients/client-detail'
import type { ChangeRequest, Client } from '@/lib/clients'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const other = sampleClient({ id: 'cli_2', number: 2, name: 'Bergblick AG' })
const command = fn()
const close = fn()

const handlers = (client: Client, request: ChangeRequest | null = null) => [
  sessionHandler(),
  http.get('/api/v1/imports', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: client })),
  // The template drawer's client picker lists the active clients next to the one it starts with.
  http.get('/api/v1/clients', () =>
    HttpResponse.json({
      data: [client, other],
      meta: { page: 1, page_size: 8, total: 2, total_pages: 1 },
    }),
  ),
  http.get('/api/v1/clients/cli_1/change-request', () => HttpResponse.json({ data: request })),
  http.get('/api/v1/clients/cli_1/self-billing-agreements', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: false, email: true, passkey: true, dev_codes: false }),
  ),
]

const full = sampleClient({
  phone: '+41441234567',
  website: 'https://alpenglow.ch',
  preferred_name: 'Lena Brunner',
})
const person = sampleClient({
  name: 'John Muster',
  is_company: false,
  preferred_name: null,
  email: null,
  phone: null,
  website: null,
  is_active: false,
})
const request: ChangeRequest = {
  id: 'r1',
  fields: { name: 'Alpenglow Studio AG' },
  current: { name: 'Alpenglow Studio GmbH' },
  contact: { id: 'c1', name: 'Lena Brunner' },
  created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
}

const meta = {
  title: 'Clients/Header',
  parameters: { layout: 'fullscreen', msw: { handlers: handlers(full) } },
  render: () => <ClientDetail id="cli_1" canDelete onClose={close} onCommand={command} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = within(document.body)
/** The drawer's sticky header, found from the client's name. */
const header = async (name = 'Alpenglow Studio GmbH') => {
  // The sheet's sr-only title has the same name; the visible one sits in the header.
  const headings = await body.findAllByRole('heading', { name })
  const element = headings.map((heading) => heading.closest('header')).find(Boolean)
  if (!element) throw new Error('The client name is not in the header')
  await waitFor(() => expect(element).toBeVisible()) // after the sheet's fade-in
  return within(element)
}

export const Company: Story = {
  play: async () => {
    const top = await header()
    await expect(top.getByRole('heading', { name: 'Alpenglow Studio GmbH' })).toBeVisible()
    await expect(top.getByText('Company · contact Lena Brunner')).toBeVisible()
    // Active is the normal state, so it carries no badge.
    await expect(top.queryByText('Active')).toBeNull()
    await expect(top.getByRole('link', { name: 'hello@alpenglow.ch' })).toHaveAttribute(
      'href',
      'mailto:hello@alpenglow.ch',
    )
    await expect(top.getByRole('link', { name: '+41 44 123 45 67' })).toHaveAttribute(
      'href',
      'tel:+41441234567',
    )
    await expect(top.getByRole('link', { name: 'Zürich, Switzerland' })).toHaveAttribute(
      'target',
      '_blank',
    )
    await expect(top.getByRole('link', { name: 'alpenglow.ch' })).toHaveAttribute(
      'href',
      'https://alpenglow.ch',
    )
    await expect(top.getByRole('link', { name: 'New invoice' })).toHaveAttribute(
      'href',
      expect.stringContaining('cli_1'),
    )
  },
}

export const Toolbar: Story = {
  play: async () => {
    command.mockClear()
    close.mockClear()
    const top = await header()
    // Edit lives in the "…" menu, next to Document and the primary New invoice.
    await expect(top.queryByRole('button', { name: 'Edit' })).toBeNull()
    await userEvent.click(top.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Edit details' }))
    await expect(command).toHaveBeenLastCalledWith('edit', expect.objectContaining({ id: 'cli_1' }))

    await userEvent.hover(await top.findByRole('button', { name: 'More actions' }))
    await expect(await body.findByRole('tooltip', { name: 'More actions' })).toBeInTheDocument()
    await userEvent.click(await top.findByRole('button', { name: 'More actions' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Deactivate' }))
    await expect(command).toHaveBeenLastCalledWith('toggle', expect.anything())

    await userEvent.click(await top.findByRole('button', { name: 'More actions' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }))
    await expect(command).toHaveBeenLastCalledWith('delete', expect.anything())

    await userEvent.click(await top.findByRole('button', { name: 'Prepare document' }))
    const drawer = within(await body.findByRole('dialog', { name: 'New document from a template' }))
    // The client's dropdown starts selected when the wizard is opened from their record.
    const client = drawer.getByRole('button', { name: /^Client / })
    await expect(client).toHaveTextContent('Alpenglow Studio GmbH')
    await expect(body.queryByPlaceholderText('Search clients')).toBeNull()
    await userEvent.click(client)
    await expect(await body.findByRole('option', { name: /^Bergblick AG/ })).toBeVisible()
    await expect(body.getByRole('option', { name: /^Alpenglow Studio GmbH/ })).toHaveAttribute(
      'data-current',
      'true',
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(drawer.getByRole('button', { name: /^Template / }))
    await expect(
      await body.findByText('No templates yet. Make one in Documents → Templates.'),
    ).toBeVisible()
  },
}

/** No email, phone or website: those facts and links are left out; an inactive client says so. */
export const SparsePerson: Story = {
  parameters: { msw: { handlers: handlers(person) } },
  play: async () => {
    const top = await header('John Muster')
    await expect(top.getByText('Person')).toBeVisible()
    await expect(top.getByText('Inactive')).toBeVisible()
    await expect(top.getByText('Missing email')).toBeVisible()
    await expect(top.queryByText('Email')).toBeNull()
    await expect(top.queryByText('Website')).toBeNull()
    await expect(top.getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'New invoice',
      'Zürich, Switzerland',
    ])
  },
}

/** A client without its address: the chip says what invoicing lacks, not "Draft". */
export const MissingAddress: Story = {
  parameters: {
    msw: {
      handlers: handlers(
        sampleClient({
          street: null,
          zip: null,
          is_draft: true,
          missing_fields: ['street', 'zip'],
        }),
      ),
    },
  },
  play: async () => {
    const top = await header('Alpenglow Studio GmbH')
    await expect(top.getByText('Missing address')).toBeVisible()
    await expect(top.queryByText('Missing email')).toBeNull()
    await expect(top.queryByText('Draft')).toBeNull()
  },
}

/** The pending change is one notice under the tabs, on every tab, with its review action. */
export const PendingChange: Story = {
  parameters: { msw: { handlers: handlers(full, request) } },
  play: async () => {
    const notice = await body.findByRole('region', { name: 'Change request' })
    await expect(notice).toHaveTextContent('Lena Brunner asked to change 1 field')
    await userEvent.click(body.getByRole('tab', { name: /People/ }))
    // The tab change re-renders the notice; wait for its content again.
    await waitFor(() => expect(body.getByRole('region', { name: 'Change request' })).toBeVisible())
    await userEvent.click(within(notice).getByRole('button', { name: 'Review' }))
    const drawer = await body.findByRole('dialog', {
      name: 'Profile change requested by the client',
    })
    await waitFor(() => expect(drawer).toBeVisible())
  },
}

export const PendingChangeDark: Story = {
  ...PendingChange,
  parameters: { ...PendingChange.parameters, dark: true },
}

export const Phone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async () => {
    const top = await header()
    await expect(top.getByRole('link', { name: 'New invoice' })).toBeVisible()
    // Every toolbar control stays on the screen; Document keeps its name for readers.
    await expect(top.getByRole('button', { name: 'More actions' })).toBeVisible()
    await expect(top.getByRole('button', { name: 'Prepare document' })).toBeVisible()
    await expect(top.getByRole('button', { name: 'More ways to add invoices' })).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

/** New invoice is a split button: its menu imports invoices for this client, in a drawer over this one. */
export const ImportInvoices: Story = {
  play: async () => {
    const top = await header()
    await expect(top.getByRole('link', { name: 'New invoice' })).toHaveAttribute(
      'href',
      expect.stringContaining('cli_1'),
    )
    await userEvent.click(top.getByRole('button', { name: 'More ways to add invoices' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Import invoices' }))
    const drawer = await body.findByRole('dialog', {
      name: 'Import invoices for Alpenglow Studio GmbH',
    })
    await waitFor(() => expect(drawer).toBeVisible())
    await expect(
      within(drawer).getByText(/every invoice read is assigned to this client/),
    ).toBeVisible()
  },
}
