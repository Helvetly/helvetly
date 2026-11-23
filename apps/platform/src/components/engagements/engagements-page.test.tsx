import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { Page } from '@/lib/clients'
import type * as engagements from '@/lib/engagements'
import type {
  Engagement,
  EngagementQuery,
  EngagementSummary,
  PeriodSummary,
} from '@/lib/engagements'
import type * as queries from '@/lib/queries'

const lib = vi.hoisted(() => ({
  listEngagements: vi.fn<(query: EngagementQuery) => Promise<Page<Engagement>>>(),
  getEngagementSummary: vi.fn<() => Promise<{ data: EngagementSummary }>>(),
  getEngagementSettings: vi.fn<() => Promise<{ digest: boolean }>>(),
  putEngagementSettings: vi.fn<(body: { digest: boolean }) => Promise<{ digest: boolean }>>(),
  deleteEngagement: vi.fn<(id: string) => Promise<void>>(),
  exportUrl: vi.fn<(query: EngagementQuery) => string>(
    (query) => `/api/v1/engagements/export?status=${query.status}&q=${query.q ?? ''}`,
  ),
}))
const session = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof queries>()),
  useSession: () => ({ data: { role: session.role } }),
}))

vi.mock('@/lib/engagements', async (importOriginal) => {
  const original = await importOriginal<typeof engagements>()
  return {
    ...original,
    ...lib,
    // The page's list query, fetching through the mock above.
    engagementListQuery: (query: EngagementQuery) => ({
      ...original.engagementListQuery(query),
      queryFn: () => lib.listEngagements(query),
    }),
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn<(url: string) => void>() }),
  usePathname: () => '/engagements',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('./engagement-detail', () => ({ EngagementDetail: () => null }))
vi.mock('./engagement-form', () => ({
  EngagementForm: ({ open }: { open: boolean }) => (open ? <div>Form open</div> : null),
}))

import { AttentionBadges, ProgressBar } from './engagement-bits'
import { EngagementsCard } from './engagements-card'
import { bulkActions, EngagementsPage } from './engagements-page'

const period = (patch: Partial<PeriodSummary> = {}): PeriodSummary => ({
  id: 'epr_1',
  index: 1,
  starts_on: '2026-11-01',
  ends_on: '2026-11-30',
  quantity: '8',
  natural_ends_on: '2026-11-30',
  full_quantity: '8',
  unearned: '0',
  carried_in: '0',
  available: '8',
  unit_price: '150.00',
  overage_unit_price: '150.00',
  used: '9.5',
  remaining: '0',
  overage: '1.5',
  expected: '8',
  state: 'closed',
  advance_invoice: null,
  invoiced_quantity: '0',
  uninvoiced_quantity: '9.5',
  ...patch,
})

const engagement = (patch: Partial<Engagement> = {}): Engagement => ({
  id: 'eng_1',
  number: 4,
  client: { id: 'cli_1', number: 2, name: 'Muster AG' },
  title: 'Support retainer',
  description: null,
  product_id: null,
  unit: 'hour',
  quantity: '8',
  billing: 'advance',
  rollover: false,
  auto_invoice: false,
  invoice_detail: 'summary',
  price_basis: 'net',
  unit_price: '150.00',
  unit_price_net: '150.00',
  unit_price_gross: '162.15',
  overage_unit_price: null,
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  start_date: '2026-11-01',
  recurrence: 'monthly',
  interval: 1,
  end_date: null,
  reference: null,
  document_id: null,
  status: 'active',
  cancelled_on: null,
  current_period: period(),
  attention: ['overage', 'to_invoice'],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...patch,
})

const page = (data: Engagement[]) => ({
  data,
  meta: { page: 1, page_size: 50, total: data.length, total_pages: 1 },
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <EngagementsPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  session.role = 'owner'
  lib.deleteEngagement.mockReset().mockResolvedValue(undefined)
  lib.getEngagementSettings.mockReset().mockResolvedValue({ digest: false })
  lib.putEngagementSettings.mockReset().mockImplementation(async (body) => body)
  lib.listEngagements.mockReset().mockResolvedValue(page([engagement()]))
  lib.getEngagementSummary.mockReset().mockResolvedValue({
    data: { active: 3, ending_soon: 1, under_pace: 1, overage: 1, to_invoice: 2 },
  })
})

test('renders over-100% bar capped with overage label', () => {
  render(<ProgressBar period={period()} unit="hour" />)
  const bar = screen.getByRole('progressbar', { name: '9.5 of 8 h used, 1.5 h over' })
  expect(bar).toHaveAttribute('max', '8')
  expect(bar).toHaveAttribute('value', '8')
  const overage = document.querySelector<HTMLElement>('[data-part=overage]')
  expect(overage).not.toBeNull()
  // 1.5 over 8 is 18.75 % of the commitment: 0.1875 / 1.1875 of the bar.
  expect(overage?.style.width).toBe('15.79%')
})

test('a huge overrun never takes more than a third of the bar', () => {
  render(<ProgressBar period={period({ used: '80', overage: '72' })} unit="hour" />)
  expect(document.querySelector<HTMLElement>('[data-part=overage]')?.style.width).toBe('33.33%')
})

test('an open period shows the expected-by-now tick', () => {
  render(
    <TooltipProvider>
      <ProgressBar
        period={period({
          quantity: '30',
          available: '30',
          used: '10',
          overage: '0',
          expected: '15',
          state: 'open',
        })}
        unit="hour"
      />
    </TooltipProvider>,
  )
  expect(screen.getByRole('progressbar', { name: '10 of 30 h used' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Expected by now: 15 h' }).style.left).toBe('50%')
})

test('attention renders text only', () => {
  render(<AttentionBadges attention={['under_pace']} />)
  expect(screen.getByText('Behind pace')).toBeInTheDocument()
})

test('lists engagements with client, period and billing', async () => {
  renderPage()
  expect(await screen.findAllByText('Support retainer')).not.toHaveLength(0)
  expect(screen.getAllByText('#4')[0]?.parentElement).toHaveTextContent('Muster AG · #4')
  expect(screen.getByText('1.–30. Nov 2026')).toBeInTheDocument()
  expect(screen.getByText('Advance')).toBeInTheDocument()
  expect(lib.listEngagements).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'scheduled,active,ended,cancelled', page: 1 }),
  )
})

test('title with markup is shown as text', async () => {
  lib.listEngagements.mockResolvedValue(
    page([engagement({ title: '<img src=x onerror=alert(1)>' })]),
  )
  renderPage()
  expect((await screen.findAllByText('<img src=x onerror=alert(1)>')).length).toBeGreaterThan(0)
  expect(document.querySelector('img')).toBeNull()
})

test('filter tab "Needs invoicing" sends attention=to_invoice', async () => {
  renderPage()
  await screen.findAllByText('Support retainer')
  fireEvent.click(screen.getAllByRole('button', { name: 'Needs invoicing' })[0]!)
  await waitFor(() =>
    expect(lib.listEngagements).toHaveBeenLastCalledWith(
      expect.objectContaining({ attention: 'to_invoice', page: 1 }),
    ),
  )
})

test('empty state CTA opens create', async () => {
  lib.listEngagements.mockResolvedValue(page([]))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'New engagement' }))
  expect(await screen.findByText('Form open')).toBeInTheDocument()
})

