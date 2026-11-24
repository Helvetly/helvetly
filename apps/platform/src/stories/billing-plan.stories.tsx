import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { BillingSettings } from '@/components/billing/billing-settings'
import { ChangePlan } from '@/components/billing/change-plan'
import type { Billing, BillingDetails } from '@/lib/billing'

import { screenHandlers, unavailable } from './screen-fixtures'

const checkoutRequest = fn()
const portalRequest = fn()
function invoice(id: string, number: string, date: string, total: number, status: string) {
  return { id, number, date, total, currency: 'chf', status, url: `#${id}`, pdf: `#${id}.pdf` }
}
const details: BillingDetails = {
  payment_method: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2028 },
  invoices: [
    invoice('in_3', 'HV-2026-0042', '2026-11-01', 5700, 'open'),
    invoice('in_2', 'HV-2026-0031', '2026-10-01', 5700, 'paid'),
    invoice('in_1', 'HV-2026-0020', '2026-09-01', 3800, 'paid'),
  ],
}
const handlers = (billing: Billing, billingDetails: BillingDetails = details) => [
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  http.get('/api/v1/billing/details', () => HttpResponse.json({ data: billingDetails })),
  http.post('/api/v1/billing/checkout', async ({ request }) => {
    checkoutRequest(await request.json())
    // A live subscription changes in place and answers with Plan & billing itself.
    return HttpResponse.json({ url: `${window.location.origin}/settings/billing` })
  }),
  http.post('/api/v1/billing/portal', () => {
    portalRequest()
    // Stripe's portal is another site: answer with an error so the story stays on the page.
    return unavailable()
  }),
  ...screenHandlers,
]
const subscribed = (over: Partial<Billing>) =>
  billingFixture({
    locked: false,
    trial_available: false,
    interval: 'month',
    pricing: 'per_seat',
    ...over,
  })

const usage: Billing['usage'] = [
  { limit: 'clients', used: 18, max: 50 },
  { limit: 'invoices_per_month', used: 12, max: 30 },
  { limit: 'signatures_per_month', used: 4, max: 5 },
  { limit: 'members', used: 3, max: null },
]
// A trial started on the older Business offer, which keeps its terms: Business for up to two people, its allowances lasting the whole trial.
const trialing = subscribed({
  plan: 'business',
  status: 'trialing',
  trial: true,
  seats: 2,
  // Four and a half days ahead reads as "5 days left" whenever the story runs.
  trial_end: new Date(Date.now() + 4.5 * 86_400_000).toISOString(),
  usage,
})
const paid = (over: Partial<Billing>) =>
  subscribed({
    status: 'active',
    has_customer: true,
    current_period_end: '2026-12-01',
    usage,
    ...over,
  })
const basicMonthly = paid({ plan: 'basic' })
const basicYearly = paid({ plan: 'basic', interval: 'year', current_period_end: '2027-10-01' })
const pro = paid({
  plan: 'pro',
  usage: [
    { limit: 'clients', used: 240, max: 1000 },
    { limit: 'members', used: 4, max: null },
  ],
})
const business = paid({
  plan: 'business',
  usage: [
    { limit: 'clients', used: 2400, max: null },
    { limit: 'storage_bytes', used: 40 * 2 ** 30, max: 1024 * 2 ** 30 },
  ],
})
const pastDue = paid({ plan: 'pro', status: 'past_due' })

const meta = {
  title: 'Financial overview/Plan card',
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
    checkoutRequest.mockClear()
    portalRequest.mockClear()
  },
  render: () => <BillingSettings />,
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/settings/billing' } },
    msw: { handlers: handlers(trialing) },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: {
    options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
  },
}
const mobile = { globals: { viewport: { value: 'phone' } } }

/** The hero's price block and its "what comes next" panel. */
const price = (canvas: HTMLElement) => canvas.querySelector('[data-slot=plan-price]')
const nextStep = (canvas: HTMLElement) => canvas.querySelector('[data-slot=plan-next]')
const card = (canvas: ReturnType<typeof within>, name: string) =>
  within(canvas.getByRole('article', { name }))
