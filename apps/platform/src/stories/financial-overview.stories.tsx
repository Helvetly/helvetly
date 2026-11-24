import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { BillingSettings } from '@/components/billing/billing-settings'
import { ChangePlan } from '@/components/billing/change-plan'
import { Dashboard } from '@/components/dashboard/dashboard'
import type { BillingDetails } from '@/lib/billing'

import {
  emptyDashboard,
  emptySummary,
  screenHandlers,
  sessionHandler,
  unavailable,
} from './screen-fixtures'

const dashboardRequest = fn()
const portalRequest = fn()
let dashboardFailed = true
let invoicesFailed = true
const cashPoint = (income: number, expenses: number) => [{ date: '2026-11-08', income, expenses }]
const meta = {
  title: 'Financial overview/Live states',
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  beforeEach: () => {
    dashboardRequest.mockClear()
    portalRequest.mockClear()
    dashboardFailed = true
    invoicesFailed = true
  },
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/' } },
    msw: { handlers: screenHandlers },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const CashFlowCurrenciesAndPeriods: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/reports/key-figures', ({ request }) => {
          const currency = new URL(request.url).searchParams.get('currency') ?? 'CHF'
          dashboardRequest(currency)
          return HttpResponse.json({
            ...emptyDashboard,
            currency,
            currencies: ['CHF', 'EUR'],
            cash_flow:
              currency === 'EUR'
                ? { '30d': cashPoint(20, 5), '90d': cashPoint(70, 20), '12m': cashPoint(100, 35) }
                : { '30d': cashPoint(50, 20), '90d': cashPoint(90, 40), '12m': cashPoint(200, 50) },
          })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const net = await canvas.findByLabelText('Net cash flow')
    await waitFor(() => expect(net).toHaveTextContent(/CHF\s*150\s*net/))
    await userEvent.click(canvas.getByRole('radio', { name: '30D' }))
    await expect(net).toHaveTextContent(/CHF\s*30\s*net/)
    await userEvent.click(canvas.getByRole('radio', { name: '90D' }))
    await expect(net).toHaveTextContent(/CHF\s*50\s*net/)
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Cash flow currency' }),
      'EUR',
    )
    await waitFor(() => expect(dashboardRequest).toHaveBeenLastCalledWith('EUR'))
    await waitFor(() => expect(net).toHaveTextContent(/EUR\s*50\s*net/))
    await userEvent.click(canvas.getByRole('radio', { name: '12M' }))
    await expect(net).toHaveTextContent(/EUR\s*65\s*net/)
  },
}

// Each period pays a different amount, so the figures show which period the API was asked for.
const PERIOD_FIGURES = {
  this_month: { paid: '1200.00', days: 12, rate: 0.5 },
  this_quarter: { paid: '9800.00', days: 21, rate: 0.75 },
} as const
const summaryRequest = fn()

