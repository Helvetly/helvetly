import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { VATReturnPage } from '@/components/settings/vat-return'
import type { VATReturn, VATReturnLine, VATReturnSettings } from '@/lib/vat-return'

const session = (role: string) => ({
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role,
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
})

const line = (
  ziffer: string,
  label_de: string,
  label_en: string,
  amount: string,
  sources = 0,
  tracked = true,
): VATReturnLine => ({
  ziffer,
  label_de,
  label_en,
  kind: 'amount',
  amount,
  base: '0.00',
  rate: '0',
  tax: '0.00',
  sources,
  tracked,
})

/** The first and last day of a quarter such as "2026-Q3". */
const quarter = (period: string) => {
  const year = Number(period.slice(0, 4))
  const q = Number(period.slice(-1)) || 3
  const last = new Date(Date.UTC(year, q * 3, 0)).toISOString().slice(0, 10)
  return { from: `${year}-${String(q * 3 - 2).padStart(2, '0')}-01`, to: last }
}

const report = (period: string): VATReturn => ({
  period,
  ...quarter(period),
  method: 'effective',
  basis: 'agreed',
  currency: 'CHF',
  months: 3,
  closed_months: period.endsWith('Q3') && period.startsWith('2026') ? 1 : 3,
  net_rates: [],
  lines: [
    line(
      '200',
      'Total der vereinbarten Entgelte',
      'Total agreed or received consideration',
      '15000.00',
      12,
    ),
    line(
      '205',
      'Leistungen, für die optiert wird',
      'Supplies opted for taxation',
      '0.00',
      0,
      false,
    ),
    line(
      '220',
      'Von der Steuer befreite Leistungen',
      'Tax-free supplies (e.g. exports)',
      '2500.00',
      2,
    ),
    line('221', 'Leistungen im Ausland', 'Supplies abroad', '0.00', 0),
    line(
      '225',
      'Übertragung im Meldeverfahren',
      'Transfers under the notification procedure',
      '0.00',
      0,
      false,
    ),
    line('230', 'Von der Steuer ausgenommene Leistungen', 'Exempt supplies', '0.00', 0),
    line('235', 'Entgeltsminderungen', 'Reductions of consideration', '0.00', 0, false),
    line('280', 'Diverses', 'Miscellaneous', '0.00', 0, false),
    { ...line('289', 'Total Abzüge', 'Total deductions (220 to 280)', '2500.00'), kind: 'total' },
    {
      ...line('299', 'Steuerbarer Gesamtumsatz', 'Taxable turnover (200 less 289)', '12500.00'),
      kind: 'total',
    },
    {
      ...line(
        '303',
        'Normalsatz 8,1 %',
        'Standard rate 8.1% (supplies from 2024-01-01)',
        '0.00',
        10,
      ),
      kind: 'rate',
      base: '12500.00',
      rate: '8.1',
      tax: '1012.50',
    },
    { ...line('399', 'Total geschuldete Steuer', 'Total tax due', '1012.50'), kind: 'total' },
    line(
      '400',
      'Vorsteuer auf Material- und Dienstleistungsaufwand',
      'Input tax on materials and services',
      '310.00',
      6,
    ),
    line(
      '405',
      'Vorsteuer auf Investitionen',
      'Input tax on investments and other operating costs',
      '0.00',
      0,
    ),
    line('410', 'Einlageentsteuerung', 'De-taxation', '0.00', 0, false),
    { ...line('479', 'Total Vorsteuer', 'Total input tax', '310.00'), kind: 'total' },
    { ...line('500', 'Zu bezahlender Betrag', 'Amount payable', '702.50'), kind: 'total' },
    {
      ...line(
        '510',
        'Guthaben der steuerpflichtigen Person',
        'Credit in favour of the taxable person',
        '0.00',
      ),
      kind: 'total',
    },
    line('900', 'Subventionen', 'Subsidies and other public contributions', '0.00', 0, false),
    line('910', 'Spenden, Dividenden', 'Donations, dividends and compensation', '0.00', 0, false),
  ],
  warnings:
    period === '2026-Q3'
      ? [
          {
            code: 'foreign_currency',
            message: 'Invoices not in CHF carry no CHF exchange rate, so they are left out.',
            refs: ['2026-031'],
          },
        ]
      : [],
})