/** The plans page loads its billing first. */
const plansLoaded = (canvas: ReturnType<typeof within>) =>
  canvas.findByRole('article', { name: 'Basic' })
const plansPage = (billing: Billing) => ({
  render: () => <ChangePlan />,
  parameters: {
    ownMain: true,
    nextjs: { navigation: { pathname: '/settings/billing/plans' } },
    msw: { handlers: handlers(billing) },
  },
})
const changePlanLink = (canvas: ReturnType<typeof within>, name = 'Change plan') =>
  expect(canvas.getByRole('link', { name })).toHaveAttribute('href', '/settings/billing/plans/')

export const Trial: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByRole('heading', { name: 'Business' })).toBeVisible()
    await expect(summary.getByText('Trial', { exact: true })).toBeVisible()
    await expect(summary.getByText(/^Trial ends on \d+ \w+ \d{4}$/)).toBeVisible()
    await expect(summary.getByText('Day 10 of 14')).toBeVisible()
    // The total with how it adds up (Business includes five people), then what is charged after the trial.
    await expect(price(canvasElement)).toHaveTextContent(
      /CHF 149 for 5 people\s*CHF 149\s*\/ month/,
    )
    await expect(nextStep(canvasElement)).toHaveTextContent('Then CHF 149 is charged.')
    // The plans are a page of their own: no tiles here, one way there.
    await expect(canvas.queryByRole('article', { name: 'Pro' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('radio', { name: /^Yearly/ })).not.toBeInTheDocument()
    // A trial on Business: nothing above it, so one way to the plans page.
    await changePlanLink(summary)

    // The trial's allowances last the whole trial, not a month.
    const usagePanel = within(canvas.getByRole('region', { name: 'Usage' }))
    await expect(usagePanel.getAllByText('For the whole trial').length).toBeGreaterThan(0)
    await expect(usagePanel.queryByText(/This month since/)).toBeNull()
    // Signature requests are at 4 of 5 (80 %): orange, with a note.
    const signatures = canvas
      .getByText('Signature requests', { exact: true })
      .closest('[data-slot=usage-meter]')
    await expect(signatures).toHaveAttribute('data-state', 'near')
    await expect(within(signatures as HTMLElement).getByText('Almost at limit')).toBeVisible()
    // No member cap on a per-seat plan: the meter has no limit to reach.
    const members = canvas.getByText('Members').closest('[data-slot=usage-meter]')
    await expect(members).toHaveAttribute('data-state', 'ok')
    await expect(members).toHaveTextContent('3 · Unlimited')
  },
}

export const TrialDark: Story = { ...Trial, parameters: { dark: true } }

export const TrialMobile: Story = { ...Trial, parameters: phone, ...mobile }

export const ActiveMonthly: Story = {
  parameters: { msw: { handlers: handlers(basicMonthly) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByText('Renews on 1 Dec 2026')).toBeVisible()
    await expect(summary.getByText('Active', { exact: true })).toBeVisible()
    // Basic includes one person; the other two add CHF 10 each.
    await expect(price(canvasElement)).toHaveTextContent(
      /CHF 19 for 1 person \+ 2 people at CHF 10 each\s*CHF 39\s*\/ month/,
    )
    await expect(nextStep(canvasElement)).toHaveTextContent('Next charge CHF 39.')
    await changePlanLink(summary, 'Upgrade to Pro')
    const payment = within(canvas.getByRole('region', { name: 'Payment method' }))
    // One row: brand and last four digits, the expiry under them, Update on the right.
    await expect(await payment.findByText('Visa •••• 4242')).toBeVisible()
    await expect(payment.getByText('Expires 04/28')).toBeVisible()
    // Above the usage, right under the plan.
    const sections = [...canvasElement.querySelectorAll('[data-slot=settings-section]')].map(
      (section) => section.id,
    )
    await expect(sections.indexOf('payment-method')).toBe(sections.indexOf('usage') - 1)
    // Helvetly's invoices: date, number, amount, status and the PDF.
    const invoices = within(canvas.getByRole('region', { name: 'Invoices' }))
    await expect(await invoices.findByText('1 Nov 2026')).toBeVisible()
    await expect(invoices.getAllByRole('link', { name: 'HV-2026-0042' })[0]).toHaveAttribute(
      'href',
      '#in_3',
    )
    await expect(invoices.getByText('Open')).toBeVisible()
    await expect(invoices.getAllByText('Paid')).toHaveLength(2)
    await expect(
      invoices.getByRole('link', { name: 'Download HV-2026-0042 as PDF' }),
    ).toHaveAttribute('href', '#in_3.pdf')
    await userEvent.click(payment.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(portalRequest).toHaveBeenCalledTimes(1))
    // The portal buttons stay disabled until the first request has answered.
    const manage = summary.getByRole('button', { name: 'Manage billing' })
    await waitFor(() => expect(manage).toBeEnabled())
    await userEvent.click(manage)
    await waitFor(() => expect(portalRequest).toHaveBeenCalledTimes(2))
  },
}

