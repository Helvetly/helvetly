import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { LedgerPage } from '@/components/settings/ledger'
import type { LedgerAccounts, LedgerBalance, LedgerReport } from '@/lib/ledger'

const session = (role: string) => ({
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role,
  // a member here views the books but has no edit right on them
  scopes: role === 'member' ? ['read:*'] : ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
})

const bal = (account: string, name: string, debit: string, credit: string, closing: string) =>
  ({ account, name, currency: 'CHF', opening: '0.00', debit, credit, closing }) as LedgerBalance

const balances = [
  bal('1000', 'Kasse', '1081.00', '0.00', '1081.00'),
  bal('1100', 'Forderungen aus Lieferungen und Leistungen', '1081.00', '1081.00', '0.00'),
  { ...bal('1020', 'Bank EUR', '200.00', '0.00', '200.00'), currency: 'EUR' },
  bal('3200', 'Handelswarenertrag', '0.00', '1000.00', '-1000.00'),
]

const accounts: LedgerAccounts = {
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

const handlers = (role: string, report: Partial<LedgerReport> = {}, fail = false) => [
  http.get('/api/v1/session', () => HttpResponse.json(session(role))),
  http.get('/api/v1/ledger', () =>
    fail
      ? HttpResponse.json(
          { error: { code: 'boom', message: 'The ledger is unavailable.' } },
          { status: 500 },
        )
      : HttpResponse.json({
          data: {
            from: '2026-01-01',
            to: '2026-12-31',
            currency: 'CHF',
            balances,
            unposted: [],
            ...report,
          },
        }),
  ),
  http.get('/api/v1/ledger/accounts/:code', ({ params }) =>
    HttpResponse.json({
      data: {
        account: params.code,
        name: 'Forderungen aus Lieferungen und Leistungen',
        currency: 'CHF',
        opening: '0.00',
        closing: '1081.00',
        lines: [
          {
            date: '2026-03-01',
            ref: 'RE-2026-0001',
            description: 'Invoice',
            contra: '3200',
            debit: '1081.00',
            credit: '0.00',
            balance: '1081.00',
          },
        ],
      },
    }),
  ),
  http.get('/api/v1/ledger/settings', () => HttpResponse.json({ data: accounts })),
  http.put('/api/v1/ledger/settings', () =>
    HttpResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the fields.',
          details: { fields: { revenue: 'Use 3 to 10 digits.' } },
        },
      },
      { status: 422 },
    ),
  ),
]

const page = (
  <TooltipProvider>
    <SidebarProvider>
      <SidebarInset>
        <LedgerPage />
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>
)

const meta = {
  title: 'Books/Ledger',
  parameters: { layout: 'fullscreen', ownMain: true },
  render: () => page,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = (el: HTMLElement) => within(el.ownerDocument.body)

export const Loaded: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(await c.findByText('Kasse')).toBeVisible()
    await expect(c.getByText('EUR')).toBeVisible()
    await userEvent.click(c.getByText('1100'))
    const drawer = body(canvasElement)
    await drawer.findByText('RE-2026-0001')
    // the drawer fades in
    await waitFor(() => expect(drawer.getByText('RE-2026-0001')).toBeVisible())
    await expect(drawer.getByText('Closing balance')).toBeVisible()
  },
}

export const Empty: Story = {
  parameters: { msw: { handlers: handlers('owner', { balances: [] }) } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(await c.findByText('Nothing in the ledger for this period')).toBeVisible()
    await expect(c.getByRole('button', { name: /Export/ })).toBeDisabled()
  },
}

export const Unposted: Story = {
  parameters: {
    msw: {
      handlers: handlers('owner', {
        unposted: [
          { ref: 'SB-1', reason: 'self_billed' },
          { ref: 'EX-7', reason: 'no_category' },
        ],
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(await c.findByText('2 documents are not in the ledger')).toBeVisible()
    await expect(c.getByText('SB-1: self-billed invoice')).toBeVisible()
    await expect(c.getByText('EX-7: expense without a category')).toBeVisible()
  },
}

export const Member: Story = {
  parameters: { msw: { handlers: handlers('member') } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(await c.findByRole('button', { name: 'Accounts' }))
    const drawer = body(canvasElement)
    await expect(await drawer.findByLabelText('Revenue')).toBeDisabled()
    await waitFor(() =>
      expect(drawer.getByText('View only: ask an owner or admin for edit access.')).toBeVisible(),
    )
  },
}

export const SaveInvalid: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(await c.findByRole('button', { name: 'Accounts' }))
    const drawer = body(canvasElement)
    const revenue = await drawer.findByLabelText('Revenue')
    await userEvent.clear(revenue)
    await userEvent.type(revenue, 'x')
    await userEvent.click(drawer.getByRole('button', { name: 'Save' }))
    await drawer.findByText('Use 3 to 10 digits.')
    await waitFor(() => expect(drawer.getByText('Use 3 to 10 digits.')).toBeVisible())
  },
}

export const Error: Story = {
  parameters: { msw: { handlers: handlers('owner', {}, true) } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('The ledger is unavailable.')).toBeVisible()
  },
}

/** At phone width the table scrolls inside its card, not the page. */
export const Mobile: Story = {
  parameters: { msw: { handlers: handlers('owner') } },
  render: () => (
    <div data-testid="phone" className="w-[390px] overflow-x-auto border border-dashed">
      {page}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const phone = c.getByTestId('phone').getBoundingClientRect()
    const buttons = await Promise.all(
      ['Export', 'Accounts'].map((name) => c.findByRole('button', { name })),
    )
    buttons.forEach((button) =>
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(phone.right),
    )
    const table = (await c.findByRole('region', { name: 'Saldenliste' })).getBoundingClientRect()
    await expect(table.right).toBeLessThanOrEqual(
      c.getByTestId('phone').getBoundingClientRect().right,
    )
  },
}

export const Dark: Story = {
  parameters: { msw: { handlers: handlers('owner') }, dark: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Kasse')).toBeVisible()
  },
}
