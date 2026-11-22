import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { queryKeys } from '@/lib/queries'
import { handlers } from '@/mocks/handlers'

import { AuditLog, eventLook } from './audit-log'
import {
  closedThrough,
  draftsOf,
  endedMonths,
  monthMatches,
  monthsBefore,
  openThrough,
  PeriodsCard,
} from './periods-settings'

vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// A member's scopes come with the session; owners and admins have every scope.
function wrap(role: string, ui: ReactNode, scopes = ['*:*']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, { role, scopes })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('endedMonths', () => {
  it('lists the months before today, newest first, across the year', () => {
    expect(endedMonths('2026-02-14', 3)).toEqual(['2026-01', '2025-12', '2025-11'])
  })
})

describe('openThrough', () => {
  it('takes the open months up to the chosen one, oldest first', () => {
    expect(openThrough(['2026-10', '2026-08', '2026-07'], '2026-08')).toEqual([
      '2026-07',
      '2026-08',
    ])
    expect(openThrough(['2026-10', '2026-08'], '2026-06')).toEqual([])
  })
})

describe('monthMatches', () => {
  it.each([
    ['2026-10', 'oct', true],
    ['2026-10', 'OCTOBER', true],
    ['2026-10', '10', true],
    ['2026-03', '3', true],
    ['2026-03', '03', true],
    ['2026-10', '2026', true],
    ['2026-10', 'oct 2026', true],
    ['2026-10', '  ', true],
    ['2026-10', 'oct 2025', false],
    ['2026-10', 'nov', false],
    ['2026-11', '10', false],
    ['2025-10', '2026', false],
  ])('%s matches %j: %s', (month, query, expected) => {
    expect(monthMatches(month, query)).toBe(expected)
  })
})

describe('closedThrough', () => {
  it.each([
    [['2026-08', '2026-10', '2026-09'], '2026-10'],
    [['2025-12'], '2025-12'],
    [[], null],
  ])('closed %j → %s', (closed, want) => {
    expect(closedThrough(closed)).toBe(want)
  })
})

describe('monthsBefore', () => {
  it('starts a window of months that ends at the given one', () => {
    expect(monthsBefore('2026-11', 36)).toBe('2023-12')
    expect(monthsBefore('2026-01', 2)).toBe('2025-12')
  })
})

const source = (drafts: number) => ({ recorded: 0, drafts, totals: [] })

describe('draftsOf', () => {
  it.each([
    [
      { month: '2026-10', invoices: source(2), expenses: source(1) },
      '2 draft invoices and 1 draft expense',
    ],
    [{ month: '2026-10', invoices: source(1), expenses: source(0) }, '1 draft invoice'],
    [{ month: '2026-10', invoices: null, expenses: source(3) }, '3 draft expenses'],
    [{ month: '2026-10', invoices: source(0), expenses: null }, null],
    [undefined, null],
  ])('%j → %s', (activity, want) => {
    expect(draftsOf(activity)).toBe(want)
  })
})