export const KeyFiguresPeriod: Story = {
  beforeEach: () => {
    summaryRequest.mockClear()
    window.localStorage.removeItem('helvetly.dashboard.period')
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices/summary', ({ request }) => {
          const name = new URL(request.url).searchParams.get('period')
          summaryRequest(name)
          const figures =
            name === 'this_quarter' ? PERIOD_FIGURES.this_quarter : PERIOD_FIGURES.this_month
          return HttpResponse.json({
            data: {
              ...emptySummary,
              period: {
                name,
                from: '2026-10-01',
                to: '2026-11-08',
                paid: { amount: figures.paid, count: 2 },
                paid_previous: { amount: '0.00' },
                avg_days_to_pay: figures.days,
                collection_rate: figures.rate,
              },
            },
          })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // One view: no tabs, no "+" and no visible title; the greeting leads the page.
    await expect(await canvas.findByRole('heading', { name: 'Dashboard' })).toHaveClass('sr-only')
    await expect(canvas.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Save a view' })).not.toBeInTheDocument()

    const figures = canvas.getByRole('region', { name: 'Key figures' })
    await waitFor(() => expect(figures).toHaveTextContent('Paid this month'))
    await expect(figures).toHaveTextContent(/1[’',]?200/)
    // The button names the period and the dates the API resolved for it.
    const trigger = canvas.getByRole('button', { name: /^Period: This month/ })
    await waitFor(() => expect(trigger).toHaveTextContent('1 Oct – 8 Nov 2026'))
    // It sits in the page's header, left of New invoice and as tall as it; not in the content.
    const header = trigger.closest('header')
    const newInvoice = within(header ?? canvasElement).getByRole('button', { name: 'New invoice' })
    await expect(trigger.compareDocumentPosition(newInvoice)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await expect(trigger.offsetHeight).toBe(newInvoice.offsetHeight)

    await userEvent.click(trigger)
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitemradio', { name: 'This month' })).toBeChecked()
    await userEvent.click(body.getByRole('menuitemradio', { name: 'This quarter' }))
    await expect(await canvas.findByRole('button', { name: /^Period: This quarter/ })).toBeVisible()
    await waitFor(() => expect(figures).toHaveTextContent('Paid this quarter'))
    await expect(figures).toHaveTextContent(/9[’',]?800/)
    await expect(figures).toHaveTextContent('75%')
    await expect(summaryRequest).toHaveBeenLastCalledWith('this_quarter')
    await expect(window.localStorage.getItem('helvetly.dashboard.period')).toBe('this_quarter')
  },
}

export const CashFlowFailureAndRetry: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/reports/key-figures', () => {
          dashboardRequest()
          return dashboardFailed ? unavailable() : HttpResponse.json(emptyDashboard)
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Cash flow couldn’t be loaded')
    dashboardFailed = false
    await userEvent.click(canvas.getByRole('button', { name: 'Retry cash flow' }))
    await waitFor(() => expect(canvas.queryByRole('alert')).not.toBeInTheDocument())
    // The alert clears before the refetched figures render ("—" meanwhile).
    await waitFor(() =>
      expect(canvas.getByLabelText('Net cash flow')).toHaveTextContent(/CHF\s*0\s*net/),
    )
    await expect(dashboardRequest).toHaveBeenCalledTimes(2)
  },
}

export const OpenInvoicesFailureAndRetry: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices', () =>
          invoicesFailed
            ? unavailable()
            : HttpResponse.json({
                data: [],
                meta: { page: 1, page_size: 50, total: 0, total_pages: 0 },
              }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Open invoices couldn’t be loaded',
    )
    invoicesFailed = false
    await userEvent.click(canvas.getByRole('button', { name: 'Retry invoices' }))
    await expect(await canvas.findByText('All done. Nothing needs your attention.')).toBeVisible()
  },
}

export const NoFinancialPermission: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:clients'] }),
        http.get('/api/v1/reports/key-figures', () => {
          dashboardRequest()
          return HttpResponse.json(emptyDashboard)
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'Your workspace overview shows the sections you have permission to read.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument()
    await expect(canvas.queryByText('Cash flow')).not.toBeInTheDocument()
    await expect(dashboardRequest).not.toHaveBeenCalled()
  },
}

export const ExpensesPermissionOnly: Story = {
  parameters: {
    msw: {
      handlers: [sessionHandler({ role: 'member', scopes: ['read:expenses'] }), ...screenHandlers],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'Paid expenses only. Invoice payments and refunds are not included in this view.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByText('Needs attention')).not.toBeInTheDocument()
  },
}

const activeBilling = billingFixture({
  plan: 'pro',
  status: 'active',
  interval: 'month',
  locked: false,
  has_customer: true,
  current_period_end: '2026-12-01',
  usage: [
    { limit: 'clients', used: 25, max: 1000 },
    { limit: 'members', used: 2, max: 2 },
    { limit: 'signatures_per_month', used: 4, max: 5 },
    { limit: 'storage_bytes', used: 100000000, max: null },
  ],
  discount: {
    code: 'WELCOME',
    percent_off: 10,
    amount_off: null,
    currency: null,
    duration: 'repeating',
    duration_in_months: 3,
    ends_at: '2027-01-01',
  },
})
const details: BillingDetails = {
  payment_method: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
  invoices: [
    {
      id: 'bill-1',
      number: 'BILL-1',
      date: '2026-11-01',
      total: 4900,
      currency: 'chf',
      status: 'paid',
      url: 'https://billing.example.invalid/invoice',
      pdf: 'https://billing.example.invalid/invoice.pdf',
    },
  ],
}
const billingHandlers = [
  http.get('/api/v1/billing', () => HttpResponse.json({ data: activeBilling })),
  http.get('/api/v1/billing/details', () => HttpResponse.json({ data: details })),
  ...screenHandlers,
]

export const BillingActiveDetails: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/settings/billing' } },
    msw: { handlers: billingHandlers },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Pro', level: 3 })).toBeVisible()
    await expect(await canvas.findByText('Visa •••• 4242')).toBeVisible()
    await expect(canvas.getByText(/−10% for 3 months until 1 Jan 2027/)).toBeVisible()
    await expect(canvas.queryByText('WELCOME')).not.toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Download BILL-1 as PDF' })).toHaveAttribute(
      'href',
      'https://billing.example.invalid/invoice.pdf',
    )
    await expect(canvas.getByRole('link', { name: 'Upgrade to Business' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
  },
}

export const BillingPortalPendingAndRetry: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/billing/portal', async () => {
          portalRequest()
          await delay(400)
          return unavailable()
        }),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const update = await canvas.findByRole('button', { name: 'Update' })
    await userEvent.dblClick(update)
    await expect(update).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Manage billing' })).toBeDisabled()
    await expect(portalRequest).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(update).toBeEnabled())
    await userEvent.click(update)
    await waitFor(() => expect(portalRequest).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(update).toBeEnabled())
  },
}

