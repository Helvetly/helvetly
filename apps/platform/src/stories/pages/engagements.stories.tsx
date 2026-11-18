import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { EngagementsPage } from '@/components/engagements/engagements-page'
import type { Entry, Period } from '@/lib/engagements'

import { sessionHandler } from '../screen-fixtures'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'
import { dropOpensImport, emptyList, emptyOffersImport, noDropTarget, readOnly } from './page-drop'

const meta = {
  title: 'Pages/Engagements',
  beforeEach: closeHeidi,
  parameters: pageParameters('/engagements'),
  render: () => (
    <Frame>
      <EngagementsPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Bookkeeping support') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

export const Detail: Story = {
  parameters: pageParameters('/engagements', { id: 'eng_1' }),
  play: shows('Brand guidelines'),
}
export const DetailDark = dark(Detail)
export const DetailPhone = phone(Detail)

const middle = (rect: DOMRect) => rect.top + rect.height / 2

/** The header's tabs: one height, centred in the bar like its buttons, and no "+" to save a view. */
export const HeaderTabs: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    const views = body.getByRole('navigation', { name: 'Views' })
    const tabs = within(views).getAllByRole('button')
    const active = within(views).getByRole('button', { current: 'page' })
    const button = body.getByRole('button', { name: /New engagement/ }).getBoundingClientRect()
    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect()
      expect(rect.height).toBe(active.getBoundingClientRect().height)
      expect(Math.abs(middle(rect) - middle(button))).toBeLessThanOrEqual(1)
    }
    expect(body.queryByRole('button', { name: 'Save a view' })).not.toBeInTheDocument()
  },
}
export const HeaderTabsDark = dark(HeaderTabs)

const anna = { id: 'usr_story', name: 'Anna Muster' }
const period = (change: Partial<Period>): Period => ({
  id: 'epr_1',
  index: 2,
  starts_on: '2026-11-01',
  ends_on: '2026-11-30',
  natural_ends_on: '2026-11-30',
  quantity: '10',
  full_quantity: '10',
  unearned: '0',
  carried_in: '0',
  available: '10',
  unit_price: '120.00',
  overage_unit_price: '120.00',
  used: '6.5',
  remaining: '3.5',
  overage: '0',
  expected: '3.652',
  state: 'open',
  advance_invoice: null,
  invoiced_quantity: '0',
  uninvoiced_quantity: '6.5',
  invoices: [],
  ...change,
})
const history: Period[] = [
  period({}),
  period({
    id: 'epr_0',
    index: 1,
    starts_on: '2026-10-01',
    ends_on: '2026-10-31',
    natural_ends_on: '2026-10-31',
    used: '11',
    remaining: '0',
    overage: '1',
    expected: '10',
    state: 'closed',
    invoiced_quantity: '11',
    uninvoiced_quantity: '0',
    invoices: [{ id: 'inv_1', number: '2026-014', status: 'paid', kind: 'usage' }],
  }),
]
const entry = (id: string, periodId: string, date: string, quantity: string, note: string | null) =>
  ({
    id,
    period_id: periodId,
    date,
    quantity,
    note,
    performed_by: anna,
    invoice:
      periodId === 'epr_0'
        ? { id: 'inv_1', number: '2026-014', status: 'paid', kind: 'usage' }
        : null,
    created_at: `${date}T16:00:00Z`,
    created_by: anna,
  }) satisfies Entry
const log: Entry[] = [
  entry('ent_5', 'epr_1', '2026-11-07', '1', 'Call with Lena about the launch'),
  entry('ent_4', 'epr_1', '2026-11-05', '3', 'Brand guidelines, typography and colour pages'),
  entry('ent_3', 'epr_1', '2026-11-03', '2.5', null),
  entry('ent_2', 'epr_0', '2026-10-21', '6', 'Homepage layout'),
  entry('ent_1', 'epr_0', '2026-10-08', '5', 'Kick-off workshop'),
]
const drawer = (entries: Entry[]) =>
  pageParameters('/engagements', { id: 'eng_1' }, [
    http.get('/api/v1/engagements/:id/periods', () => HttpResponse.json({ data: history })),
    http.get('/api/v1/engagements/:id/entries', () => HttpResponse.json({ data: entries })),
  ])

