import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture, flatBillingFixture } from '@/components/billing/billing-fixture'
import { BillingSettings } from '@/components/billing/billing-settings'
import { ChangePlan } from '@/components/billing/change-plan'
import { InviteDialog } from '@/components/members/invite-dialog'
import { MembersPage } from '@/components/members/members-page'
import type { Billing } from '@/lib/billing'
import type { Member } from '@/lib/members'

import { screenHandlers } from './screen-fixtures'

const details = {
  payment_method: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2028 },
  invoices: [],
}
const handlers = (billing: Billing) => [
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  http.get('/api/v1/billing/details', () => HttpResponse.json({ data: details })),
  ...screenHandlers,
]
const live = {
  locked: false,
  trial_available: false,
  status: 'active',
  has_customer: true,
  current_period_end: '2026-12-01',
} satisfies Partial<Billing>
const perSeat = (over: Partial<Billing> = {}) =>
  billingFixture({
    ...live,
    plan: 'pro',
    interval: 'month',
    pricing: 'per_seat',
    seats: 3,
    ...over,
  })
const flat = (over: Partial<Billing> = {}) =>
  flatBillingFixture({ ...live, plan: 'pro', interval: 'month', ...over })

const meta = {
  title: 'Financial overview/Per-seat pricing',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: {
    options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
  },
}
const mobile = { globals: { viewport: { value: 'phone' } } }

const settings = (billing: Billing) => ({
  parameters: {
    nextjs: { navigation: { pathname: '/settings/billing' } },
    msw: { handlers: handlers(billing) },
  },
  render: () => (
    <SidebarProvider>
      <div className="flex min-w-0 flex-1 flex-col">
        <BillingSettings />
      </div>
    </SidebarProvider>
  ),
})

/** The hero's price block and its "what comes next" panel. */
const price = (canvas: HTMLElement) => canvas.querySelector('[data-slot=plan-price]')
const nextStep = (canvas: HTMLElement) => canvas.querySelector('[data-slot=plan-next]')
const tile = (canvas: ReturnType<typeof within>, name: string) =>
  within(canvas.getByRole('region', { name }))

export const PerSeatSummary: Story = {
  ...settings(perSeat()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Current plan' }))
    await expect(price(canvasElement)).toHaveTextContent(
      /CHF 49 per person × 3 people\s*CHF 147\s*\/ month/,
    )
    await expect(summary.getByText('Renews on 1 Dec 2026')).toBeVisible()
    await expect(nextStep(canvasElement)).toHaveTextContent('Next charge CHF 147.')
    await expect(
      summary.queryByRole('button', { name: 'About the flat price' }),
    ).not.toBeInTheDocument()
  },
}

export const PerSeatSummaryDark: Story = {
  ...PerSeatSummary,
  parameters: { ...PerSeatSummary.parameters, dark: true },
}

export const PerSeatSummaryMobile: Story = {
  ...PerSeatSummary,
  parameters: { ...PerSeatSummary.parameters, ...phone },
  ...mobile,
}

export const PerSeatYearlySummary: Story = {
  ...settings(perSeat({ plan: 'basic', interval: 'year', seats: 2 })),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('region', { name: 'Current plan' })
    await expect(price(canvasElement)).toHaveTextContent(
      /CHF 183 per person × 2 people\s*CHF 366\s*\/ year/,
    )
  },
}

export const FlatLegacySummary: Story = {
  ...settings(flat()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = within(await canvas.findByRole('region', { name: 'Current plan' }))
    // A flat price is one figure, no sum; why it is flat is a quiet tooltip.
    await expect(price(canvasElement)).toHaveTextContent(
      /Flat price for the workspace\s*CHF 49\s*\/ month/,
    )
    await expect(price(canvasElement)).not.toHaveTextContent(/per person/)
    await userEvent.hover(summary.getByRole('button', { name: 'About the flat price' }))
    await expect(
      await within(document.body).findByRole('tooltip', {}, { timeout: 3000 }),
    ).toHaveTextContent(
      'An earlier flat price for the whole workspace. It moves to per-person pricing with the next change of plan or billing interval.',
    )
  },
}

export const FlatLegacySummaryDark: Story = {
  ...FlatLegacySummary,
  parameters: { ...FlatLegacySummary.parameters, dark: true },
}