describe('PeriodsCard', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reopens a month with a reason and closes it again after confirming', async () => {
    let reason: unknown = null
    server.use(
      http.post<{ month: string }, { reason?: unknown }>(
        '/api/v1/periods/:month/reopen',
        async ({ request, params }) => {
          reason = (await request.json()).reason
          return HttpResponse.json({ data: { month: params.month } })
        },
      ),
    )
    wrap('owner', <PeriodsCard />)
    // The mock has October and September 2026 closed.
    const october = await screen.findByRole('listitem', { name: 'October 2026' })
    expect(october).toHaveAttribute('data-state', 'closed')
    await userEvent.click(within(october).getByRole('button', { name: 'Actions for October 2026' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Reopen October 2026/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Reopen October 2026?' })
    const submit = within(dialog).getByRole('button', { name: /Reopen month/ })
    expect(submit).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Late bill')
    await userEvent.click(submit)
    await waitFor(() => expect(reason).toBe('Late bill'))
    expect(toast.success).toHaveBeenCalledWith('October 2026 reopened.')
  })

  it('closes every open month through the latest from the one primary action', async () => {
    const closed: string[] = []
    server.use(
      http.post<never, { month: string }>('/api/v1/periods', async ({ request }) => {
        const { month } = await request.json()
        closed.push(month)
        return HttpResponse.json(
          { data: { month, closed_at: '2026-11-12T10:00:00Z', closed_by: null } },
          { status: 201 },
        )
      }),
    )
    wrap('owner', <PeriodsCard />)
    expect(await screen.findByText('10 months to close')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Close through August/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Close 10 months?' })
    // The mock dates drafts in February, June and October, and in January, June and November.
    const drafts = within(dialog).getByRole('list', { name: 'Drafts in these months' })
    expect(within(drafts).getByText(/June 2026: 2 draft invoices and 1 draft expense/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close months' }))
    await waitFor(() => expect(closed).toHaveLength(10))
    expect(closed[0]).toBe('2025-11')
    expect(closed.at(-1)).toBe('2026-08')
  })

  it('closes through an earlier month picked by search, grouped by year', async () => {
    const closed: string[] = []
    server.use(
      http.post<never, { month: string }>('/api/v1/periods', async ({ request }) => {
        const { month } = await request.json()
        closed.push(month)
        return HttpResponse.json(
          { data: { month, closed_at: '2026-11-12T10:00:00Z', closed_by: null } },
          { status: 201 },
        )
      }),
    )
    wrap('owner', <PeriodsCard />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Close through an earlier month' }),
    )
    const picker = await screen.findByRole('dialog')
    const headings = () =>
      [...picker.querySelectorAll('[cmdk-group]:not([hidden]) [cmdk-group-heading]')].map(
        (heading) => heading.textContent,
      )
    expect(within(picker).getAllByText('Close every open month through')).not.toHaveLength(0)
    expect(headings()).toEqual(['2026', '2025'])
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toContain('August 202610 months')
    const search = within(picker).getByPlaceholderText('Search months…')
    await userEvent.type(search, 'zzz')
    expect(within(picker).getByText('No open month matches.')).toBeTruthy()
    await userEvent.clear(search)
    await userEvent.type(search, '2025')
    expect(headings()).toEqual(['2025'])
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['December 20252 months', 'November 20251 month'])
    await userEvent.keyboard('{ArrowDown}{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Close November 2025?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close month' }))
    await waitFor(() => expect(closed).toEqual(['2025-11']))
  })

  it("shows a month's activity and its drafts", async () => {
    wrap('owner', <PeriodsCard />)
    const june = await screen.findByRole('listitem', { name: 'June 2026' })
    await waitFor(() =>
      expect(within(june).getByLabelText('Invoices issued')).toHaveTextContent('8 issued'),
    )
    expect(
      within(june).getByRole('button', {
        name: '2 draft invoices and 1 draft expense dated in June 2026',
      }),
    ).toBeTruthy()
    expect(within(june).getByLabelText('Expenses booked')).toHaveTextContent('CHF 990.40')
  })

  it('shows a refused close readably', async () => {
    server.use(
      http.post('/api/v1/periods', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Only an owner or admin can do this.' } },
          { status: 403 },
        ),
      ),
    )
    wrap('admin', <PeriodsCard />)
    const august = await screen.findByRole('listitem', { name: 'August 2026' })
    await userEvent.click(within(august).getByRole('button', { name: 'Actions for August 2026' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close August 2026' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Close month' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Only an owner or admin can do this.'),
    )
  })

  it('lets a member with view of period closing read but not change', async () => {
    wrap('member', <PeriodsCard />, ['read:*'])
    expect(
      await screen.findByText('View only: ask an owner or admin for edit access.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull()
  })

  it('lets a member with edit of period closing close a month', async () => {
    wrap('member', <PeriodsCard />, ['read:*', 'write:periods'])
    const august = await screen.findByRole('listitem', { name: 'August 2026' })
    expect(within(august).getByRole('button', { name: 'Actions for August 2026' })).toBeTruthy()
    expect(screen.queryByText('View only: ask an owner or admin for edit access.')).toBeNull()
  })
})

const event = (seq: number) => ({
  seq,
  kind: 'invoice.issued',
  category: 'invoices',
  subject_type: 'invoice',
  subject_id: `inv_${seq}`,
  subject: { number: `2026-00${seq}`, party: 'Acme AG', currency: 'CHF' },
  actor: null,
  at: '2026-10-01T09:00:00Z',
  payload: { payable_total: '99.00' },
  prev_hash: '',
  hash: '',
})

describe('AuditLog', () => {
  it('shows the verified chain and pages through the events, newest first', async () => {
    const orders: (string | null)[] = []
    server.use(
      http.get('/api/v1/audit-log', ({ request }) => {
        const query = new URL(request.url).searchParams
        orders.push(query.get('order'))
        return HttpResponse.json(
          query.get('cursor')
            ? { data: [event(1)], meta: { next_cursor: null } }
            : { data: [event(2)], meta: { next_cursor: '2' } },
        )
      }),
    )
    wrap('owner', <AuditLog />)
    expect(await screen.findByText(/^Chain verified · \d+ entries intact$/)).toBeTruthy()
    const second = await screen.findByRole('button', {
      name: 'Details of: Invoice 2026-002 issued to Acme AG',
    })
    const row = second.closest('li')
    expect(row?.textContent).toContain('CHF 99.00')
    expect(row?.textContent).toContain('System')
    expect(row?.textContent).not.toContain('inv_2')
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(
      await screen.findByRole('button', { name: 'Details of: Invoice 2026-001 issued to Acme AG' }),
    ).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull())
    expect(orders.every((order) => order === 'newest')).toBe(true)
  })

  it('sends the chosen type and search to the API', async () => {
    const queries: string[] = []
    server.use(
      http.get('/api/v1/audit-log', ({ request }) => {
        queries.push(new URL(request.url).search)
        return HttpResponse.json({ data: [event(1)], meta: { next_cursor: null } })
      }),
    )
    wrap('owner', <AuditLog />)
    await userEvent.click(await screen.findByRole('button', { name: 'Type' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Expenses' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the audit log' }), 'acme')
    await waitFor(() =>
      expect(queries.at(-1)).toMatch(/category=expenses.*q=acme|q=acme.*category=expenses/),
    )
  })

  it('flags a broken chain', async () => {
    server.use(
      http.get('/api/v1/audit-log/verify', () =>
        HttpResponse.json({ data: { ok: false, broken_at: 7, entries: 9 } }),
      ),
    )
    wrap('admin', <AuditLog />)
    expect(await screen.findByText(/Chain broken at entry #7/)).toBeTruthy()
  })

  it('opens to a member with view of the audit log', async () => {
    wrap('member', <AuditLog />, ['read:audit-log'])
    expect(await screen.findByText(/^Chain verified/)).toBeTruthy()
  })
})

describe('eventLook', () => {
  it.each([
    ['invoice.issued', 'invoices', 'blue'],
    ['payment.added', 'payments', 'green'],
    ['expense.booked', 'expenses', 'amber'],
    ['invoice.voided', 'invoices', 'red'],
    ['payment.deleted', 'payments', 'red'],
    ['plan.cancelled', 'invoices', 'red'],
    ['approval.rejected', 'approvals', 'red'],
    ['period.closed', 'books', 'neutral'],
  ] as const)('tints %s %s', (kind, category, tone) => {
    expect(eventLook({ kind, category }).tone).toBe(tone)
  })
})