/** The drawer's entries grouped by period with totals, and periods with one next action and a menu. */
export const DetailSections: Story = {
  parameters: drawer(log),
  play: async (context) => {
    await shows('Kick-off workshop')?.(context)
    const body = within(document.body)
    const current = body.getByRole('region', { name: '1.–30. Nov 2026' })
    await expect(current).toHaveTextContent('3 entries · 6.5 h')
    await expect(current).toHaveTextContent('No note')
    await expect(body.getByRole('region', { name: '1.–31. Oct 2026' })).toHaveTextContent(
      '2 entries · 11 h',
    )
    await expect(body.getByRole('link', { name: 'Export CSV' })).toBeVisible()
    await expect(body.getByText('Expected by now').nextElementSibling).toHaveTextContent('3 h')
    await expect(body.getAllByRole('button', { name: 'Invoice usage' })).toHaveLength(1)
    const menus = body.getAllByRole('button', { name: 'Period actions' })
    await expect(menus).toHaveLength(2)
    await userEvent.click(menus[0] ?? document.body)
    await waitFor(() =>
      expect(body.getByRole('menuitem', { name: 'Download report' })).toBeVisible(),
    )
    await expect(body.getByRole('menuitem', { name: 'Send report…' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
  },
}
export const DetailSectionsDark = dark(DetailSections)
export const DetailSectionsPhone = phone(DetailSections)

/** Nothing logged yet: a calm line, no export. */
export const DetailNoEntries: Story = {
  parameters: drawer([]),
  play: async (context) => {
    await shows(/Nothing logged yet\./)?.(context)
    await expect(within(document.body).queryByRole('link', { name: 'Export CSV' })).toBeNull()
  },
}

const visible = (elements: HTMLElement[]) => {
  const found = elements.find((element) => element.checkVisibility())
  if (!found) throw new Error('Nothing visible')
  return found
}
const bar = () => within(document.body).findByRole('toolbar', { name: 'Selected rows' })

/** Ticking rows brings up the shared bulk bar; its icon buttons carry their names, and ✕ clears. */
export const Selection: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(visible(body.getAllByRole('checkbox', { name: 'Select German lessons' })))
    await userEvent.click(
      visible(body.getAllByRole('checkbox', { name: 'Select Bookkeeping support' })),
    )
    const toolbar = await bar()
    await expect(toolbar).toHaveTextContent('Selected: 2')
    await expect(within(toolbar).getByRole('button', { name: 'Export CSV' })).toBeVisible()
    await expect(within(toolbar).getByRole('button', { name: 'Delete' })).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Clear selection' }))
    await waitFor(() => expect(body.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull())
  },
}
export const SelectionDark = dark(Selection)
export const SelectionPhone = phone(Selection)

/** Select all, delete from the bar: one confirmation, then every selected engagement goes. */
export const BulkDelete: Story = {
  parameters: pageParameters('/engagements', {}, [
    http.delete('/api/v1/engagements/:id', () => new HttpResponse(null, { status: 204 })),
  ]),
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('checkbox', { name: 'Select all items on this page' }))
    const toolbar = await bar()
    await expect(toolbar).toHaveTextContent('Selected: 3')
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Delete' }))
    const dialog = await body.findByRole('dialog', { name: 'Delete 3 engagements?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(
        body.getAllByText('3 engagements deleted.').some((node) => node.checkVisibility()),
      ).toBe(true),
    )
    await expect(body.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull()
  },
}

/** A row's "…" menu: the drawer's actions, renew only for a one-off engagement. */
export const RowMenu: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for German lessons' }))
    const menu = await body.findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Open details', 'Edit', 'Renew', 'Cancel engagement', 'Delete'])
    await userEvent.keyboard('{Escape}')
    // The open menu hides the rest of the page from the accessibility tree until it has closed.
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
    await userEvent.click(body.getByRole('button', { name: 'Actions for Bookkeeping support' }))
    await expect(
      within(await body.findByRole('menu')).queryByRole('menuitem', { name: 'Renew' }),
    ).toBeNull()
    await userEvent.click(body.getByRole('menuitem', { name: 'Edit' }))
    await expect(
      await body.findByRole('dialog', { name: /Edit Bookkeeping support/ }),
    ).toBeVisible()
  },
}
export const RowMenuDark = dark(RowMenu)

/** Right-click outside the rows: the page's own actions, like every other list. */
export const PageMenu: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    fireEvent.contextMenu(body.getByRole('columnheader', { name: 'Period' }))
    const menu = await body.findByRole('menu')
    await expect(within(menu).getByText('Engagements')).toBeVisible()
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['New engagement', 'Import', 'Export CSV', 'Select all', 'View', 'Refresh'])
    await userEvent.click(body.getByRole('menuitem', { name: 'Select all' }))
    await expect(await body.findByRole('toolbar', { name: 'Selected rows' })).toBeVisible()
  },
}
export const PageMenuDark = dark(PageMenu)

/** A member who may only read: rows still select and export, but nothing changes them. */
export const ReadOnlyMember: Story = {
  parameters: pageParameters('/engagements', {}, [
    sessionHandler({ role: 'member', scopes: ['read:*'] }),
  ]),
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for German lessons' }))
    const menu = await body.findByRole('menu')
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
    await expect(within(menu).getByRole('menuitem', { name: 'Open details' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
    await userEvent.click(visible(body.getAllByRole('checkbox', { name: 'Select German lessons' })))
    const toolbar = await bar()
    await expect(within(toolbar).getByRole('button', { name: 'Export CSV' })).toBeVisible()
    await expect(within(toolbar).queryByRole('button', { name: 'Delete' })).toBeNull()
  },
}

/** A new workspace: next to its first action the empty list offers Import, and a drop anywhere works too. */
export const Empty: Story = {
  parameters: emptyList('/engagements', '/api/v1/engagements'),
  play: emptyOffersImport('No engagements yet'),
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** Files dropped anywhere on the page open its import with them chosen. */
export const DropStartsImport: Story = {
  parameters: emptyList('/engagements', '/api/v1/engagements'),
  play: dropOpensImport(
    'No engagements yet',
    'Drop to read these files into engagements',
    'engagements',
    new File(['%PDF-1.4'], 'contract.pdf', { type: 'application/pdf' }),
  ),
}

/** Whoever may only read has no drop target and no hint. */
export const ReadOnlyNoDrop: Story = {
  parameters: readOnly('/engagements'),
  play: noDropTarget('Bookkeeping support', 'engagements'),
}
