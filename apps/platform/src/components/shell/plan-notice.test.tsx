import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Billing } from '@/lib/billing'

import { planLabel, planNotice, SidebarPlanNotice } from './plan-notice'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const live = (over: Partial<Billing>) =>
  billingFixture({ locked: false, plan: 'basic', status: 'active', can_manage: true, ...over })
const trial = live({ status: 'trialing', trial_end: '2026-11-16T12:00:00Z', trial_days: 7 })

test.each<[string, Partial<Billing> | undefined, string | null]>([
  ['billing off', { enabled: false }, null],
  ['no plan', { locked: true, plan: '' }, 'No plan · Read-only'],
  ['trial', { status: 'trialing' }, 'Basic · Trial'],
  ['past due', { plan: 'pro', status: 'past_due' }, 'Pro · Payment due'],
  ['unpaid', { status: 'unpaid' }, 'Basic · Payment due'],
  ['active', { plan: 'business' }, 'Business'],
])('planLabel: %s', (_, over, expected) => {
  expect(planLabel(over ? live(over) : undefined)).toBe(expected)
})

test('planLabel is null while billing loads', () => {
  expect(planLabel(undefined)).toBeNull()
})

test.each<[string, Partial<Billing>, ReturnType<typeof planNotice>]>([
  ['billing off', { enabled: false }, null],
  ['a paid plan', {}, null],
  [
    'a read-only workspace',
    { locked: true, plan: '', status: 'canceled' },
    expect.objectContaining({
      kind: 'locked',
      tone: 'danger',
      dismissable: false,
      action: { label: 'Choose a plan', href: '/settings/billing/plans' },
    }),
  ],
  [
    'a failed payment',
    { status: 'past_due' },
    expect.objectContaining({
      kind: 'payment',
      dismissable: false,
      action: { label: 'Update payment', href: '/settings/billing' },
    }),
  ],
  [
    'a disputed payment, ahead of the trial',
    { disputed: true, status: 'trialing', trial_end: '2026-11-16T12:00:00Z' },
    expect.objectContaining({ kind: 'disputed', tone: 'warning', action: null, dismissable: true }),
  ],
  [
    'a trial',
    { status: 'trialing', trial_end: '2026-11-16T12:00:00Z', trial_days: 7 },
    expect.objectContaining({
      kind: 'trial',
      title: 'Trial · 5 days left',
      progress: { left: 5, of: 7 },
      dismissable: true,
      action: { label: 'Upgrade', href: '/settings/billing/plans' },
    }),
  ],
  [
    'the trial’s last day',
    { status: 'trialing', trial_end: '2026-11-12T20:00:00Z', trial_days: 7 },
    expect.objectContaining({ title: 'Trial · 1 day left' }),
  ],
  [
    'a trial already over',
    { status: 'trialing', trial_end: '2026-11-11T20:00:00Z', trial_days: 7 },
    expect.objectContaining({ title: 'Trial ends today', progress: { left: 0, of: 7 } }),
  ],
  [
    'a cancelled plan still running',
    { cancel_at_period_end: true, current_period_end: '2026-12-01' },
    expect.objectContaining({ kind: 'ending', title: 'Plan ends 1 Dec 2026', tone: 'warning' }),
  ],
])('planNotice: %s', (_, over, expected) => {
  expect(planNotice(live(over), NOW)).toEqual(expected)
})

test('people who cannot manage billing are asked to turn to an owner, with no button', () => {
  const notice = planNotice({ ...trial, can_manage: false }, NOW)
  expect(notice?.action).toBeNull()
  expect(notice?.text).toMatch(/Ask an owner or admin/)
  expect(planNotice(live({ status: 'past_due', can_manage: false }), NOW)?.text).toMatch(
    /Ask an owner or admin/,
  )
})

const lifetime = {
  code: 'LIFETIME-1',
  percent_off: 100,
  amount_off: null,
  currency: null,
  duration: 'forever',
  duration_in_months: null,
  ends_at: null,
} as const
const launch = {
  ...lifetime,
  code: 'LAUNCH20',
  percent_off: 20,
  duration: 'repeating',
  duration_in_months: 3,
} as const

test.each<[string, Partial<Billing>, string]>([
  [
    'free forever',
    { discount: lifetime },
    'Basic until 16 Nov 2026, then free forever with code LIFETIME-1.',
  ],
  ['a partial discount', { discount: launch, pricing: 'flat', interval: 'month' }, 'then CHF'],
  ['an unknown price', { discount: launch }, 'then code LAUNCH20 (−20 % for 3 months) applies.'],
  [
    'a partial discount',
    { discount: launch, pricing: 'flat', interval: 'month' },
    'with code LAUNCH20 (−20 % for 3 months).',
  ],
])('a trial under a promotion code says what follows: %s', (_, over, text) => {
  const notice = planNotice({ ...trial, ...over }, NOW)
  expect(notice?.text).toContain(text)
  expect(notice?.action).toEqual({ label: 'View plan', href: '/settings/billing' })
  expect(planNotice({ ...trial, ...over, can_manage: false }, NOW)?.action).toBeNull()
})

test('a cancelled trial keeps its read-only warning despite a code', () => {
  expect(
    planNotice({ ...trial, discount: lifetime, cancel_at_period_end: true }, NOW)?.text,
  ).toMatch(/turns read-only/)
})

const renderNotice = (billing: Billing) =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <SidebarPlanNotice billing={billing} workspaceId="w1" />
      </SidebarProvider>
    </TooltipProvider>,
  )

beforeEach(() => window.sessionStorage.clear())

test('the trial card links to the plans and hides for the session', async () => {
  const { unmount } = renderNotice(
    live({ status: 'trialing', trial_end: new Date(Date.now() + 4.5 * 86_400_000).toISOString() }),
  )
  const card = screen.getByRole('region', { name: 'Plan' })
  expect(card).toHaveTextContent('Trial · 5 days left')
  expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
    'href',
    '/settings/billing/plans',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Hide for this session' }))
  expect(screen.queryByRole('region', { name: 'Plan' })).not.toBeInTheDocument()
  unmount()
  renderNotice(
    live({ status: 'trialing', trial_end: new Date(Date.now() + 4.5 * 86_400_000).toISOString() }),
  )
  expect(screen.queryByRole('region', { name: 'Plan' })).not.toBeInTheDocument()
})

test('a failed payment cannot be hidden', () => {
  window.sessionStorage.setItem('helvetly:plan-notice:w1:payment', '1')
  renderNotice(live({ status: 'past_due' }))
  expect(screen.getByRole('region', { name: 'Plan' })).toHaveTextContent('Payment failed')
  expect(screen.queryByRole('button', { name: 'Hide for this session' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Update payment' })).toHaveAttribute(
    'href',
    '/settings/billing',
  )
})
