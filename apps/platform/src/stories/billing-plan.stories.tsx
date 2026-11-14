import { SidebarProvider } from '@helvetly/ui/components/sidebar'
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
const trialing = subscribed({
  plan: 'basic',
  status: 'trialing',
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
  within(canvas.getByRole('region', { name }))
/** The plans page loads its billing first. */
const plansLoaded = (canvas: ReturnType<typeof within>) =>
  canvas.findByRole('region', { name: 'Basic' })
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
    const summary = within(await canvas.findByRole('region', { name: 'Current plan' }))
    await expect(await summary.findByRole('heading', { name: 'Basic' })).toBeVisible()
    await expect(summary.getByText('Trial', { exact: true })).toBeVisible()
    await expect(summary.getByText(/^Trial ends on \d+ \w+ \d{4}$/)).toBeVisible()
    await expect(summary.getByText('Day 3 of 7')).toBeVisible()
    await expect(summary.getByRole('progressbar', { name: 'Trial days used' })).toHaveAttribute(
      'value',
      '2',
    )
    // The total with how it adds up, then what is charged after the trial.
    await expect(price(canvasElement)).toHaveTextContent(
      /CHF 19 per person × 3 people\s*CHF 57\s*\/ month/,
    )
    await expect(nextStep(canvasElement)).toHaveTextContent('Then CHF 57 is charged.')
    await expect(canvasElement.querySelector('[data-slot=countdown]')).toHaveTextContent(
      '5days left',
    )
    // The plans are a page of their own: no tiles here, one way there.
    await expect(canvas.queryByRole('region', { name: 'Pro' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('radio', { name: 'Yearly' })).not.toBeInTheDocument()
    // A trial on Basic: the next plan up is the primary way, the plans page beside it.
    await changePlanLink(summary, 'Upgrade to Pro')
    await changePlanLink(summary, 'Compare plans')

    // Usage, closest to its limit first; signature requests are at 4 of 5 (80 %): orange, with a note; red only from 90 %.
    const signatures = canvas
      .getByText('Signature requests', { exact: true })
      .closest('[data-slot=usage-meter]')
    await expect(canvasElement.querySelector('[data-slot=usage-meter]')).toBe(signatures)
    await expect(signatures).toHaveAttribute('data-state', 'near')
    await expect(signatures?.querySelector('[data-slot=meter]')).toHaveAttribute(
      'data-tone',
      'warning',
    )
    await expect(within(signatures as HTMLElement).getByText('Almost at limit')).toBeVisible()
    // One nudge for it, to the next plan up.
    const nudge = canvasElement.querySelector<HTMLElement>('[data-slot=usage-nudge]')
    await expect(nudge).toHaveTextContent(
      'Signature requests: almost at the plan’s limit. Pro includes 50 signature requests a month.',
    )
    await expect(
      within(nudge as HTMLElement).getByRole('link', { name: 'See Pro' }),
    ).toHaveAttribute('href', '/settings/billing/plans/')
    // No member cap on a per-seat plan: the meter has no limit to reach.
    const members = canvas.getByText('Members').closest('[data-slot=usage-meter]')
    await expect(members).toHaveAttribute('data-state', 'ok')
    await expect(members).toHaveTextContent('3of unlimited')
  },
}

export const TrialDark: Story = { ...Trial, parameters: { dark: true } }

export const TrialMobile: Story = { ...Trial, parameters: phone, ...mobile }

export const ActiveMonthly: Story = {
  parameters: { msw: { handlers: handlers(basicMonthly) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Current plan' }))
    await expect(await summary.findByText('Renews on 1 Dec 2026')).toBeVisible()
    await expect(summary.getByText('Active', { exact: true })).toBeVisible()
    // Time passing is no limit: the period bar stays calm.
    await expect(
      summary.getByRole('progressbar', { name: 'Billing period elapsed' }),
    ).toBeInTheDocument()
    await expect(canvasElement.querySelector('[data-slot=countdown]')).toHaveAttribute(
      'data-tone',
      'brand',
    )
    await expect(nextStep(canvasElement)).toHaveTextContent('Next charge CHF 57.')
    await changePlanLink(summary, 'Upgrade to Pro')
    const payment = within(canvas.getByRole('region', { name: 'Payment method' }))
    await expect(await payment.findByText('4242')).toBeVisible()
    await expect(payment.getByText('04/28')).toBeVisible()
    await expect(payment.getByText('4242').closest('[data-slot=payment-card]')).toHaveAttribute(
      'data-brand',
      'visa',
    )
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
    await userEvent.click(summary.getByRole('button', { name: 'Manage billing' }))
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
    const summary = within(
      await within(canvasElement).findByRole('region', { name: 'Current plan' }),
    )
    await expect(await summary.findByText('Cancels', { exact: true })).toBeVisible()
    // Nothing more is charged: the plan ends with the period.
    await expect(summary.getByText('Ends on 1 Dec 2026')).toBeVisible()
    await expect(nextStep(canvasElement)).toHaveTextContent('Nothing more is charged.')
    await expect(canvasElement.querySelector('[data-slot=countdown]')).toHaveAttribute(
      'data-tone',
      'muted',
    )
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
    const summary = within(
      await within(canvasElement).findByRole('region', { name: 'Current plan' }),
    )
    await expect(await summary.findByText('WELCOME20')).toBeVisible()
    await expect(summary.getByText(/−20 % for 3 months until 1 Feb 2027/)).toBeVisible()
    // The total stays the list price; the next charge has the discount taken off.
    await expect(price(canvasElement)).toHaveTextContent(/CHF 57\s*\/ month/)
    await expect(nextStep(canvasElement)).toHaveTextContent('Next charge CHF 45.60.')
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
    await expect(
      payment.getByText('No card on file').closest('[data-slot=payment-card]'),
    ).toHaveAttribute('data-brand', 'none')
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
    const summary = within(await canvas.findByRole('region', { name: 'Current plan' }))
    await expect(await summary.findByText('Renews on 1 Dec 2026')).toBeVisible()
    await expect(summary.getByRole('heading', { name: 'Business', level: 2 })).toBeVisible()
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
    await expect(await canvas.findByRole('heading', { name: 'Pro', level: 2 })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('region', { name: 'Payment method' })).not.toBeInTheDocument()
    await expect(
      canvas.getByText('Only an owner or admin can change the workspace’s plan.'),
    ).toBeVisible()
    await changePlanLink(canvas, 'Compare plans')
  },
}

export const NoPlan: Story = {
  parameters: { msw: { handlers: handlers(billingFixture()) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'No plan' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Read-only' })).toBeVisible()
    await changePlanLink(canvas, 'Choose a plan')
  },
}

export const NoPlanMobile: Story = {
  ...NoPlan,
  parameters: { ...NoPlan.parameters, ...phone },
  ...mobile,
}

export const PlansTrialUpgrade: Story = {
  ...plansPage(trialing),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await expect(await canvas.findByRole('heading', { name: 'Change your plan' })).toBeVisible()
    // Where the workspace stands, in the overview's words.
    await expect(canvasElement.querySelector('[data-slot=current-plan-pill]')).toHaveTextContent(
      /You’re on Basic\s*·\s*5 days left in the trial/,
    )
    await expect(canvas.getByRole('link', { name: 'Back to billing' })).toHaveAttribute(
      'href',
      '/settings/billing/',
    )
    const proCard = card(canvas, 'Pro')
    await expect(proCard.getByText('Recommended')).toBeVisible()
    await expect(proCard.getByText('CHF 49')).toBeVisible()
    await expect(proCard.getByText('or CHF 471 a year, save 20 %')).toBeVisible()
    await expect(
      canvas.getByRole('region', { name: 'Pro' }).querySelector('[data-slot=team-total]'),
    ).toHaveTextContent('For 3 peopleCHF 147 / month')
    // Limits read number first.
    await expect(
      proCard.getByText(/^1.000$/, { selector: 'strong' }).parentElement,
    ).toHaveTextContent(/^1.000 clients$/)
    const basic = card(canvas, 'Basic')
    await expect(basic.getByText('Current')).toBeVisible()
    await expect(basic.getByRole('button', { name: 'Current plan' })).toBeDisabled()
    await expect(canvas.getByText('Save 20 % yearly')).toBeVisible()

    await userEvent.click(proCard.getByRole('button', { name: 'Upgrade to Pro' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    // The dialog fades in.
    await waitFor(() =>
      expect(
        dialog.getByText(
          'Your trial ends now and Pro is charged today: CHF 49 per person a month, incl. VAT (CHF 147 for 3 people).',
        ),
      ).toBeVisible(),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({ plan: 'pro', interval: 'month' }),
    )
  },
}

export const PlansTrialUpgradeDark: Story = {
  ...PlansTrialUpgrade,
  parameters: { ...PlansTrialUpgrade.parameters, dark: true },
}

export const PlansTrialUpgradeMobile: Story = {
  ...PlansTrialUpgrade,
  parameters: { ...PlansTrialUpgrade.parameters, ...phone },
  ...mobile,
}

export const PlansYearly: Story = {
  ...plansPage(basicYearly),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    const proCard = card(canvas, 'Pro')
    await expect(await proCard.findByText('CHF 471')).toBeVisible()
    await expect(proCard.getByText('CHF 39.25 a month, billed yearly')).toBeVisible()
    await expect(proCard.getByText('Save CHF 117 a year')).toBeVisible()
    await userEvent.click(proCard.getByRole('button', { name: 'Upgrade to Pro' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await waitFor(() => expect(dialog.getByText(/CHF 471 per person a year/)).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({ plan: 'pro', interval: 'year' }),
    )
  },
}

export const PlansSwitchToYearly: Story = {
  ...plansPage(basicMonthly),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await canvas.findByRole('region', { name: 'Basic' })
    await userEvent.click(canvas.getByRole('radio', { name: 'Yearly' }))
    const basic = card(canvas, 'Basic')
    await expect(basic.getByText('CHF 183')).toBeVisible()
    await userEvent.click(basic.getByRole('button', { name: 'Switch yearly' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await waitFor(() => expect(dialog.getByText('Switch to Basic yearly?')).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'Switch plan' }))
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({ plan: 'basic', interval: 'year' }),
    )
  },
}

export const PlansProToBusiness: Story = {
  ...plansPage(pro),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await canvas.findByRole('region', { name: 'Business' })
    const businessCard = card(canvas, 'Business')
    await expect(businessCard.getByText('Recommended')).toBeVisible()
    await expect(businessCard.getByText('CHF 99')).toBeVisible()
    await expect(businessCard.getByRole('list', { name: 'Business includes' })).toHaveTextContent(
      /Unlimited clients/,
    )
    await expect(
      card(canvas, 'Basic').getByRole('button', { name: 'Switch to Basic' }),
    ).toBeEnabled()
    await userEvent.click(businessCard.getByRole('button', { name: 'Upgrade to Business' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await waitFor(() => expect(dialog.getByText(/prorated on your next invoice/)).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'Not now' }))
    await expect(checkoutRequest).not.toHaveBeenCalled()
  },
}

export const PlansBusinessTop: Story = {
  ...plansPage(business),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await canvas.findByRole('region', { name: 'Business' })
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

export const PlansNoPlan: Story = {
  ...plansPage(billingFixture()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await plansLoaded(canvas)
    await expect(await canvas.findByRole('heading', { name: 'Choose a plan' })).toBeVisible()
    await userEvent.click(
      card(canvas, 'Basic').getByRole('button', { name: 'Start 7-day free trial' }),
    )
    await waitFor(() =>
      expect(checkoutRequest).toHaveBeenCalledWith({ plan: 'basic', interval: 'month' }),
    )
  },
}