export const BillingReadOnlyMember: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({ data: { ...activeBilling, can_manage: false } }),
        ),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Pro', level: 3 })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument()
    await expect(canvas.queryByText('Payments', { exact: true })).not.toBeInTheDocument()
  },
}

export const BillingPaymentsError: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/billing/details', unavailable), ...billingHandlers] },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/Invoices couldn’t be loaded/),
    ).toBeVisible()
  },
}

export const BillingNoCardOrInvoices: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing/details', () =>
          HttpResponse.json({ data: { payment_method: null, invoices: [] } }),
        ),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('No card on file')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add card' })).toBeVisible()
    await expect(canvas.getByText('No invoices yet')).toBeVisible()
    await expect(
      canvas.getByText('The first arrives when the trial or the first period ends.'),
    ).toBeVisible()
  },
}

export const BillingDisabled: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({ data: billingFixture({ enabled: false }) }),
        ),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'Subscription billing is currently unavailable. Plan limits are not applied to this workspace.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'See plans' })).not.toBeInTheDocument()
  },
}

export const BillingPastDue: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({ data: { ...activeBilling, status: 'past_due' } }),
        ),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Payment failed', { exact: true })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Update payment method' })).toBeEnabled()
  },
}

export const BillingCancels: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({ data: { ...activeBilling, cancel_at_period_end: true } }),
        ),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Cancels', { exact: true })).toBeVisible()
  },
}

export const BillingTrial: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({
            data: { ...activeBilling, status: 'trialing', trial_end: '2026-11-15' },
          }),
        ),
        ...billingHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Trial', { exact: true })).toBeVisible()
  },
}

export const BillingFailure: Story = {
  parameters: { msw: { handlers: [http.get('/api/v1/billing', unavailable), ...screenHandlers] } },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Billing couldn’t be loaded/)).toBeVisible()
  },
}

export const ChangePlanYearly: Story = {
  parameters: { ownMain: true, msw: { handlers: billingHandlers } },
  render: () => <ChangePlan />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Change your plan' })).toBeVisible()
    await userEvent.click(await canvas.findByRole('radio', { name: /^Yearly/ }))
    await waitFor(() => expect(canvas.getByRole('radio', { name: /^Yearly/ })).toBeChecked())
    // The picker ends with the plan cards: no comparison table, no feature grid, no questions.
    await expect(canvas.queryByRole('heading', { name: 'Compare plans' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole('heading', { name: 'Every plan includes' }),
    ).not.toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { name: 'Questions' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Back to billing' })).toHaveAttribute(
      'href',
      '/settings/billing/',
    )
  },
}

export const ChangePlanFailure: Story = {
  parameters: {
    ownMain: true,
    msw: { handlers: [http.get('/api/v1/billing', unavailable), ...screenHandlers] },
  },
  render: () => <ChangePlan />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Plans couldn’t be loaded/)).toBeVisible()
  },
}

export const BillingLoading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', async () => {
          await delay('infinite')
          return new HttpResponse()
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status', { name: 'Loading billing' })).toBeVisible(),
    )
  },
}

export const ChangePlanLoading: Story = {
  parameters: {
    ownMain: true,
    msw: {
      handlers: [
        http.get('/api/v1/billing', async () => {
          await delay('infinite')
          return new HttpResponse()
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ChangePlan />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status', { name: 'Loading plans' })).toBeVisible(),
    )
  },
}

export const BillingExpiredTrial: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({ data: billingFixture({ trial_available: false }) }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <BillingSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The workspace is on Free, never read-only; no trial left, so no trial offer.
    await expect(await canvas.findByRole('heading', { name: 'Free' })).toBeVisible()
    await expect(canvas.queryByText(/read-only|days free on/i)).toBeNull()
    await expect(canvas.getByRole('link', { name: 'Upgrade to Basic' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
  },
}

export const WorkspaceOverviewLoading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/session', async () => {
          await delay('infinite')
          return new HttpResponse()
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('status', { name: 'Loading workspace overview' }),
      ).toBeVisible(),
    )
  },
}

export const WorkspaceOverviewFailure: Story = {
  parameters: { msw: { handlers: [http.get('/api/v1/session', unavailable), ...screenHandlers] } },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Workspace overview couldn’t be loaded',
    )
    await expect(canvas.getByRole('button', { name: 'Retry workspace overview' })).toBeEnabled()
  },
}

export const BillingActiveDetailsDark: Story = {
  ...BillingActiveDetails,
  parameters: { ...BillingActiveDetails.parameters, dark: true },
}
export const ChangePlanYearlyDark: Story = {
  ...ChangePlanYearly,
  parameters: { ...ChangePlanYearly.parameters, dark: true },
}
export const CashFlowCurrenciesAndPeriodsDark: Story = {
  ...CashFlowCurrenciesAndPeriods,
  parameters: { ...CashFlowCurrenciesAndPeriods.parameters, dark: true },
}