export const PlanTilesPerPerson: Story = {
  parameters: {
    ownMain: true,
    nextjs: { navigation: { pathname: '/settings/billing/plans' } },
    msw: { handlers: handlers(perSeat()) },
  },
  render: () => <ChangePlan />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('region', { name: 'Basic' })
    await expect(canvas.getByText(/3 people in this workspace now/)).toBeVisible()
    const basic = tile(canvas, 'Basic')
    const total = (plan: string) =>
      canvas.getByRole('region', { name: plan }).querySelector('[data-slot=team-total]')
    await expect(basic.getByText('per person / month · incl. VAT')).toBeVisible()
    await expect(total('Basic')).toHaveTextContent('For 3 peopleCHF 57 / month')
    await expect(basic.getByText('Any number')).toBeVisible()
    await expect(total('Business')).toHaveTextContent('For 3 peopleCHF 297 / month')
    // Seats follow the workspace's people: nobody picks a number here.
    await expect(canvas.queryByRole('button', { name: 'More people' })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('radio', { name: 'Yearly' }))
    await expect(basic.getByText('per person / year · incl. VAT')).toBeVisible()
    await expect(total('Basic')).toHaveTextContent('For 3 peopleCHF 549 / year')
    await expect(basic.getByText('CHF 15.25 a month, billed yearly')).toBeVisible()
    await expect(basic.getByText('Save CHF 45 a year')).toBeVisible()
  },
}

export const PlanTilesPerPersonMobile: Story = {
  ...PlanTilesPerPerson,
  parameters: { ...PlanTilesPerPerson.parameters, ...phone },
  ...mobile,
}

export const PlanTilesPerPersonDark: Story = {
  ...PlanTilesPerPerson,
  parameters: { ...PlanTilesPerPerson.parameters, dark: true },
}

const invite = (billing: Billing) => ({
  parameters: { msw: { handlers: handlers(billing) } },
  render: () => <InviteDialog actorRole="owner" onClose={() => {}} />,
})
const hint = /once accepted/

export const InviteWithCost: Story = {
  ...invite(perSeat()),
  play: async () => {
    const body = within(document.body)
    const note = await body.findByText('Adds CHF 49 / month incl. VAT once accepted')
    // The sheet fades in.
    await waitFor(() => expect(note).toBeVisible())
    await expect(body.getByRole('button', { name: 'Send invitation' })).toBeVisible()
  },
}

export const InviteWithCostDark: Story = {
  ...InviteWithCost,
  parameters: { ...InviteWithCost.parameters, dark: true },
}

export const InviteWithCostMobile: Story = {
  ...InviteWithCost,
  parameters: { ...InviteWithCost.parameters, ...phone },
  ...mobile,
}

export const InviteWithoutCostFlat: Story = {
  ...invite(flat()),
  play: async () => {
    const body = within(document.body)
    await body.findByRole('button', { name: 'Send invitation' })
    // Give the billing request time to land before asserting nothing appears.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(body.queryByText(hint)).not.toBeInTheDocument()
  },
}

export const InviteWithoutCostBillingOff: Story = {
  ...invite(perSeat({ enabled: false })),
  play: InviteWithoutCostFlat.play,
}

const member = (over: Partial<Member>): Member => ({
  user_id: 'usr_story',
  name: 'Anna Muster',
  email: 'anna@example.com',
  avatar_url: null,
  role: 'owner',
  scopes: null,
  joined_at: '2026-01-05T09:00:00Z',
  last_active_at: null,
  is_you: true,
  ...over,
})
const team = [
  member({}),
  member({
    user_id: 'usr_2',
    name: 'Lena Huber',
    email: 'lena@example.com',
    role: 'member',
    scopes: [],
    is_you: false,
  }),
]
const members = (billing: Billing) => ({
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/members', () => HttpResponse.json({ data: team })),
        http.get('/api/v1/members/invitations', () => HttpResponse.json({ data: [] })),
        ...handlers(billing),
      ],
    },
  },
  render: () => (
    <SidebarProvider>
      <MembersPage />
    </SidebarProvider>
  ),
})

const askRemove = async (canvasElement: HTMLElement) => {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: 'Actions for Lena Huber' }),
  )
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: 'Remove from workspace' }),
  )
  return within(await within(document.body).findByRole('dialog'))
}

export const RemoveMemberShowsSaving: Story = {
  ...members(perSeat()),
  play: async ({ canvasElement }) => {
    const dialog = await askRemove(canvasElement)
    await waitFor(() =>
      expect(
        dialog.getByText(/Saves CHF 49 \/ month incl\. VAT, prorated by Stripe\./),
      ).toBeVisible(),
    )
  },
}

export const RemoveMemberShowsSavingDark: Story = {
  ...RemoveMemberShowsSaving,
  parameters: { ...RemoveMemberShowsSaving.parameters, dark: true },
}

export const RemoveMemberFlatNoSaving: Story = {
  ...members(flat()),
  play: async ({ canvasElement }) => {
    const dialog = await askRemove(canvasElement)
    // The dialog fades in.
    await waitFor(() => expect(dialog.getByText(/They lose access/)).toBeVisible())
    await expect(dialog.queryByText(/Saves/)).not.toBeInTheDocument()
  },
}