test('right-clicking the empty page offers the page’s actions', async () => {
  lib.listEngagements.mockResolvedValue(page([]))
  renderPage()
  fireEvent.contextMenu(await screen.findByText('No engagements yet'))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('Engagements')).toBeInTheDocument()
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent?.trim()),
  ).toEqual(['Export CSV', 'New engagement', 'Import', 'View', 'Refresh'])
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'New engagement' }))
  expect(await screen.findByText('Form open')).toBeInTheDocument()
})

const openMenu = async () => {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), { button: 0 })
  return screen.findByRole('menu')
}

test('Export CSV in the menu carries the current filters', async () => {
  renderPage()
  await screen.findAllByText('Support retainer')
  fireEvent.click(screen.getAllByRole('button', { name: 'Needs invoicing' })[0]!)
  await openMenu()
  const link = await screen.findByRole('menuitem', { name: /Export CSV/ })
  expect(link).toHaveAttribute('href', expect.stringContaining('status=scheduled,active,ended'))
})

test('digest toggle saves; it rolls back when saving fails', async () => {
  lib.putEngagementSettings.mockRejectedValue(new Error('no'))
  renderPage()
  await openMenu()
  const item = await screen.findByRole('menuitemcheckbox', { name: /Daily e-mail digest/ })
  await waitFor(() => expect(item).not.toHaveAttribute('data-disabled'))
  fireEvent.click(item)
  await waitFor(() =>
    expect(lib.putEngagementSettings.mock.calls[0]?.[0]).toEqual({ digest: true }),
  )
  await openMenu()
  await waitFor(() =>
    expect(screen.getByRole('menuitemcheckbox', { name: /Daily e-mail digest/ })).toHaveAttribute(
      'aria-checked',
      'false',
    ),
  )
})

