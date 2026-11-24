import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'

import type { Billing } from '@/lib/billing'

import { billingFixture as billing, publicOfferFixture } from './billing-fixture'
import { choiceLabel, confirmBody, limitLine, PlanCards } from './plan-cards'

vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

let checkout: unknown
const server = setupServer(
  http.post('/api/v1/billing/checkout', async ({ request }) => {
    checkout = await request.json()
    return HttpResponse.json({ url: 'https://checkout.stripe.test/c' })
  }),
  http.post('/api/v1/billing/promotion-code', async ({ request }) => {
    const { code } = (await request.json()) as { code: string }
    if (code === 'FRANCS')
      return HttpResponse.json(
        {
          error: {
            code: 'promotion_code_invalid',
            message: 'This code is for payments in CHF.',
            details: { fields: { code: 'invalid' }, reason: 'currency' },
          },
        },
        { status: 422 },
      )
    if (code === 'TENOFF')
      return HttpResponse.json({
        data: {
          code,
          percent_off: null,
          amount_off: 1000,
          currency: 'chf',
          duration: 'once',
          duration_in_months: null,
          plans: null,
          expires_at: null,
        },
      })
    if (code !== 'LAUNCH20')
      return HttpResponse.json(
        {
          error: {
            code: 'promotion_code_invalid',
            message: "This code isn't valid.",
            details: { fields: { code: 'invalid' } },
          },
        },
        { status: 422 },
      )
    return HttpResponse.json({
      data: {
        code,
        percent_off: 20,
        amount_off: null,
        currency: null,
        duration: 'repeating',
        duration_in_months: 3,
        plans: ['basic', 'pro'],
        expires_at: null,
      },
    })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  checkout = undefined
  server.resetHandlers()
})
afterAll(() => server.close())

const assign = vi.fn<(url: string) => void>()
beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' })
})
afterEach(() => vi.unstubAllGlobals())

const renderCards = (value: Billing) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <PlanCards billing={value} offer={publicOfferFixture} />
      </TooltipProvider>
    </QueryClientProvider>,
  )

const card = (name: string) => screen.getByRole('article', { name })
const total = (name: string) => card(name).querySelector('[data-slot=team-total]')
const monthly = () => userEvent.click(screen.getByRole('radio', { name: 'Monthly' }))

test('a card is compact: a tagline, five lead features at most and three key stats', () => {
  renderCards(billing())
  expect(card('Basic')).toHaveTextContent('Up to 5 people')
  const pro = card('Pro')
  expect(pro).toHaveTextContent('Everything in Basic')
  expect(pro).toHaveTextContent('Heidi AI assistant')
  expect(pro).toHaveTextContent('AI import & smart capture')
  expect(card('Business')).toHaveTextContent('White-label client portal')
  for (const name of ['Basic', 'Pro', 'Business']) {
    const features = card(name).querySelector<HTMLElement>('[data-slot=plan-features]')!
    expect(within(features).getAllByRole('listitem').length).toBeLessThanOrEqual(5)
    const stats = card(name).querySelector('[data-slot=plan-stats]')!.textContent!.split(' · ')
    expect(stats.length).toBeLessThanOrEqual(3)
    expect(card(name).querySelector('dl')).toBeNull()
  }
  expect(card('Business').querySelector('[data-slot=plan-stats]')?.textContent).toMatch(
    /^Unlimited invoices · Unlimited clients/,
  )
  expect(document.body.textContent).not.toContain('∞')
})

test('on Free, Free is the current plan as one compact strip with a few facts and no way to choose it', () => {
  renderCards(billing())
  const free = screen.getByRole('region', { name: 'Free' })
  expect(free).toHaveTextContent('Your current plan')
  expect(free).toHaveTextContent('CHF 0 forever · 1 person · no card needed')
  expect(within(free).queryByRole('button')).toBeNull()
  expect(free).toHaveTextContent('5 clients')
  expect(within(free).queryByLabelText('Limits')).toBeNull()
  expect(screen.queryByRole('article', { name: 'Free' })).toBeNull()
})

test('a paid workspace sees no Free strip', () => {
  renderCards(billing({ plan: 'pro', status: 'active', interval: 'month' }))
  expect(screen.queryByRole('region', { name: 'Free' })).toBeNull()
})

