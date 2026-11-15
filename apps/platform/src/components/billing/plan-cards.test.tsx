import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'

import type { Billing } from '@/lib/billing'

import { billingFixture as billing, flatBillingFixture } from './billing-fixture'
import {
  choiceLabel,
  confirmBody,
  limitLine,
  PlanCards,
  planFact,
  planFeatures,
} from './plan-cards'

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
beforeAll(() => server.listen())
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
        <PlanCards billing={value} />
      </TooltipProvider>
    </QueryClientProvider>,
  )

const card = (name: string) => screen.getByRole('region', { name })

test('Basic offers the trial with its line; the others are charged today', async () => {
  renderCards(billing())
  const basic = card('Basic')
  expect(within(basic).getByRole('button', { name: 'Start 7-day free trial' })).toBeEnabled()
  expect(basic).toHaveTextContent('Free for 7 days, card required. Then CHF 19 per person a month.')
  expect(basic).toHaveTextContent('per person / month · incl. VAT')
  expect(basic.querySelector('[data-slot=team-total]')).toHaveTextContent(
    'For 3 peopleCHF 57 / month',
  )
  expect(within(card('Pro')).getByRole('button', { name: 'Choose Pro' })).toBeEnabled()
  expect(card('Pro')).toHaveTextContent('Charged today.')
  await userEvent.click(screen.getByRole('radio', { name: 'Yearly' }))
  expect(card('Basic')).toHaveTextContent('CHF 183')
  expect(card('Basic')).toHaveTextContent('CHF 15.25 a month, billed yearly')
  expect(card('Basic')).toHaveTextContent('Save CHF 45 a year')
  expect(card('Basic').querySelector('[data-slot=team-total]')).toHaveTextContent(
    'For 3 peopleCHF 549 / year',
  )
  await userEvent.click(within(card('Basic')).getByRole('button', { name: /Start 7-day/ }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/c'))
  expect(checkout).toEqual({ plan: 'basic', interval: 'year' })
})

test('the picker shows the workspace currency and what its prices include', () => {
  const { unmount } = renderCards(billing({ currency: 'eur' }))
  expect(card('Pro')).toHaveTextContent('EUR 49')
  expect(card('Pro')).toHaveTextContent('per person / month · incl. VAT')
  expect(screen.getByText(/Prices incl. VAT/)).toBeVisible()
  expect(screen.queryByText(/CHF|Swiss VAT/)).toBeNull()
  unmount()

  renderCards(billing({ currency: 'usd' }))
  expect(card('Basic')).toHaveTextContent('Then USD 19 per person a month.')
  expect(card('Basic')).toHaveTextContent('per person / month · incl. tax')
  expect(screen.getByText(/Prices incl. tax/)).toBeVisible()
})

test('without a trial Basic is chosen like the others', () => {
  renderCards(billing({ trial_available: false }))
  expect(within(card('Basic')).getByRole('button', { name: 'Choose Basic' })).toBeEnabled()
  expect(card('Basic')).toHaveTextContent('Charged today.')
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
      'Your trial ends now and Pro is charged today: CHF 49 per person a month, incl. VAT (CHF 147 for 3 people).',
    ),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
  await waitFor(() => expect(checkout).toEqual({ plan: 'pro', interval: 'month' }))
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
    'a downgrade credits the rest',
    { plan: 'business' },
    'pro',
    'month',
    /credited to your balance/,
  ],
  ['yearly to monthly credits too', { plan: 'pro', interval: 'year' }, 'pro', 'month', /credited/],
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

test('a valid promotion code discounts the plans it covers and goes with the checkout', async () => {
  renderCards(billing({ trial_available: false }))
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'launch20')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText('LAUNCH20 · −20 % for 3 months')).toBeInTheDocument()
  const pro = card('Pro')
  expect(pro).toHaveTextContent('CHF 39.20')
  expect(pro.querySelector('s')).toHaveTextContent('CHF 49')
  expect(card('Business').querySelector('s')).toBeNull()
  expect(card('Business')).toHaveTextContent('CHF 99')
  await userEvent.click(within(pro).getByRole('button', { name: 'Choose Pro' }))
  await waitFor(() =>
    expect(checkout).toEqual({ plan: 'pro', interval: 'month', promotion_code: 'LAUNCH20' }),
  )
  // Business is not covered: no code is sent.
  await userEvent.click(within(card('Business')).getByRole('button', { name: 'Choose Business' }))
  await waitFor(() => expect(checkout).toEqual({ plan: 'business', interval: 'month' }))
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
  await userEvent.click(screen.getByRole('button', { name: 'Have a promotion code?' }))
  await userEvent.type(screen.getByLabelText(/^Code\*?$/), 'TENOFF')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText('TENOFF · −CHF 10 once')).toBeInTheDocument()
  expect(card('Pro')).toHaveTextContent('CHF 39')
  expect(card('Pro').querySelector('s')).toHaveTextContent('CHF 49')
})

