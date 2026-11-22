import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { ClientsPage } from '@/components/clients/clients-page'

import { ringClipper } from '../focus-ring'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'
import { dropOpensImport, emptyList, emptyOffersImport, noDropTarget, readOnly } from './page-drop'

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

/** A new workspace: next to its first action the empty list offers Import, and a drop anywhere works too. */
export const Empty: Story = {
  parameters: emptyList('/clients', '/api/v1/clients'),
  play: emptyOffersImport('No clients yet'),
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** Files dropped anywhere on the page open its import with them chosen. */
export const DropStartsImport: Story = {
  parameters: emptyList('/clients', '/api/v1/clients'),
  play: dropOpensImport(
    'No clients yet',
    'Drop to read these files into new clients',
    'clients',
    new File(['name,email\nKeller,info@keller.ch'], 'clients.csv', { type: 'text/csv' }),
  ),
}

/** Whoever may only read has no drop target and no hint. */
export const ReadOnlyNoDrop: Story = {
  parameters: readOnly('/clients'),
  play: noDropTarget('Keller Holzbau AG', 'clients'),
}

/** One click on a client's name opens the client: no card in between. */
export const NameOpensClient: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: /^Alpenglow Studio/ }, { timeout: 8000 }),
    )
    // The drawer follows ?id= (Storybook's search params do not follow the History API).
    await waitFor(() =>
      expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get('id')).toBe(
        'cli_1',
      ),
    )
    await expect(body.queryByRole('dialog')).toBeNull()
    await expect(body.queryByRole('button', { name: 'Open' })).toBeNull()
  },
}

/** Drags a column's handle by `dx` pixels, as a mouse would. */
function drag(handle: HTMLElement, dx: number) {
  const box = handle.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  fireEvent.pointerDown(handle, { button: 0, clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: x + dx, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(window, { clientX: x + dx, clientY: y, pointerId: 1 })
}

const WIDTHS_KEY = 'helvetly.table.clients.columns'

const widthOf = (element: Element) => Math.round(element.getBoundingClientRect().width)
const whole = (badge: HTMLElement) => badge.scrollWidth <= badge.clientWidth

/**
 * Name gives way when another column widens, the row stays full, badge columns stop with their
 * badges whole, and the widths are kept per column in this browser.
 */
export const ResizeColumns: Story = {
  beforeEach: () => localStorage.removeItem(WIDTHS_KEY),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const name = await body.findByRole('columnheader', { name: 'Name' }, { timeout: 8000 })
    await canvasElement.ownerDocument.fonts.ready
    const table = name.closest('table')
    const scroller = table?.parentElement
    const before = widthOf(name)

    await drag(body.getByRole('slider', { name: 'Resize City' }), 60)
    await waitFor(() => expect(widthOf(name)).toBe(before - 60))
    await expect(scroller?.scrollWidth).toBe(scroller?.clientWidth)

    const type = body.getByRole('columnheader', { name: 'Type' })
    await drag(body.getByRole('slider', { name: 'Resize Type' }), -1000)
    await waitFor(() => expect(widthOf(type)).toBeLessThan(110))
    const badges = [...(table?.querySelectorAll<HTMLElement>('tbody [data-slot=badge]') ?? [])]
    await expect(badges.length).toBeGreaterThan(0)
    await expect(badges.filter((badge) => !whole(badge))).toEqual([])
    // Smaller than its minimum is not possible by keyboard either.
    const handle = body.getByRole('slider', { name: 'Resize Type' })
    const least = widthOf(type)
    handle.focus()
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await waitFor(() => expect(handle).toHaveValue(String(least)))
    await expect(widthOf(type)).toBe(least)

    // Name stops where its avatar and "Changes pending" still fit.
    await drag(body.getByRole('slider', { name: 'Resize City' }), 1000)
    await waitFor(() => expect(widthOf(name)).toBeLessThan(before - 60))
    await expect(badges.filter((badge) => !whole(badge))).toEqual([])
    await expect(scroller?.scrollWidth).toBe(scroller?.clientWidth)

    const stored: unknown = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? 'null')
    await expect(stored).toEqual({ city: expect.any(Number), type: least })
  },
}
export const ResizeColumnsDark = dark(ResizeColumns)