test('a plain member has no digest toggle', async () => {
  session.role = 'member'
  renderPage()
  await openMenu()
  await screen.findByRole('menuitem', { name: /Export CSV/ })
  expect(screen.queryByText('Daily e-mail digest')).toBeNull()
  expect(lib.getEngagementSettings).not.toHaveBeenCalled()
})

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <EngagementsCard />
    </QueryClientProvider>,
  )
}

test('dashboard card shows counts and the soonest engagements', async () => {
  renderCard()
  expect(await screen.findByText('Support retainer')).toBeInTheDocument()
  expect(screen.getByText(/ending soon/)).toBeInTheDocument()
  expect(lib.listEngagements).toHaveBeenCalledWith(
    expect.objectContaining({ sort: 'ends', page_size: 3 }),
  )
})

test('dashboard card hides without engagements', async () => {
  lib.listEngagements.mockResolvedValue(page([]))
  lib.getEngagementSummary.mockResolvedValue({
    data: { active: 0, ending_soon: 0, under_pace: 0, overage: 0, to_invoice: 0 },
  })
  renderCard()
  await waitFor(() => expect(lib.getEngagementSummary).toHaveBeenCalled())
  expect(screen.queryByText('Engagements')).toBeNull()
})

test('bulk actions: export for everyone, delete only for managers', () => {
  const run = { exportCsv: vi.fn<() => void>(), remove: vi.fn<() => void>() }
  expect(bulkActions(false, run).map((action) => action.label)).toEqual(['Export CSV'])
  const managed = bulkActions(true, run)
  expect(managed.map((action) => action.label)).toEqual(['Export CSV', 'Delete'])
  expect(managed[1]).toMatchObject({ destructive: true, write: true })
})

const two = () =>
  lib.listEngagements.mockResolvedValue(
    page([engagement(), engagement({ id: 'eng_2', number: 5, title: 'Design sprint' })]),
  )

test('selected rows are deleted together after confirming', async () => {
  two()
  renderPage()
  await screen.findAllByText('Design sprint')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all items on this page' }))
  const bar = await screen.findByRole('toolbar', { name: 'Selected rows' })
  expect(bar).toHaveTextContent('2')
  fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(lib.deleteEngagement).toHaveBeenCalledTimes(2))
  expect(lib.deleteEngagement.mock.calls.map(([id]) => id)).toEqual(['eng_1', 'eng_2'])
  await waitFor(() =>
    expect(screen.queryByRole('toolbar', { name: 'Selected rows' })).not.toBeInTheDocument(),
  )
})

test('a member selects and exports but cannot delete', async () => {
  session.role = 'member'
  two()
  renderPage()
  await screen.findAllByText('Design sprint')
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Design sprint' })[0]!)
  const bar = await screen.findByRole('toolbar', { name: 'Selected rows' })
  expect(within(bar).getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  expect(within(bar).queryByRole('button', { name: 'Delete' })).toBeNull()
})

test('a row ticked right after the list loads stays ticked past the search pause', async () => {
  two()
  renderPage()
  await screen.findAllByText('Design sprint')
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Design sprint' })[0]!)
  expect(await screen.findByRole('toolbar', { name: 'Selected rows' })).toBeInTheDocument()
  // Longer than the 300 ms the search waits before it resets the page and the selection.
  await new Promise((resolve) => setTimeout(resolve, 450))
  expect(screen.getByRole('toolbar', { name: 'Selected rows' })).toBeInTheDocument()
})
