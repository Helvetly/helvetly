import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { EngagementsPage } from '@/components/engagements/engagements-page'
import type { Entry, Period } from '@/lib/engagements'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

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
