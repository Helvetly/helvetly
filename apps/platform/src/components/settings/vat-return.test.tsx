import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { queryKeys } from '@/lib/queries'
import type { VATReturn, VATReturnSettings } from '@/lib/vat-return'
import { handlers } from '@/mocks/handlers'

import { dueBy, resultOf, sectionsOf, VATReturnPage } from './vat-return'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<() => void>() }),
  usePathname: () => '/books/vat-return',
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const sampleReturn = (period: string): VATReturn => ({
  period,
  from: '2026-07-01',
  to: '2026-09-30',
  method: 'effective',
  basis: 'agreed',
  currency: 'CHF',
  months: 3,
  closed_months: 1,
  net_rates: [],
  lines: [
    {
      ziffer: '200',
      label_de: 'Total Entgelte',
      label_en: 'Total consideration',
      kind: 'amount',
      amount: '1500.00',
      base: '0.00',
      rate: '0',
      tax: '0.00',
      sources: 2,
      tracked: true,
    },
    {
      ziffer: '235',
      label_de: 'Entgeltsminderungen',
      label_en: 'Reductions',
      kind: 'amount',
      amount: '0.00',
      base: '0.00',
      rate: '0',
      tax: '0.00',
      sources: 0,
      tracked: false,
    },
    {
      ziffer: '303',
      label_de: 'Normalsatz 8,1 %',
      label_en: 'Standard rate 8.1%',
      kind: 'rate',
      amount: '0.00',
      base: '1000.00',
      rate: '8.1',
      tax: '81.00',
      sources: 1,
      tracked: true,
    },
    {
      ziffer: '500',
      label_de: 'Zu bezahlender Betrag',
      label_en: 'Amount payable',
      kind: 'total',
      amount: '40.50',
      base: '0.00',
      rate: '0',
      tax: '0.00',
      sources: 0,
      tracked: true,
    },
  ],
  warnings: [
    { code: 'foreign_currency', message: 'Invoices not in CHF are left out.', refs: ['2026-007'] },
  ],
})

const defaults: VATReturnSettings = {
  method: 'effective',
  period: 'quarterly',
  basis: 'agreed',
  net_rates: [],
}
const saved: { body: VATReturnSettings | null } = { body: null }