export const ActiveMonthlyDark: Story = {
  ...ActiveMonthly,
  parameters: { ...ActiveMonthly.parameters, dark: true },
}

export const ActiveMonthlyMobile: Story = {
  ...ActiveMonthly,
  parameters: { ...ActiveMonthly.parameters, ...phone },
  ...mobile,
}

export const Cancelling: Story = {
  parameters: { msw: { handlers: handlers(paid({ plan: 'pro', cancel_at_period_end: true })) } },
  play: async ({ canvasElement }) => {
    const summary = within(await within(canvasElement).findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByText('Cancels', { exact: true })).toBeVisible()
    // Nothing more is charged: the plan ends with the period.
    await expect(summary.getByText('Ends on 1 Dec 2026')).toBeVisible()
    await expect(nextStep(canvasElement)).toHaveTextContent('Nothing more is charged.')
    // No upgrade nudge on a plan that is ending: the plans page stays one click away.
    await expect(summary.queryByRole('link', { name: /^Upgrade/ })).not.toBeInTheDocument()
    await changePlanLink(summary)
  },
}

export const WithDiscount: Story = {
  parameters: {
    msw: {
      handlers: handlers(
        paid({
          plan: 'basic',
          discount: {
            code: 'WELCOME20',
            percent_off: 20,
            amount_off: null,
            currency: null,
            duration: 'repeating',
            duration_in_months: 3,
            ends_at: '2027-02-01',
          },
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const summary = within(await within(canvasElement).findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByText(/−20% for 3 months until 1 Feb 2027/)).toBeVisible()
    // The promotion code itself is never shown.
    await expect(summary.queryByText(/WELCOME20/)).not.toBeInTheDocument()
    // The total stays the list price; the next charge has the discount taken off.
    await expect(price(canvasElement)).toHaveTextContent(/CHF 39\s*\/ month/)
    await expect(nextStep(canvasElement)).toHaveTextContent('Next charge CHF 31.20.')
  },
}

/** A 100 %-forever code in the trial: the panel says the plan stays free, not "CHF 0 is charged". */
export const TrialFreeForever: Story = {
  parameters: {
    msw: {
      handlers: handlers({
        ...trialing,
        discount: {
          code: 'LIFETIME-135F29',
          percent_off: 100,
          amount_off: null,
          currency: null,
          duration: 'forever',
          duration_in_months: null,
          ends_at: null,
        },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('region', { name: 'Plan' })
    await expect(nextStep(canvasElement)).toHaveTextContent('Then free forever.')
    await expect(nextStep(canvasElement)).not.toHaveTextContent('LIFETIME-135F29')
  },
}

export const NoCardNoInvoices: Story = {
  parameters: {
    msw: { handlers: handlers(basicMonthly, { payment_method: null, invoices: [] }) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const payment = within(await canvas.findByRole('region', { name: 'Payment method' }))
    await expect(await payment.findByText('No card on file')).toBeVisible()
    await expect(payment.getByText('Add one so the subscription keeps running.')).toBeVisible()
    await userEvent.click(payment.getByRole('button', { name: 'Add card' }))
    await waitFor(() => expect(portalRequest).toHaveBeenCalledTimes(1))
    const invoices = within(canvas.getByRole('region', { name: 'Invoices' }))
    await expect(await invoices.findByText('No invoices yet')).toBeVisible()
    await expect(invoices.queryByRole('table')).not.toBeInTheDocument()
  },
}

export const NoCardNoInvoicesMobile: Story = {
  ...NoCardNoInvoices,
  parameters: { ...NoCardNoInvoices.parameters, ...phone },
  ...mobile,
}

export const BusinessTopPlan: Story = {
  parameters: { msw: { handlers: handlers(business) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByText('Renews on 1 Dec 2026')).toBeVisible()
    await expect(summary.getByRole('heading', { name: 'Business', level: 3 })).toBeVisible()
    await changePlanLink(summary)
  },
}

export const PastDue: Story = {
  parameters: { msw: { handlers: handlers(pastDue) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Past due', { exact: true })).toBeVisible()
    const notice = within(canvas.getByRole('region', { name: 'Payment failed' }))
    // No plan changes while a payment fails: plans can be compared, not changed.
    await changePlanLink(canvas, 'Compare plans')
    await expect(canvas.queryByRole('link', { name: 'Change plan' })).not.toBeInTheDocument()
    await userEvent.click(notice.getByRole('button', { name: 'Update payment method' }))
    await waitFor(() => expect(portalRequest).toHaveBeenCalledTimes(1))
  },
}

export const PastDueDark: Story = {
  ...PastDue,
  parameters: { ...PastDue.parameters, dark: true },
}

export const PastDueMobile: Story = {
  ...PastDue,
  parameters: { ...PastDue.parameters, ...phone },
  ...mobile,
}

export const BillingOff: Story = {
  parameters: { msw: { handlers: handlers({ ...basicMonthly, enabled: false }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/Subscription billing is currently unavailable/),
    ).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Change plan' })).not.toBeInTheDocument()
  },
}

export const NoPermission: Story = {
  parameters: { msw: { handlers: handlers({ ...pro, can_manage: false }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Pro', level: 3 })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('region', { name: 'Payment method' })).not.toBeInTheDocument()
    await expect(
      canvas.getByText('Only an owner or admin can change the workspace’s plan.'),
    ).toBeVisible()
    await changePlanLink(canvas, 'Compare plans')
  },
}

/** Free: its name and that it is free for good, Pro's trial offered, its usage against Free's limits, the way up. */
export const FreePlan: Story = {
  parameters: {
    msw: {
      handlers: handlers(
        billingFixture({
          usage: [
            { limit: 'clients', used: 4, max: 5 },
            { limit: 'invoices_per_month', used: 1, max: 3 },
          ],
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByRole('heading', { name: 'Free' })).toBeVisible()
    await expect(summary.getByText('Free forever for one person · no card needed')).toBeVisible()
    await expect(canvas.queryByText(/read-only/i)).not.toBeInTheDocument()
    await expect(summary.getByRole('region', { name: '14 days free on Pro' })).toHaveTextContent(
      'Try Pro free for 14 days with up to 2 people. Until you choose a plan, the workspace stays on Free.',
    )
    // Free's limits are measured like any plan's.
    const clients = within(canvas.getByRole('region', { name: 'Usage' }))
      .getByText('Clients', { exact: true })
      .closest('[data-slot=usage-meter]')
    await expect(clients).toHaveTextContent('4 of 5')
    await changePlanLink(summary, 'Upgrade to Basic')
  },
}

export const FreePlanMobile: Story = {
  ...FreePlan,
  parameters: { ...FreePlan.parameters, ...phone },
  ...mobile,
}

export const PlansTrialSwitch: Story = {
  ...plansPage(trialing),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await expect(await canvas.findByRole('heading', { name: 'Change your plan' })).toBeVisible()
    // Where the workspace stands, in the overview's words.
    await expect(canvasElement.querySelector('[data-slot=current-plan-pill]')).toHaveTextContent(
      /You’re on Business\s*·\s*5 days left in the trial/,
    )
    await expect(canvas.getByRole('link', { name: 'Back to billing' })).toHaveAttribute(
      'href',
      '/settings/billing/',
    )
    // A subscription keeps its own interval; Yearly still shows its discount, the saving only once chosen.
    await expect(canvas.getByRole('radio', { name: 'Monthly' })).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'Yearly' })).toHaveAccessibleDescription('−20%')
    await expect(canvas.getByText('Save CHF 45 a year on Basic')).not.toBeVisible()
    const proCard = card(canvas, 'Pro')
    await expect(canvas.getByRole('article', { name: 'Pro' })).toHaveTextContent(
      '2 people incl. · +CHF 15 / person',
    )
    await expect(
      canvas.getByRole('article', { name: 'Pro' }).querySelector('[data-slot=team-total]'),
    ).toHaveTextContent('For 2 peopleCHF 49 / month')
    // Its key limits in one line, and what it adds over Basic, nothing it lacks.
    await expect(proCard.getByLabelText('Key limits')).toHaveTextContent('300 clients')
    await expect(proCard.getByText('Heidi AI assistant')).toBeVisible()
    await expect(proCard.queryByText(/client portal/)).toBeNull()
    await expect(proCard.getByText('Your trial ends now and Pro is charged today.')).toBeVisible()
    const businessCard = card(canvas, 'Business')
    await expect(businessCard.getByText('Current')).toBeVisible()
    await expect(businessCard.getByRole('button', { name: 'Current plan' })).toBeDisabled()

    await userEvent.click(proCard.getByRole('button', { name: 'Switch to Pro' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    // The dialog fades in.
    await waitFor(() =>
      expect(
        dialog.getByText(
          'Your trial ends now and Pro is charged today: CHF 49 a month for 2 people, incl. VAT.',
        ),
      ).toBeVisible(),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Switch plan' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({
        plan: 'pro',
        interval: 'month',
        language: 'en',
      }),
    )
  },
}

export const PlansTrialSwitchDark: Story = {
  ...PlansTrialSwitch,
  parameters: { ...PlansTrialSwitch.parameters, dark: true },
}

export const PlansTrialSwitchMobile: Story = {
  ...PlansTrialSwitch,
  parameters: { ...PlansTrialSwitch.parameters, ...phone },
  ...mobile,
}

/** A downgrade waits for the paid period's end: the hero says so, and the picker can keep the current plan. */
const downgrading = paid({
  plan: 'business',
  pending_plan: 'pro',
  pending_interval: 'month',
  pending_at: '2026-12-01T00:00:00Z',
})

export const PendingDowngrade: Story = {
  parameters: { msw: { handlers: handlers(downgrading) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Plan' }))
    await expect(await summary.findByRole('heading', { name: 'Business' })).toBeVisible()
    await expect(summary.getByText('Changes to Pro monthly on 1 Dec 2026.')).toBeVisible()
  },
}

export const PendingDowngradeDark: Story = {
  ...PendingDowngrade,
  parameters: { ...PendingDowngrade.parameters, dark: true },
}

export const PendingDowngradeMobile: Story = {
  ...PendingDowngrade,
  parameters: { ...PendingDowngrade.parameters, ...phone },
  ...mobile,
}

export const PlansPendingDowngrade: Story = {
  ...plansPage(downgrading),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    const proCard = card(canvas, 'Pro')
    await expect(await proCard.findByText('Scheduled', { selector: 'span' })).toBeVisible()
    await expect(proCard.getByRole('button', { name: 'Scheduled' })).toBeDisabled()
    await expect(proCard.getByText('Starts on 1 Dec 2026.')).toBeVisible()
    const businessCard = card(canvas, 'Business')
    await expect(businessCard.getByText('Cancels the scheduled change.')).toBeVisible()
    // Keeping the current plan cancels the change at once, without a confirmation.
    await userEvent.click(businessCard.getByRole('button', { name: 'Keep Business' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({
        plan: 'business',
        interval: 'month',
        language: 'en',
      }),
    )
    await expect(within(document.body).queryByRole('dialog')).toBeNull()
  },
}

export const PlansPendingDowngradeMobile: Story = {
  ...PlansPendingDowngrade,
  parameters: { ...PlansPendingDowngrade.parameters, ...phone },
  ...mobile,
}

export const PlansYearly: Story = {
  ...plansPage(basicYearly),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await expect(canvas.getByRole('radio', { name: 'Yearly' })).toBeChecked()
    const proCard = canvas.getByRole('article', { name: 'Pro' })
    // A yearly price reads as its month, with the year's price and saving under it.
    await expect(proCard).toHaveTextContent('39.25')
    await expect(proCard).toHaveTextContent('CHF 471 / year · save CHF 117')
    await expect(proCard.querySelector('[data-slot=team-total]')).toHaveTextContent(
      'For 3 peopleCHF 615 / year',
    )
    await userEvent.click(within(proCard).getByRole('button', { name: 'Upgrade to Pro' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await waitFor(() => expect(dialog.getByText(/CHF 615 a year for 3 people/)).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({
        plan: 'pro',
        interval: 'year',
        language: 'en',
      }),
    )
  },
}

export const PlansSwitchToYearly: Story = {
  ...plansPage(basicMonthly),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('article', { name: 'Basic' })
    await userEvent.click(canvas.getByRole('radio', { name: 'Yearly' }))
    await expect(canvas.getByRole('article', { name: 'Basic' })).toHaveTextContent(
      'CHF 183 / year · save CHF 45',
    )
    await userEvent.click(card(canvas, 'Basic').getByRole('button', { name: 'Switch yearly' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await waitFor(() => expect(dialog.getByText('Switch to Basic yearly?')).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'Switch plan' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({
        plan: 'basic',
        interval: 'year',
        language: 'en',
      }),
    )
  },
}

export const PlansProToBusiness: Story = {
  ...plansPage(pro),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('article', { name: 'Business' })
    const businessCard = card(canvas, 'Business')
    // Pro is the recommendation; a workspace already on it sees no badge
    await expect(canvas.queryByText('Recommended')).not.toBeInTheDocument()
    await expect(canvas.getByRole('article', { name: 'Business' })).toHaveTextContent(
      '5 people incl. · +CHF 20 / person',
    )
    // Business has no cap on clients or invoices: "Unlimited", never ∞, a number or -1
    await expect(businessCard.getByLabelText('Key limits')).toHaveTextContent(
      /^Unlimited invoices · Unlimited clients/,
    )
    await expect(businessCard.getByLabelText('Key limits')).not.toHaveTextContent(/NaN|-1|∞/)
    await expect(
      card(canvas, 'Basic').getByRole('button', { name: 'Switch to Basic' }),
    ).toBeEnabled()
    await userEvent.click(businessCard.getByRole('button', { name: 'Upgrade to Business' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await waitFor(() =>
      expect(
        dialog.getByText(
          /charged now, prorated, and the plan changes once that payment goes through/,
        ),
      ).toBeVisible(),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Not now' }))
    await expect(checkoutRequest).not.toHaveBeenCalled()
  },
}

/** An upgrade whose payment is declined: the plan stays, the toast says why and offers Stripe's page to pay. */
export const PlansUpgradeUnpaid: Story = {
  render: () => (
    <>
      <ChangePlan />
      <Toaster />
    </>
  ),
  parameters: {
    ...plansPage(pro).parameters,
    msw: {
      handlers: [
        http.post('/api/v1/billing/checkout', () =>
          HttpResponse.json(
            {
              error: {
                code: 'payment_failed',
                message:
                  'The card was declined, so your current plan stays as it was. Pay with another card or update it, then try again.',
                details: {
                  reason: 'insufficient_funds',
                  pay_url: 'https://invoice.stripe.com/i/acct_1/test_pending',
                  plan: 'business',
                },
              },
            },
            { status: 402 },
          ),
        ),
        ...handlers(pro),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await userEvent.click(
      card(canvas, 'Business').getByRole('button', { name: 'Upgrade to Business' }),
    )
    const dialog = within(await within(document.body).findByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: 'Upgrade' }))
    const page = within(document.body)
    // The toast slides in: wait until it is shown.
    await waitFor(() => expect(page.getByText(/The card was declined/)).toBeVisible())
    await waitFor(() => expect(page.getByRole('button', { name: 'Pay' })).toBeVisible())
    await expect(card(canvas, 'Pro').getByText('Current')).toBeVisible()
  },
}

export const PlansBusinessTop: Story = {
  ...plansPage(business),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await canvas.findByRole('article', { name: 'Business' })
    await expect(canvas.queryByRole('button', { name: /^Upgrade/ })).not.toBeInTheDocument()
    await expect(canvas.queryByText('Recommended')).not.toBeInTheDocument()
    await expect(card(canvas, 'Business').getByText('Current')).toBeVisible()
  },
}

export const PlansPastDue: Story = {
  ...plansPage(pastDue),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    const businessCard = card(canvas, 'Business')
    await expect(
      await businessCard.findByRole('button', { name: 'Upgrade to Business' }),
    ).toBeDisabled()
    await expect(businessCard.getByText('Update the payment method first.')).toBeVisible()
  },
}

/** A workspace on Free: Free as its current plan, the paid plans as upgrades, yearly first; the trial is on Pro. */
export const PlansFree: Story = {
  ...plansPage(billingFixture()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await expect(canvas.getByRole('heading', { name: 'Choose a plan' })).toBeVisible()
    await expect(canvasElement.querySelector('[data-slot=current-plan-pill]')).toHaveTextContent(
      'You’re on Free',
    )
    const free = canvas.getByRole('region', { name: 'Free' })
    await expect(free).toHaveTextContent('Your current plan')
    await expect(within(free).queryByRole('button')).toBeNull()
    await expect(canvas.getByRole('radio', { name: 'Yearly' })).toBeChecked()
    const proCard = card(canvas, 'Pro')
    await expect(proCard.getByText('Recommended')).toBeVisible()
    await expect(
      proCard.getByText(
        'Pro free for 14 days, up to 2 people, card required. Full Pro limits, shared by the team. Then CHF 615 a year for 3 people.',
      ),
    ).toBeVisible()
    await expect(card(canvas, 'Basic').getByRole('button', { name: 'Choose Basic' })).toBeVisible()
    await userEvent.click(proCard.getByRole('button', { name: 'Start 14-day free trial' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({
        plan: 'pro',
        interval: 'year',
        language: 'en',
      }),
    )
  },
}

export const PlansFreeMobile: Story = {
  ...PlansFree,
  parameters: { ...PlansFree.parameters, ...phone },
  ...mobile,
}

/** A workspace in the EU: the plans in euros, with VAT and no mention of Swiss VAT. */
export const PlansFreeEuro: Story = {
  ...plansPage(billingFixture({ currency: 'eur' })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await expect(canvas.getByRole('article', { name: 'Pro' })).toHaveTextContent('EUR')
    await expect(canvas.getByText('Save EUR 45 a year on Basic')).toBeVisible()
    await expect(canvas.getByText(/Prices incl\. VAT/)).toBeVisible()
    await expect(canvas.queryByText(/Swiss VAT|CHF/)).toBeNull()
  },
}

/** Anywhere else: the plans in dollars, tax included. */
export const PlansFreeDollar: Story = {
  ...plansPage(billingFixture({ currency: 'usd' })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await userEvent.click(canvas.getByRole('radio', { name: 'Monthly' }))
    await expect(canvas.getByRole('article', { name: 'Basic' })).toHaveTextContent('USD19')
    await expect(canvas.getByText(/Prices incl\. tax/)).toBeVisible()
  },
}
