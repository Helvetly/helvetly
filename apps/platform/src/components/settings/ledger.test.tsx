import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'

import { ledgerExportUrl } from '@/lib/ledger'
import { queryKeys } from '@/lib/queries'
import { handlers } from '@/mocks/handlers'

import { LedgerPage, rangeOf } from './ledger'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<() => void>() }),
  usePathname: () => '/settings/ledger',
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const requests: string[] = []
const server = setupServer(...handlers)
server.events.on('request:start', ({ request }) => {
  const url = new URL(request.url)
  if (url.pathname === '/api/v1/ledger')
    requests.push(`${url.searchParams.get('from')}..${url.searchParams.get('to')}`)
})
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

function wrap(role: string, timezone?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