test('people who cannot manage billing see the plans without the way to change them', () => {
  renderCards(billing({ can_manage: false }))
  expect(within(card('Pro')).getByRole('button', { name: 'Choose Pro' })).toBeDisabled()
  expect(screen.getByText(/Only an owner or admin/)).toBeInTheDocument()
  expect(screen.queryByText('Have a promotion code?')).toBeNull()
})

test('features read from the limits', () => {
  const pro = flatBillingFixture().plans[1]
  expect(pro && planFeatures(pro)).toEqual([
    '10 members besides the owner',
    "1'000 clients",
    '300 invoices a month',
    '600 expenses a month',
    '500 products & services',
    '50 running engagements',
    '50 signature requests a month',
    '100 GB for documents and receipts',
    "5'000'000 AI tokens a month for Heidi and imports",
  ])
})

test('a larger plan lists only what grows over the one before it', () => {
  const [basic, pro] = billing().plans
  if (!basic || !pro) throw new Error('fixture has no Basic and Pro')
  const flat = { ...pro, limits: { ...pro.limits, members: basic.limits.members, products: 25 } }
  expect(planFeatures(flat, basic)).toEqual([
    "1'000 clients",
    '300 invoices a month',
    '600 expenses a month',
    '50 running engagements',
    '50 signature requests a month',
    '100 GB for documents and receipts',
    "5'000'000 AI tokens a month for Heidi and imports",
  ])
  expect(limitLine('members', 1)).toBe('1 member besides the owner')
  expect(limitLine('invoices_per_month', 100)).toBe('100 invoices a month')
})

test('a plan the workspace is over is refused with the reason, and Checkout does not open', async () => {
  server.use(
    http.post('/api/v1/billing/checkout', () =>
      HttpResponse.json(
        {
          error: {
            code: 'plan_limits_exceeded',
            message:
              'Basic allows 2 members besides the owner; this workspace has 3. Remove 1 member first.',
            details: { plan: 'basic', overages: [{ limit: 'members', used: 3, max: 2 }] },
          },
        },
        { status: 409 },
      ),
    ),
  )
  renderCards(billing())
  await userEvent.click(
    within(card('Basic')).getByRole('button', { name: 'Start 7-day free trial' }),
  )
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'Basic allows 2 members besides the owner; this workspace has 3. Remove 1 member first.',
    ),
  )
  expect(assign).not.toHaveBeenCalled()
})

test('choiceLabel names the way to each plan from the workspace’s', () => {
  const [basic, pro] = billing().plans
  if (!basic || !pro) throw new Error('fixture plans missing')
  expect(choiceLabel(billing(), basic, 'month')).toBe('Start 7-day free trial')
  expect(choiceLabel(billing(), pro, 'month')).toBe('Choose Pro')
  expect(choiceLabel(billing({ trial_available: false }), basic, 'month')).toBe('Choose Basic')
  const onPro = billing({ plan: 'pro', interval: 'month' })
  expect(choiceLabel(onPro, basic, 'month')).toBe('Switch to Basic')
  expect(choiceLabel(onPro, pro, 'year')).toBe('Switch yearly')
  expect(choiceLabel(billing({ plan: 'basic' }), pro, 'month')).toBe('Upgrade to Pro')
})

test('a plan with no member cap says any number of people', () => {
  expect(limitLine('members', null)).toBe('Any number of people')
  const pro = billing().plans[1]
  expect(pro && planFeatures(pro)[0]).toBe('Any number of people')
})

test('the current plan and the next step up are marked; Business has nothing above it', () => {
  const { unmount } = renderCards(billing({ plan: 'basic', status: 'active', interval: 'month' }))
  expect(within(card('Basic')).getByText('Current')).toBeInTheDocument()
  expect(card('Pro')).toHaveAttribute('data-recommended', 'true')
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

const proTotal = () => card('Pro').querySelector('[data-slot=team-total]')

test('every card totals the workspace’s people, with no control to pick them', () => {
  renderCards(billing())
  expect(proTotal()).toHaveTextContent('For 3 peopleCHF 147 / month')
  expect(screen.queryByRole('group', { name: 'Team size' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /people/ })).not.toBeInTheDocument()
})

test('a workspace with no seats counted yet is totalled for one person', () => {
  renderCards(billing({ seats: 0 }))
  expect(proTotal()).toHaveTextContent('For 1 personCHF 49 / month')
})

test('limits read as short facts with the key number first', () => {
  expect(planFact('clients', 50)).toEqual({ value: '50', label: 'clients' })
  expect(planFact('invoices_per_month', null)).toEqual({
    value: 'Unlimited',
    label: 'invoices / month',
  })
  expect(planFact('members', null)).toEqual({ value: 'Any number', label: 'of people' })
  expect(planFact('storage_bytes', 5 * 2 ** 30)).toEqual({ value: '5 GB', label: 'storage' })
  expect(planFact('ai_tokens_per_month', 1_000_000)).toEqual({
    value: '1M',
    label: 'AI tokens / month',
  })
})
