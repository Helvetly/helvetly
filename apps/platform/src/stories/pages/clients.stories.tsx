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

/** The status view is a page tab; other filters show as removable chips in the search. */
export const Filtered: Story = {
  parameters: pageParameters('/clients', { status: 'active', type: 'company' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole('button', { name: 'Remove filter Type: Companies' }, { timeout: 8000 }),
    ).toBeVisible()
    const views = body.getByRole('navigation', { name: 'Views' })
    await expect(within(views).getByRole('button', { name: /^Active/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(body.queryByRole('button', { name: 'Remove filter Status: Active' })).toBeNull()
    await expect(body.queryByRole('button', { name: 'Clear all' })).toBeNull()
  },
}

/** All, Active, Drafts and Inactive each show how many clients they hold; a click goes to the URL. */
export const StatusViews: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const views = await body.findByRole('navigation', { name: 'Views' }, { timeout: 8000 })
    await waitFor(() => expect(views).toHaveTextContent('All clientsActive4Drafts1Inactive'))
    await expect(within(views).getByRole('button', { name: /^All clients/ })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await userEvent.click(within(views).getByRole('button', { name: /^Drafts/ }))
    const url = new URL(canvasElement.ownerDocument.location.href)
    await expect(url.searchParams.getAll('status')).toEqual(['draft'])
  },
}

/** The Drafts view lists only clients still missing address details, its counts unchanged. */
export const DraftsView: Story = {
  parameters: pageParameters('/clients', { status: 'draft' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const views = await body.findByRole('navigation', { name: 'Views' }, { timeout: 8000 })
    await expect(within(views).getByRole('button', { name: /^Drafts/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await waitFor(() => expect(body.getAllByText('Frei Logistik GmbH')[0]).toBeVisible())
    await expect(body.queryAllByText('Keller Holzbau AG')).toHaveLength(0)
    await waitFor(() => expect(views).toHaveTextContent('All clientsActive4Drafts1Inactive'))
  },
}

/** A status combination no quick view stands for (from a link) shows as chips, none chosen. */
export const StatusOutsideViews: Story = {
  parameters: pageParameters('/clients', { status: 'complete' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole(
        'button',
        { name: 'Remove filter Status: Complete address' },
        { timeout: 8000 },
      ),
    ).toBeVisible()
    const views = body.getByRole('navigation', { name: 'Views' })
    await expect(within(views).queryAllByRole('button', { current: 'page' })).toEqual([])
  },
}

/**
 * The clients list's field terms: the URL's filters show as chips in the search and in the Filters
 * popover alike, and a term picked from the suggestions or a chip's × changes the URL. (The story
 * URL does not re-render the page; data/list-search.stories.tsx plays the whole round trip.)
 */
export const QuerySearch: Story = {
  parameters: pageParameters('/clients', { type: 'person', city: 'bas' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const url = () => new URL(canvasElement.ownerDocument.location.href).searchParams
    const search = await body.findByRole('searchbox', { name: 'Search clients' }, { timeout: 8000 })
    await waitFor(() => expect(body.getAllByText('Sophie Meier')[0]).toBeVisible())
    await expect(body.queryAllByText('Keller Holzbau AG')).toHaveLength(0)
    await expect(body.getByRole('button', { name: 'Remove filter Type: People' })).toBeVisible()
    await expect(body.getByRole('button', { name: 'Remove filter City: bas' })).toBeVisible()

    await userEvent.click(body.getByRole('button', { name: /Filters/ }))
    await expect(await body.findByRole('checkbox', { name: 'People' })).toBeChecked()
    await userEvent.keyboard('{Escape}')

    await userEvent.type(search, 'stat')
    const suggestions = body.getByRole('listbox', { name: 'Search suggestions' })
    await userEvent.keyboard('{Enter}')
    await expect(search).toHaveValue('status:')
    await userEvent.type(search, 'complete')
    await expect(within(suggestions).getByRole('option', { selected: true })).toHaveTextContent(
      'Status:Complete address',
    )
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(url().getAll('status')).toEqual(['complete']))
    await expect(url().get('type')).toBe('person')

    await userEvent.click(body.getByRole('button', { name: 'Remove filter City: bas' }))
    await waitFor(() => expect(url().get('city')).toBeNull())
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

/** Drags a column's handle by `dx` pixels, as a mouse would: moves and up on the document. */
async function drag(handle: HTMLElement, dx: number) {
  handle.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const box = handle.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  fireEvent.mouseDown(handle, { button: 0, clientX: x, clientY: y })
  fireEvent.mouseMove(document, { clientX: x + dx / 2, clientY: y })
  await new Promise(requestAnimationFrame)
  fireEvent.mouseMove(document, { clientX: x + dx, clientY: y })
  fireEvent.mouseUp(document, { clientX: x + dx, clientY: y })
}

/** Runs `step` for each item in turn, each after the one before has finished. */
const inTurn = <T,>(items: readonly T[], step: (item: T) => Promise<void>) =>
  items.reduce<Promise<void>>((done, item) => done.then(() => step(item)), Promise.resolve())

const STORAGE = 'helvetly.table.clients.'
const WIDTHS_KEY = `${STORAGE}columns.v2`

const widthOf = (element: Element) => Math.round(element.getBoundingClientRect().width)
const whole = (badge: HTMLElement) => badge.scrollWidth <= badge.clientWidth
const headers = (table: HTMLTableElement) =>
  [...table.querySelectorAll<HTMLElement>('thead th:not([aria-hidden])')].map((head) => ({
    name: head.getAttribute('aria-label') ?? head.textContent?.trim() ?? '',
    width: widthOf(head),
  }))
const columnsWidth = (table: HTMLTableElement) =>
  headers(table).reduce((sum, head) => sum + head.width, 0)

/**
 * Every column with a handle, Name too, follows the pointer 1:1: +80 then -40 changes only that
 * column and the table's width by the same; the list scrolls sideways once wider than its box.
 * Badge columns stop with their badges whole; the widths are kept per column.
 */
export const ResizeColumns: Story = {
  beforeEach: () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(STORAGE)) localStorage.removeItem(key)
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const name = await body.findByRole('columnheader', { name: 'Name' }, { timeout: 8000 })
    await canvasElement.ownerDocument.fonts.ready
    const table = name.closest('table')
    const scroller = table?.parentElement
    if (!table || !scroller) throw new Error('The list has no table')
    // On first load the columns fill the box exactly.
    await expect(columnsWidth(table)).toBe(scroller.clientWidth)

    const handles = body.getAllByRole('button', { name: /^Resize / })
    await expect(handles.map((handle) => handle.getAttribute('aria-label'))).toContain(
      'Resize Name',
    )
    await inTurn(handles, (handle) => {
      const column = handle.getAttribute('aria-label')?.replace('Resize ', '') ?? ''
      return inTurn([80, -40], async (dx) => {
        const before = headers(table)
        await drag(handle, dx)
        const expected = before.map((head) =>
          head.name === column ? { ...head, width: head.width + dx } : head,
        )
        await waitFor(() => expect(headers(table)).toEqual(expected))
        await expect(columnsWidth(table)).toBe(
          before.reduce((sum, head) => sum + head.width, 0) + dx,
        )
      })
    })
    await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)

    const type = body.getByRole('columnheader', { name: 'Type' })
    await drag(body.getByRole('button', { name: 'Resize Type' }), -1000)
    await waitFor(() => expect(widthOf(type)).toBeLessThan(110))
    const badges = [...table.querySelectorAll<HTMLElement>('tbody [data-slot=badge]')]
    await expect(badges.length).toBeGreaterThan(0)
    await expect(badges.filter((badge) => !whole(badge))).toEqual([])
    // Smaller than its minimum is not possible by keyboard either.
    const least = widthOf(type)
    body.getByRole('button', { name: 'Resize Type' }).focus()
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await expect(widthOf(type)).toBe(least)

    const stored: unknown = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? 'null')
    await expect(stored).toMatchObject({ type: least, name: widthOf(name) })
    // Back to the start: the drags scrolled the list sideways, wherever the last handle sat.
    scroller.scrollLeft = 0
  },
}
export const ResizeColumnsDark = dark(ResizeColumns)

/** Customize moves a column in the list and Reset puts it back; the order is kept per browser. */
export const ReorderColumns: Story = {
  beforeEach: () => localStorage.removeItem(`${STORAGE}order`),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const name = await body.findByRole('columnheader', { name: 'Name' }, { timeout: 8000 })
    const table = name.closest('table')
    if (!table) throw new Error('The list has no table')
    const names = () => headers(table).map((head) => head.name)
    const city = names().indexOf('City')
    await userEvent.click(body.getByRole('button', { name: 'Customize' }))
    await userEvent.click(await body.findByRole('button', { name: 'Move City up' }))
    await waitFor(() => expect(names().indexOf('City')).toBe(city - 1))
    await expect(localStorage.getItem(`${STORAGE}order`)).toContain('city')
    await userEvent.click(body.getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(names().indexOf('City')).toBe(city))
    await expect(localStorage.getItem(`${STORAGE}order`)).toBeNull()
  },
}