test('the toggle starts on yearly with what yearly saves, a subscription on its own interval', async () => {
  const { unmount } = renderCards(billing())
  expect(screen.getByRole('radio', { name: 'Yearly' })).toBeChecked()
  expect(screen.getByText('Save 20% — CHF 45 a year on Basic')).toBeVisible()
  expect(card('Basic')).toHaveTextContent('15.25')
  expect(card('Basic')).toHaveTextContent('CHF 183 / year · save CHF 45')
  expect(total('Basic')).toHaveTextContent('For 3 peopleCHF 375 / year')
  await monthly()
  expect(screen.getByRole('radio', { name: 'Monthly' })).toBeChecked()
  expect(card('Basic')).toHaveTextContent('1 person incl. · +CHF 10 / person')
  unmount()
  renderCards(billing({ plan: 'pro', status: 'active', interval: 'month' }))
  expect(screen.getByRole('radio', { name: 'Monthly' })).toBeChecked()
})

test('only Pro offers the trial, with its line; the others are charged today', async () => {
  renderCards(billing())
  await monthly()
  const pro = card('Pro')
  expect(within(pro).getByRole('button', { name: 'Start 14-day free trial' })).toBeEnabled()
  expect(pro).toHaveTextContent(
    'Pro free for 14 days, up to 2 people, card required. Full Pro limits, shared by the team. Then CHF 64 a month for 3 people.',
  )
  expect(pro).toHaveTextContent('2 people incl. · +CHF 15 / person')
  expect(within(card('Business')).getByRole('button', { name: 'Choose Business' })).toBeEnabled()
  expect(card('Business')).toHaveTextContent('Charged today.')
  const basic = card('Basic')
  expect(within(basic).getByRole('button', { name: 'Choose Basic' })).toBeEnabled()
  expect(basic).toHaveTextContent('Charged today.')
  expect(basic).not.toHaveTextContent('incl. VAT')
  expect(total('Basic')).toHaveTextContent('For 3 peopleCHF 39 / month')
  expect(total('Business')).toHaveTextContent('For 3 peopleCHF 149 / month')
  await userEvent.click(screen.getByRole('radio', { name: 'Yearly' }))
  await userEvent.click(within(card('Pro')).getByRole('button', { name: /Start 14-day/ }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/c'))
  expect(checkout).toEqual({ plan: 'pro', interval: 'year', language: 'en' })
})

test('the picker shows the workspace currency and what its prices include', async () => {
  const { unmount } = renderCards(billing({ currency: 'eur' }))
  expect(card('Pro')).toHaveTextContent('EUR')
  expect(screen.getByText(/Prices incl. VAT/)).toBeVisible()
  expect(screen.queryByText(/CHF|Swiss VAT/)).toBeNull()
  unmount()

  renderCards(billing({ currency: 'usd' }))
  await monthly()
  expect(card('Pro')).toHaveTextContent('Then USD 64 a month for 3 people.')
  expect(screen.getByText(/Prices incl. tax/)).toBeVisible()
})

test('without a trial Business is chosen like the others', () => {
  renderCards(billing({ trial_available: false }))
  expect(within(card('Business')).getByRole('button', { name: 'Choose Business' })).toBeEnabled()
  expect(card('Business')).toHaveTextContent('Charged today.')
})

test('while trialing, another plan says the trial ends and the plan is charged now', async () => {
  renderCards(
    billing({ plan: 'basic', status: 'trialing', interval: 'month', trial_available: false }),
  )
  expect(within(card('Basic')).getByRole('button')).toHaveTextContent('Current plan')
  const pro = card('Pro')
  expect(pro).toHaveTextContent('Your trial ends now and Pro is charged today.')
  await userEvent.click(within(pro).getByRole('button', { name: 'Upgrade to Pro' }))
  expect(await screen.findByText('Upgrade to Pro?')).toBeInTheDocument()
  expect(
    screen.getByText(
      'Your trial ends now and Pro is charged today: CHF 64 a month for 3 people, incl. VAT.',
    ),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
  await waitFor(() => expect(checkout).toEqual({ plan: 'pro', interval: 'month', language: 'en' }))
})

test.each<[string, Partial<Billing>, 'basic' | 'pro' | 'business', 'month' | 'year', RegExp]>([
  [
    'an upgrade waits for its payment',
    { plan: 'basic' },
    'pro',
    'month',
    /changes once that payment/,
  ],
  ['monthly to yearly waits too', { plan: 'pro' }, 'pro', 'year', /changes once that payment/],
  [
    'a downgrade waits for the period end',
    { plan: 'business' },
    'pro',
    'month',
    /starts when the paid period ends.*Nothing is charged or credited now/,
  ],
  [
    'yearly to monthly waits too',
    { plan: 'pro', interval: 'year' },
    'pro',
    'month',
    /starts when the paid period ends/,
  ],
])('confirmBody: %s', (_, over, plan, interval, expected) => {
  const b = billing({ status: 'active', interval: 'month', ...over })
  const target = b.plans.find((p) => p.id === plan)
  if (!target) throw new Error('no plan ' + plan)
  expect(confirmBody(b, target, interval)).toMatch(expected)
})

test('an unpaid upgrade says why and offers Stripe’s page to pay', async () => {
  server.use(
    http.post('/api/v1/billing/checkout', () =>
      HttpResponse.json(
        {
          error: {
            code: 'payment_failed',
            message: 'The card was declined, so your current plan stays as it was.',
            details: { reason: 'card_declined', pay_url: 'https://invoice.stripe.com/i/1' },
          },
        },
        { status: 402 },
      ),
    ),
  )
  renderCards(billing({ plan: 'basic', status: 'active', interval: 'month' }))
  await userEvent.click(within(card('Pro')).getByRole('button', { name: 'Upgrade to Pro' }))
  await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'The card was declined, so your current plan stays as it was.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Pay' }) }),
    ),
  )
})