const server = setupServer(
  ...handlers,
  http.get('/api/v1/vat-return/settings', () => HttpResponse.json({ data: defaults })),
  http.put<never, VATReturnSettings>('/api/v1/vat-return/settings', async ({ request }) => {
    saved.body = await request.json()
    return HttpResponse.json({ data: saved.body })
  }),
  http.get('/api/v1/vat-return', ({ request }) =>
    HttpResponse.json({
      data: sampleReturn(new URL(request.url).searchParams.get('period') ?? ''),
    }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function wrap(role: string, scopes = role === 'member' ? ['read:*'] : ['*:*']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, {
    role,
    scopes,
    workspace: { id: 'wrk_test', name: 'Test AG', country: 'CH' },
  })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <VATReturnPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('settles first, then the return to file now, then every period with its drawer', async () => {
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  wrap('owner')
  const settle = await screen.findByRole('region', { name: 'How you settle VAT' })
  expect(settle).toHaveTextContent('Effective method · Quarterly · Agreed consideration')
  const current = await screen.findByRole('region', { name: '2026-Q3' })
  expect(current).toHaveTextContent('To file now')
  // 60 days after 30 September.
  expect(current).toHaveTextContent('Due 29 Nov 2026')
  expect(within(current).getByRole('list', { name: 'Warnings' })).toHaveTextContent('2026-007')
  await userEvent.click(within(current).getByRole('button', { name: /More exports/ }))
  expect(screen.getByRole('menuitem', { name: 'PDF summary' }).getAttribute('href')).toBe(
    '/api/v1/vat-return?period=2026-Q3&format=pdf',
  )
  expect(screen.getByRole('menuitem', { name: 'CSV' }).getAttribute('href')).toBe(
    '/api/v1/vat-return?period=2026-Q3&format=csv',
  )
  await userEvent.keyboard('{Escape}')

  const periods = screen.getByRole('list', { name: 'Periods' })
  expect(within(periods).getAllByRole('button')).toHaveLength(8)
  await userEvent.click(within(periods).getByRole('button', { name: /^2026-Q2/ }))
  const drawer = await screen.findByRole('dialog', { name: 'VAT return 2026-Q2' })
  const figures = within(drawer).getByRole('region', { name: 'VAT return 2026-Q2' })
  expect(within(figures).getByText('Standard rate 8.1%')).toBeTruthy()
  expect(within(figures).getByText('1’000.00 at 8.1%')).toBeTruthy()
  expect(within(figures).getByText(/to fill in yourself/)).toBeTruthy()
  expect(within(figures).getByText('1 of 3 months closed')).toBeTruthy()
  expect(within(drawer).getByRole('button', { name: /Export ESTV file/ })).toBeTruthy()
  vi.useRealTimers()
})

test('dueBy is 60 days after the period ends', () => {
  expect(dueBy('2026-09-30')).toBe('2026-11-29')
  expect(dueBy('2026-12-31')).toBe('2027-03-01')
})

test('an owner switches to the net tax rate method with an approved rate in the drawer', async () => {
  saved.body = null
  wrap('owner')
  const settle = await screen.findByRole('region', { name: 'How you settle VAT' })
  await userEvent.click(within(settle).getByRole('button', { name: 'Edit' }))
  const drawer = await screen.findByRole('dialog', { name: 'How you settle VAT' })
  await userEvent.selectOptions(
    within(drawer).getByRole('combobox', { name: 'Method' }),
    'net_tax_rate',
  )
  await userEvent.click(within(drawer).getByRole('button', { name: 'Add a rate' }))
  await userEvent.type(within(drawer).getByRole('textbox', { name: 'Activity 1' }), 'Beratung')
  await userEvent.type(within(drawer).getByRole('textbox', { name: 'Rate' }), '6.2')
  await userEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(saved.body).toEqual({
      method: 'net_tax_rate',
      period: 'quarterly',
      basis: 'agreed',
      net_rates: [{ label: 'Beratung', rate: '6.2' }],
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('a member reads the return but cannot change the settings', async () => {
  wrap('member')
  expect(await screen.findByText('View only: ask an owner or admin for edit access.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
})

test('a member with edit of the VAT return can change the settings', async () => {
  wrap('member', ['read:*', 'write:vat-return'])
  expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  expect(screen.queryByText('View only: ask an owner or admin for edit access.')).toBeNull()
})

async function exportEstvFile() {
  const current = await screen.findByRole('region', { name: '2026-Q3' })
  await userEvent.click(within(current).getByRole('button', { name: /Export ESTV file/ }))
}

test('downloads the ESTV file, or lists why it cannot be exported', async () => {
  const { toast } = await import('sonner')
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:estv')
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()
  const downloads: string[] = []
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download)
  })
  let refuse = true
  server.use(
    http.get('/api/v1/vat-return', ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('format') !== 'xml')
        return HttpResponse.json({
          data: sampleReturn(url.searchParams.get('period') ?? '2026-Q3'),
        })
      if (refuse)
        return HttpResponse.json(
          {
            error: {
              code: 'cannot_export',
              message: 'This return cannot be exported for the ESTV yet.',
              details: { reasons: [{ code: 'uid_missing', message: 'Add your Swiss UID.' }] },
            },
          },
          { status: 409 },
        )
      return new HttpResponse('<VATDeclaration/>', {
        headers: {
          'Content-Type': 'application/xml',
          'Content-Disposition': 'attachment; filename="MWST_CHE109322551_2026-Q3.xml"',
        },
      })
    }),
  )
  wrap('owner')
  expect(await screen.findByText(/MWST-Abrechnung pro → Import/)).toBeTruthy()

  await exportEstvFile()
  const refused = await screen.findByRole('dialog', { name: 'Can’t export the ESTV file yet' })
  expect(within(refused).getByRole('listitem')).toHaveTextContent('Add your Swiss UID.')
  expect(within(refused).getByRole('link', { name: /VAT settings/ })).toHaveAttribute(
    'href',
    '/settings/company?focus=seller.vat_number#vat',
  )
  expect(toast.error).not.toHaveBeenCalled()
  expect(clicked).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  refuse = false
  await exportEstvFile()
  await waitFor(() => expect(clicked).toHaveBeenCalledOnce())
  expect(created).toHaveBeenCalledOnce()
  expect(downloads).toEqual(['MWST_CHE109322551_2026-Q3.xml'])
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test("groups the lines in the form's sections, keeping a line without a Ziffer in place", () => {
  const lines = sampleReturn('2026-Q3').lines
  const [first] = lines
  if (!first) throw new Error('no lines')
  const extra = { ...first, ziffer: '', label_en: 'Note' }
  const sections = sectionsOf([...lines.slice(0, 2), extra, ...lines.slice(2)])
  expect(sections.map((s) => [s.title, s.lines.map((l) => l.ziffer || l.label_en)])).toEqual([
    ['Turnover', ['200']],
    ['Deductions', ['235', 'Note']],
    ['Tax due', ['303']],
    ['Payable or refund', ['500']],
  ])
})

test('the return to file now shows what is payable', async () => {
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  wrap('owner')
  const summary = await screen.findByRole('region', { name: '2026-Q3' })
  await waitFor(() => expect(summary.textContent).toContain('VAT payable'))
  expect(summary.textContent).toContain('40.50')
  vi.useRealTimers()
})

test('the result is a refund, a payable amount or nothing, never a negative zero', () => {
  const report = sampleReturn('2026-Q3')
  const [first] = report.lines
  if (!first) throw new Error('no lines')
  const set = (payable: string, refund: string) => ({
    ...report,
    lines: report.lines
      .filter((line) => line.ziffer !== '500' && line.ziffer !== '510')
      .concat(
        { ...first, ziffer: '500', amount: payable },
        { ...first, ziffer: '510', amount: refund },
      ),
  })
  expect(resultOf(set('40.50', '0.00'))).toEqual({
    state: 'payable',
    amount: '40.50',
    ziffer: '500',
  })
  expect(resultOf(set('0.00', '12.00'))).toEqual({
    state: 'refund',
    amount: '12.00',
    ziffer: '510',
  })
  expect(resultOf(set('-0.00', '0.00'))).toEqual({ state: 'zero', amount: '0.00', ziffer: '500' })
})