const saved: { body: VATReturnSettings | null } = { body: null }
const lastSaved = () => saved.body

/** The report with Ziffer 479 (input tax), 500 (payable) and 510 (refund) set. */
const withResult = (input: string, payable: string, refund: string) => (data: VATReturn) => ({
  ...data,
  lines: data.lines.map((entry) =>
    entry.ziffer === '479'
      ? { ...entry, amount: input }
      : entry.ziffer === '500'
        ? { ...entry, amount: payable }
        : entry.ziffer === '510'
          ? { ...entry, amount: refund }
          : entry,
  ),
})

const handlers = (role: string, shape: (data: VATReturn) => VATReturn = (data) => data) => [
  http.get('/api/v1/session', () => HttpResponse.json(session(role))),
  http.get('/api/v1/vat-return/settings', () =>
    HttpResponse.json({
      data: { method: 'effective', period: 'quarterly', basis: 'agreed', net_rates: [] },
    }),
  ),
  http.put<never, VATReturnSettings>('/api/v1/vat-return/settings', async ({ request }) => {
    saved.body = await request.json()
    return HttpResponse.json({ data: saved.body })
  }),
  http.get('/api/v1/vat-return', ({ request }) =>
    HttpResponse.json({
      data: shape(report(new URL(request.url).searchParams.get('period') ?? '2026-Q3')),
    }),
  ),
]

const meta = {
  title: 'Books/VAT return',
  parameters: { layout: 'fullscreen', ownMain: true },
  render: () => (
    <SidebarProvider>
      <SidebarInset>
        <VATReturnPage />
      </SidebarInset>
    </SidebarProvider>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const CURRENT = /^\d{4}-(Q\d|H\d|\d{2})$|^\d{4}$/
const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/** An owner opens a period's figures by Ziffer in the drawer, then sets the net tax rate method. */
export const Owner: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  play: async ({ canvasElement }) => {
    saved.body = null
    const page = within(canvasElement)
    const settle = await page.findByRole('region', { name: 'How you settle VAT' })
    await expect(settle).toHaveTextContent('Effective method · Quarterly · Agreed consideration')
    const current = await page.findByRole('region', { name: CURRENT })
    await expect(current).toHaveTextContent('702.50')
    // Settling comes first, then the return to file now, then the periods.
    await expect(
      settle.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const periods = page.getByRole('list', { name: 'Periods' })
    const rows = within(periods).getAllByRole('button')
    await expect(rows).toHaveLength(8)
    await userEvent.click(rows[1] ?? rows[0] ?? periods)
    const drawer = within(await body(canvasElement).findByRole('dialog', { name: /^VAT return / }))
    const figures = drawer.getByRole('region', { name: /^VAT return / })
    await expect(within(figures).getByText('Total tax due')).toBeVisible()
    await expect(within(figures).getByText('Reductions of consideration')).not.toBeVisible()
    const deductions = within(within(figures).getByRole('region', { name: 'Deductions' }))
    await expect(deductions.getByText('3')).toBeVisible()
    await userEvent.click(deductions.getByText('Lines to fill in yourself'))
    await expect(within(figures).getByText('Reductions of consideration')).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Export ESTV file (XML)' })).toBeEnabled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull())

    await userEvent.click(within(settle).getByRole('button', { name: 'Edit' }))
    const form = within(
      await body(canvasElement).findByRole('dialog', { name: 'How you settle VAT' }),
    )
    await userEvent.selectOptions(form.getByRole('combobox', { name: 'Method' }), 'net_tax_rate')
    await userEvent.click(form.getByRole('button', { name: 'Add a rate' }))
    await userEvent.type(form.getByRole('textbox', { name: 'Activity 1' }), 'Beratung')
    await userEvent.type(form.getByRole('textbox', { name: 'Rate' }), '6.2')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(lastSaved()?.net_rates).toEqual([{ label: 'Beratung', rate: '6.2' }]),
    )
  },
}

/** A member sees the figures and downloads, not the settings controls. */
export const Member: Story = {
  parameters: { msw: { handlers: handlers('member') } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByText('Only an owner or admin can change these.')).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Edit' })).toBeNull()
    const current = await page.findByRole('region', { name: CURRENT })
    await expect(
      within(current).getByRole('button', { name: 'Export ESTV file (XML)' }),
    ).toBeEnabled()
    await userEvent.click(within(current).getByRole('button', { name: /More exports/ }))
    const menu = body(canvasElement)
    await expect(await menu.findByRole('menuitem', { name: 'PDF summary' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/api\/v1\/vat-return\?period=.+&format=pdf$/),
    )
    await expect(menu.getByRole('menuitem', { name: 'CSV' })).toHaveAttribute(
      'href',
      expect.stringMatching(/&format=csv$/),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menu.queryByRole('menu')).toBeNull())
  },
}