test('a subscribed workspace can move down', async () => {
  renderCards(billing({ plan: 'business', status: 'active', interval: 'month' }))
  expect(within(card('Pro')).getByRole('button', { name: 'Switch to Pro' })).toBeEnabled()
  await userEvent.click(screen.getByRole('radio', { name: 'Yearly' }))
  expect(within(card('Business')).getByRole('button', { name: 'Switch yearly' })).toBeEnabled()
})

test('the promotion code sits just under the toggle, above the cards', () => {
  renderCards(billing())
  const yearly = screen.getByRole('radio', { name: 'Yearly' })
  const promo = screen.getByRole('button', { name: 'Have a promotion code?' })
  expect(yearly.closest('fieldset')?.compareDocumentPosition(promo)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(promo.compareDocumentPosition(card('Basic'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})

test('a valid promotion code discounts the plans it covers and goes with the checkout', async () => {
  renderCards(billing({ trial_available: false }))
  await monthly()
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'launch20')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect((await screen.findByText('LAUNCH20')).parentElement).toHaveTextContent(
    'LAUNCH20 · −20% for 3 months',
  )
  expect(total('Pro')).toHaveTextContent('CHF 51.20')
  expect(total('Pro')?.querySelector('s')).toHaveTextContent('CHF 64')
  expect(total('Business')?.querySelector('s')).toBeNull()
  expect(total('Business')).toHaveTextContent('CHF 149')
  await userEvent.click(within(card('Pro')).getByRole('button', { name: 'Choose Pro' }))
  await waitFor(() =>
    expect(checkout).toEqual({
      plan: 'pro',
      interval: 'month',
      promotion_code: 'LAUNCH20',
      language: 'en',
    }),
  )
  // Business is not covered: no code is sent.
  await userEvent.click(within(card('Business')).getByRole('button', { name: 'Choose Business' }))
  await waitFor(() =>
    expect(checkout).toEqual({ plan: 'business', interval: 'month', language: 'en' }),
  )
})

test('the promotion chip can be changed and removed', async () => {
  renderCards(billing())
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'LAUNCH20')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Change' }))
  expect(screen.getByLabelText(/^Code\*?$/)).toHaveValue('LAUNCH20')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(screen.queryByText(/LAUNCH20/)).toBeNull()
  expect(card('Pro').querySelector('s')).toBeNull()
})

test('an invalid promotion code is a field error', async () => {
  renderCards(billing())
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'NOPE')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText("This code isn't valid.")).toBeInTheDocument()
  expect(screen.queryByText(/NOPE ·/)).toBeNull()
})

test('a refused code shows the reason the API gives', async () => {
  renderCards(billing())
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'FRANCS')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText('This code is for payments in CHF.')).toBeInTheDocument()
})

