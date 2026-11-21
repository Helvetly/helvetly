import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { billingFixture } from '@/components/billing/billing-fixture'
import { ledgerExportUrl } from '@/lib/ledger'
import { queryKeys } from '@/lib/queries'
import { handlers } from '@/mocks/handlers'
import { sampleSettings } from '@/test/invoice-api'

import { groupByClass, LedgerPage, rangeOf, sumAmounts, validateAccounts } from './ledger'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<() => void>() }),
  usePathname: () => '/books/ledger',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const requests: string[] = []
const server = setupServer(
  ...handlers,
  // a VAT-registered business on the plan with the ledger: the books tabs read both
  http.get('/api/v1/billing', () =>
    HttpResponse.json({
      data: billingFixture({ plan: 'business', status: 'active', locked: false }),
    }),
  ),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
)
server.events.on('request:start', ({ request }) => {
  const url = new URL(request.url)
  if (url.pathname === '/api/v1/ledger')
    requests.push(`${url.searchParams.get('from')}..${url.searchParams.get('to')}`)
})
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

function wrap(role: string, timezone?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // the shell loaded the session already; the page only reads it
  client.setQueryDefaults(queryKeys.session, { staleTime: Infinity })
  client.setQueryData(queryKeys.session, { role, workspace: { timezone } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <LedgerPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const row = (account: string) => ({
  account,
  name: account,
  currency: 'CHF',
  opening: '0',
  debit: '0',
  credit: '0',
  closing: '0',
})

test('groupByClass puts balances under their Swiss SME account class, in chart order', () => {
  const groups = groupByClass(['3200', '1100', '1020', '6500'].map(row))
  expect(groups.map((g) => [g.key, g.name, g.rows.map((r) => r.account)])).toEqual([
    ['1', 'Assets', ['1020', '1100']],
    ['3', 'Operating revenue', ['3200']],
    ['6', 'Other operating expenses', ['6500']],
  ])
})

test('groupByClass sorts the rows inside each class and never moves a class', () => {
  const rows = [
    { ...row('1020'), closing: '5.00' },
    { ...row('1100'), closing: '9.00' },
    { ...row('3200'), closing: '1.00' },
  ]
  const groups = groupByClass(rows, { field: 'closing', desc: true })
  expect(groups.map((g) => g.rows.map((r) => r.account))).toEqual([['1100', '1020'], ['3200']])
})

test.each([
  [['0.10', '0.20'], '0.30'],
  [['1081.00', '-1081.00'], '0.00'],
  [['111111.00', '2222.00'], '113333.00'],
  [[], '0.00'],
])('sumAmounts(%j) is %s', (values, sum) => expect(sumAmounts(values)).toBe(sum))

test('validateAccounts flags every code that is not 3 to 10 digits, banks keyed as the API keys them', () => {
  const good = {
    receivables: '1100',
    revenue: '3200',
    output_vat: '2200',
    rounding: '3800',
    payables: '2000',
    member_payable: '2210',
    input_vat_material: '1170',
    input_vat_other: '1171',
    bank: { bank_transfer: '1020', cash: '1000' },
  }
  expect(validateAccounts(good)).toEqual({})
  const bad = validateAccounts({
    ...good,
    revenue: '32',
    rounding: '38a0',
    bank: { ...good.bank, cash: '' },
  })
  expect(Object.keys(bad).toSorted()).toEqual(['bank.cash', 'revenue', 'rounding'])
  expect(bad.revenue).toBe('Enter an account code of 3 to 10 digits.')
  expect(validateAccounts({ ...good, revenue: '12345678901' }).revenue).toBeDefined()
})

test('rangeOf covers a year, a quarter and a month', () => {
  expect(rangeOf(2026, 'year')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  expect(rangeOf(2026, 'Q2')).toEqual({ from: '2026-04-01', to: '2026-06-30' })
  expect(rangeOf(2028, '02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
})

test('the period select changes the request and export links carry the range', async () => {
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  wrap('owner')
  expect(await screen.findByText('Kasse')).toBeVisible()
  expect(requests.at(-1)).toBe('2026-01-01..2026-12-31')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'Q1')
  await screen.findByText('Kasse')
  expect(requests.at(-1)).toBe('2026-01-01..2026-03-31')
  await userEvent.click(screen.getByRole('button', { name: /Export/ }))
  const menu = within(document.body)
  expect(await menu.findByRole('menuitem', { name: 'Banana' })).toHaveAttribute(
    'href',
    ledgerExportUrl('banana', '2026-01-01', '2026-03-31'),
  )
  expect(menu.getByRole('menuitem', { name: 'CSV' })).toHaveAttribute(
    'href',
    ledgerExportUrl('csv', '2026-01-01', '2026-03-31'),
  )
})

test('the year follows the workspace time zone and reaches back ten years', async () => {
  vi.setSystemTime(new Date('2026-12-31T12:00:00Z')) // already 2027 in Auckland
  wrap('owner', 'Pacific/Auckland')
  const years = within(await screen.findByRole('combobox', { name: 'Year' })).getAllByRole('option')
  expect(years.map((o) => o.textContent)).toEqual(
    Array.from({ length: 11 }, (_, i) => String(2027 - i)),
  )
  expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('2027')
  expect(requests.at(-1)).toBe('2027-01-01..2027-12-31')
})