export const OwnerDark: Story = {
  parameters: { msw: { handlers: handlers('owner') }, dark: true },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByRole('region', { name: CURRENT })).toHaveTextContent('702.50')
  },
}

/** The period drawer, open: every Ziffer and the exports. */
export const PeriodDrawer: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const current = await page.findByRole('region', { name: CURRENT })
    await userEvent.click(within(current).getByRole('button', { name: /All figures by Ziffer/ }))
    const drawer = within(await body(canvasElement).findByRole('dialog', { name: /^VAT return / }))
    await expect(await drawer.findByText('Total tax due')).toBeVisible()
  },
}

export const PeriodDrawerDark: Story = {
  ...PeriodDrawer,
  parameters: { ...PeriodDrawer.parameters, dark: true },
}

/** At phone width the settle row, the return to file now and the periods stack; nothing scrolls sideways. */
export const Phone: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  render: () => (
    <div data-testid="phone" className="w-[390px] overflow-x-auto border border-dashed">
      <SidebarProvider>
        <SidebarInset>
          <VATReturnPage />
        </SidebarInset>
      </SidebarProvider>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await page.findByRole('region', { name: CURRENT })
    await waitFor(() => expect(page.getAllByText(/of 3 closed/)).toHaveLength(8))
    const phone = page.getByTestId('phone').getBoundingClientRect()
    const parts = [...canvasElement.querySelectorAll('section, h1')]
    await expect(
      Math.max(...parts.map((part) => part.getBoundingClientRect().right)),
    ).toBeLessThanOrEqual(phone.right)
  },
}

const summaryOf = async (canvasElement: HTMLElement) =>
  within(await within(canvasElement).findByRole('region', { name: CURRENT }))

/** Payable: the amount is the hero on an amber tint; the breakdown and the filing steps follow. */
export const SummaryPayable: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  play: async ({ canvasElement }) => {
    const summary = await summaryOf(canvasElement)
    await expect(await summary.findByText('VAT payable')).toBeVisible()
    await expect(summary.getByText('702.50')).toBeVisible()
    await expect(summary.getByText('− 310.00')).toBeVisible()
    await expect(summary.getByText(/^Due /)).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Export ESTV file (XML)' })).toBeEnabled()
  },
}

/** Refund: green, from Ziffer 510. */
export const SummaryRefund: Story = {
  parameters: { msw: { handlers: handlers('owner', withResult('1500.00', '0.00', '487.50')) } },
  play: async ({ canvasElement }) => {
    const summary = await summaryOf(canvasElement)
    await expect(await summary.findByText('VAT refund')).toBeVisible()
    await expect(summary.getByText('487.50')).toBeVisible()
    await expect(
      summary.getByText('Ziffer 510 · Guthaben der steuerpflichtigen Person'),
    ).toBeVisible()
  },
}

/** Nothing owed: muted, and a "-0.00" from the API reads as 0.00 with no minus anywhere. */
export const SummaryZero: Story = {
  parameters: { msw: { handlers: handlers('owner', withResult('0.00', '-0.00', '0.00')) } },
  play: async ({ canvasElement }) => {
    const summary = await summaryOf(canvasElement)
    await expect(await summary.findByText('Nothing to pay')).toBeVisible()
    await expect(summary.getAllByText('0.00').length).toBeGreaterThan(0)
    await expect(canvasElement.textContent).not.toMatch(/[−-]\s?0\.00/)
  },
}

export const SummaryRefundDark: Story = {
  ...SummaryRefund,
  parameters: { ...SummaryRefund.parameters, dark: true },
}