test('an amount off takes the amount the API gives in the workspace currency', async () => {
  renderCards(billing({ trial_available: false }))
  await monthly()
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'TENOFF')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect((await screen.findByText('TENOFF')).parentElement).toHaveTextContent(
    'TENOFF · −CHF 10 once',
  )
  expect(total('Pro')).toHaveTextContent('CHF 54')
  expect(total('Pro')?.querySelector('s')).toHaveTextContent('CHF 64')
})

test('people who cannot manage billing see the plans without the way to change them', () => {
  renderCards(billing({ can_manage: false }))
  expect(
    within(card('Pro')).getByRole('button', { name: 'Start 14-day free trial' }),
  ).toBeDisabled()
  expect(screen.getByText(/Only an owner or admin/)).toBeInTheDocument()
  expect(screen.queryByText('Have a promotion code?')).toBeNull()
})

test('limitLine words one limit for the usage overview', () => {
  expect(limitLine('members', 1)).toBe('1 member besides the owner')
  expect(limitLine('members', null)).toBe('Any number of people')
  expect(limitLine('invoices_per_month', 1)).toBe('1 invoice issue a month per team member')
  expect(limitLine('quotes_per_month', 1)).toBe('1 quote sent a month per team member')
  expect(limitLine('expenses_per_month', 0)).toBe('No expenses')
})

test('a plan the workspace is over is refused with the reason, and Checkout does not open', async () => {
  server.use(
    http.post('/api/v1/billing/checkout', () =>
      HttpResponse.json(
        {
          error: {
            code: 'plan_limits_exceeded',
            message:
              'Basic allows 4 members besides the owner; this workspace has 5. Remove 1 member first.',
            details: { plan: 'basic', overages: [{ limit: 'members', used: 5, max: 4 }] },
          },
        },
        { status: 409 },
      ),
    ),
  )
  renderCards(billing())
  await userEvent.click(within(card('Basic')).getByRole('button', { name: 'Choose Basic' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'Basic allows 4 members besides the owner; this workspace has 5. Remove 1 member first.',
    ),
  )
  expect(assign).not.toHaveBeenCalled()
})

test('choiceLabel names the way to each plan from the workspace’s', () => {
  const [basic, pro, business] = billing().plans
  if (!basic || !pro || !business) throw new Error('fixture plans missing')
  expect(choiceLabel(billing(), pro, 'month')).toBe('Start 14-day free trial')
  expect(choiceLabel(billing(), basic, 'month')).toBe('Choose Basic')
  expect(choiceLabel(billing(), business, 'month')).toBe('Choose Business')
  expect(choiceLabel(billing({ trial_available: false }), pro, 'month')).toBe('Choose Pro')
  const onPro = billing({ plan: 'pro', interval: 'month' })
  expect(choiceLabel(onPro, basic, 'month')).toBe('Switch to Basic')
  expect(choiceLabel(onPro, pro, 'year')).toBe('Switch yearly')
  expect(choiceLabel(billing({ plan: 'basic' }), pro, 'month')).toBe('Upgrade to Pro')
})

test('the current plan and the next step up are marked; Business has nothing above it', () => {
  const { unmount } = renderCards(billing({ plan: 'basic', status: 'active', interval: 'month' }))
  expect(within(card('Basic')).getByText('Current')).toBeInTheDocument()
  expect(within(card('Pro')).getByText('Recommended')).toBeInTheDocument()
  unmount()
  renderCards(billing({ plan: 'business', status: 'active', interval: 'month' }))
  expect(screen.queryByText('Recommended')).toBeNull()
  expect(within(card('Business')).getByText('Current')).toBeInTheDocument()
})

test('while a payment fails no plan can be chosen', () => {
  renderCards(billing({ plan: 'pro', status: 'past_due', interval: 'month' }))
  expect(
    within(card('Business')).getByRole('button', { name: 'Upgrade to Business' }),
  ).toBeDisabled()
  expect(card('Business')).toHaveTextContent('Update the payment method first.')
})

test('every card totals the workspace’s people, with no control to pick them', async () => {
  renderCards(billing())
  await monthly()
  expect(total('Pro')).toHaveTextContent('For 3 peopleCHF 64 / month')
  expect(screen.queryByRole('group', { name: 'Team size' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /people/ })).not.toBeInTheDocument()
})

test('a workspace with no seats counted yet is totalled for one person', async () => {
  renderCards(billing({ seats: 0 }))
  await monthly()
  expect(total('Pro')).toHaveTextContent('For 1 personCHF 49 / month')
})

test('one footnote says whose allowances they are, and a percent has no space', () => {
  renderCards(billing({ trial_available: false }))
  expect(screen.getAllByText(/shared by the whole team/)).toHaveLength(1)
  expect(document.body.textContent).not.toMatch(/\d %/)
})

test('every feature side by side opens in place under the cards', async () => {
  renderCards(billing())
  const compare = screen.getByRole('button', { name: 'Compare every feature' })
  expect(compare).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('table')).toBeNull()
  await userEvent.click(compare)
  expect(compare).toHaveAttribute('aria-expanded', 'true')
  const table = screen.getByRole('table', { hidden: true })
  for (const name of ['Free', 'Basic', 'Pro', 'Business'])
    expect(
      within(table).getByRole('columnheader', { name: new RegExp(`^${name}`), hidden: true }),
    ).toBeInTheDocument()
  expect(table).toHaveTextContent('CHF 0')
  await userEvent.click(compare)
  expect(screen.queryByRole('table', { hidden: true })).toBeNull()
})

