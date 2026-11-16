import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Billing } from '@/lib/billing'

import { sessionHandler, storySession } from '../screen-fixtures'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './frame'

const live = (over: Partial<Billing>) =>
  billingFixture({
    plan: 'basic',
    status: 'active',
    interval: 'month',
    pricing: 'per_seat',
    locked: false,
    has_customer: true,
    can_manage: true,
    current_period_end: '2026-12-01',
    ...over,
  })
// Four and a half days ahead reads as "5 days left" whenever the story runs.
const trialing = live({
  status: 'trialing',
  has_customer: false,
  trial_end: new Date(Date.now() + 4.5 * 86_400_000).toISOString(),
})
const longName = {
  ...storySession.user,
  name: 'Piotr Krajewski Gomez de la Serna',
  email: 'piotr.krajewski-gomez@example.com',
}

const page = (billing: Billing, user = storySession.user) =>
  pageParameters('/notifications', {}, [
    sessionHandler({ user }),
    http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  ])

const meta = {
  title: 'Pages/Sidebar plan',
  beforeEach: () => {
    closeHeidi()
    sessionStorage.clear()
  },
  parameters: page(trialing),
  render: () => (
    <Frame>
      <p className="p-6 text-muted-foreground">Page</p>
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)
/** On a phone the sidebar is a sheet behind the tab bar's Menu. */
async function openSidebar(canvasElement: HTMLElement) {
  const screen = body(canvasElement)
  await screen.findByRole('main', { hidden: true }, { timeout: 8000 })
  const menu = screen.queryByRole('button', { name: 'Menu' })
  if (menu?.checkVisibility()) await userEvent.click(menu)
  return screen
}
const notice = async (canvasElement: HTMLElement) =>
  within(
    await (
      await openSidebar(canvasElement)
    ).findByRole('region', { name: 'Plan' }, { timeout: 8000 }),
  )

export const Trial: Story = {
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText('Trial · 5 days left')).toBeVisible()
    await expect(card.getByRole('progressbar', { hidden: true })).toBeInTheDocument()
    await expect(card.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
    const screen = body(canvasElement)
    await expect(screen.getAllByTestId('workspace-plan')[0]).toHaveTextContent('Basic · Trial')
  },
}
export const TrialDark = dark(Trial)
export const TrialPhone = phone(Trial)

/** A 100%-forever promotion code: the card says the plan stays free instead of asking for an upgrade. */
export const TrialFreeForever: Story = {
  parameters: page({
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
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText(/then free forever\./)).toBeVisible()
    await expect(card.queryByText(/LIFETIME-135F29/)).not.toBeInTheDocument()
    await expect(card.queryByRole('link', { name: 'Upgrade' })).toBeNull()
    await expect(card.getByRole('link', { name: 'View plan' })).toHaveAttribute(
      'href',
      '/settings/billing/',
    )
  },
}
export const TrialFreeForeverPhone = phone(TrialFreeForever)

/** Hidden for the session; it stays hidden when the shell renders again. */
export const TrialHidden: Story = {
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await userEvent.click(card.getByRole('button', { name: 'Hide for this session' }))
    const screen = body(canvasElement)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Plan' })).toBeNull())
    await expect(sessionStorage.getItem('helvetly:plan-notice:wrk_story:trial')).toBe('1')
  },
}

/** A member sees the countdown but no button: only owners and admins choose plans. */
export const TrialMember: Story = {
  parameters: page({ ...trialing, can_manage: false }),
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText(/Ask an owner or admin/)).toBeVisible()
    await expect(card.queryByRole('link')).toBeNull()
  },
}

/** A chargeback is open: the plan keeps working, so the card only informs and can be hidden. */
export const PaymentDisputed: Story = {
  parameters: page(live({ disputed: true })),
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText('Payment disputed')).toBeVisible()
    await expect(card.getByText(/A payment is disputed/)).toBeVisible()
    await expect(card.queryByRole('link')).toBeNull()
    await expect(card.getByRole('button', { name: 'Hide for this session' })).toBeVisible()
  },
}
export const PaymentDisputedDark = dark(PaymentDisputed)
export const PaymentDisputedPhone = phone(PaymentDisputed)

export const PaymentFailed: Story = {
  parameters: page(live({ plan: 'pro', status: 'past_due' })),
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText('Payment failed')).toBeVisible()
    await expect(card.queryByRole('button', { name: 'Hide for this session' })).toBeNull()
    await expect(card.getByRole('link', { name: 'Update payment' })).toHaveAttribute(
      'href',
      '/settings/billing/',
    )
    await expect(body(canvasElement).getAllByTestId('workspace-plan')[0]).toHaveTextContent(
      'Pro · Payment due',
    )
  },
}
export const PaymentFailedDark = dark(PaymentFailed)

export const PlanEnding: Story = {
  parameters: page(live({ plan: 'pro', cancel_at_period_end: true })),
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText('Plan ends 1 Dec 2026')).toBeVisible()
    await expect(card.getByRole('link', { name: 'Renew plan' })).toBeVisible()
  },
}
export const PlanEndingDark = dark(PlanEnding)

/** Read-only workspaces show the plan picker everywhere but on billing, where the sidebar stays. */
export const ReadOnly: Story = {
  parameters: {
    ...page(live({ plan: '', status: 'canceled', locked: true })),
    nextjs: { navigation: { pathname: '/settings/billing', query: {} } },
  },
  render: () => (
    <Frame>
      <p className="p-6 text-muted-foreground">Billing</p>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const card = await notice(canvasElement)
    await expect(card.getByText('Read-only workspace')).toBeVisible()
    await expect(card.getByRole('link', { name: 'Choose a plan' })).toBeVisible()
  },
}

/** A paid plan says nothing in the sidebar; the switcher names the plan. */
export const PaidPlan: Story = {
  parameters: page(live({ plan: 'pro' })),
  play: async ({ canvasElement }) => {
    const screen = await openSidebar(canvasElement)
    await waitFor(() =>
      expect(screen.getAllByTestId('workspace-plan')[0]).toHaveTextContent(/^Pro$/),
    )
    await expect(screen.queryByRole('region', { name: 'Plan' })).toBeNull()
  },
}

/** A long name reads in full: two lines on the button, the menu wraps it instead of a badge squeezing it. */
export const LongName: Story = {
  parameters: page(live({ plan: 'pro' }), longName),
  play: async ({ canvasElement }) => {
    const screen = await openSidebar(canvasElement)
    const button = await screen.findByRole('button', { name: /Piotr Krajewski/ }, { timeout: 8000 })
    await expect(button).toHaveTextContent(longName.email)
    await userEvent.click(button)
    const menu = await screen.findByRole('menu')
    // The menu fades in.
    await waitFor(() => expect(within(menu).getByText('Owner')).toBeVisible())
    // The workspace is not repeated here; the role badge sits to the right, inside the menu.
    await expect(within(menu).queryByText('Muster AG')).toBeNull()
    const badge = within(menu).getByText('Owner')
    await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(
      menu.getBoundingClientRect().right,
    )
    const name = within(menu).getByTitle(longName.name)
    // Wrapped, not cut: the whole name fits within two lines.
    await expect(name.scrollHeight).toBeLessThanOrEqual(name.clientHeight + 1)
    // Closed again: an open modal menu hides the page from the accessibility check that follows.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  },
}
export const LongNameDark = dark(LongName)
export const LongNamePhone = phone(LongName)