const scheduledDowngrade = (over: Partial<Billing> = {}) =>
  billing({
    plan: 'business',
    status: 'active',
    interval: 'month',
    pricing: 'per_seat',
    pending_plan: 'pro',
    pending_interval: 'month',
    pending_at: '2026-12-01T00:00:00Z',
    ...over,
  })

test('a scheduled downgrade marks its plan; the current plan can be kept, which cancels it', async () => {
  server.use(
    http.post('/api/v1/billing/checkout', async ({ request }) => {
      checkout = await request.json()
      return HttpResponse.json({
        url: `${window.location.origin}/settings/billing?checkout=switched`,
      })
    }),
  )
  renderCards(scheduledDowngrade())
  const pro = card('Pro')
  expect(within(pro).getByText('Scheduled', { selector: 'span' })).toBeInTheDocument()
  expect(within(pro).getByRole('button', { name: 'Scheduled' })).toBeDisabled()
  expect(pro).toHaveTextContent('Starts on 1 Dec 2026.')
  const business = card('Business')
  expect(business).toHaveTextContent('Cancels the scheduled change.')
  await userEvent.click(within(business).getByRole('button', { name: 'Keep Business' }))
  // No confirmation and no promotion code: it only cancels the change.
  await waitFor(() =>
    expect(checkout).toEqual({ plan: 'business', interval: 'month', language: 'en' }),
  )
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      'You stay on Business. The scheduled change is cancelled.',
    ),
  )
})

test('yearly to monthly on the same plan is scheduled on the monthly side', async () => {
  renderCards(scheduledDowngrade({ interval: 'year', pending_plan: 'business' }))
  expect(within(card('Business')).getByRole('button', { name: 'Keep Business' })).toBeEnabled()
  await monthly()
  expect(within(card('Business')).getByRole('button', { name: 'Scheduled' })).toBeDisabled()
})

test('a downgrade made in place says it waits for the period end', async () => {
  server.use(
    http.post('/api/v1/billing/checkout', () =>
      HttpResponse.json({ url: `${window.location.origin}/settings/billing?checkout=scheduled` }),
    ),
  )
  renderCards(billing({ plan: 'business', status: 'active', interval: 'month' }))
  await userEvent.click(within(card('Pro')).getByRole('button', { name: 'Switch to Pro' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Switch plan' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      'Your plan changes at the end of the paid period. Nothing changes until then.',
    ),
  )
})

test('cards total the paid seats of a per-seat subscription', () => {
  renderCards(billing({ plan: 'pro', status: 'active', interval: 'month', paid_seats: 4 }))
  expect(total('Pro')).toHaveTextContent('For 4 peopleCHF 79 / month')
})

test('more seats than self-service sells is refused with the API’s reason', async () => {
  const message =
    'Plans bought here are for up to 25 people; this workspace has 26. Contact us for a larger team.'
  server.use(
    http.post('/api/v1/billing/checkout', () =>
      HttpResponse.json(
        { error: { code: 'too_many_seats', message, details: { seats: 26, max: 25 } } },
        { status: 409 },
      ),
    ),
  )
  renderCards(billing())
  await userEvent.click(
    within(card('Pro')).getByRole('button', { name: 'Start 14-day free trial' }),
  )
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  expect(assign).not.toHaveBeenCalled()
})
