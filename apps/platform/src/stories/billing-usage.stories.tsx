import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { billingFixture, entitlementsFixture } from '@/components/billing/billing-fixture'
import { UsageOverview } from '@/components/billing/usage-overview'
import type { Billing, Entitlement, PlanId } from '@/lib/billing'

/** A paid workspace on `plan` whose usage panel reads the offer's entitlements. */
const onPlan = (
  plan: PlanId,
  used: Record<string, number | null>,
  over: Record<string, Partial<Entitlement>> = {},
  seats = 1,
): Billing =>
  billingFixture({
    plan,
    status: 'active',
    locked: false,
    interval: 'month',
    pricing: 'per_seat',
    seats,
    entitlements: entitlementsFixture(plan, { seats, used, over }),
  })

const meta = {
  title: 'Financial overview/Usage',
  args: { billing: onPlan('basic', { clients: 12, invoices_per_month: 5 }) },
  render: ({ billing }) => (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <UsageOverview billing={billing} />
    </div>
  ),
} satisfies Meta<{ billing: Billing }>
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}

const tile = (canvas: HTMLElement, label: string) => {
  const found = within(canvas).getByText(label, { exact: true }).closest('[data-slot=usage-meter]')
  if (!(found instanceof HTMLElement)) throw new Error(`no tile ${label}`)
  return found
}

/** Room everywhere: no nudge; workspace caps and per-team-member pools say which they are; Basic's exclusions read so. */
export const Normal: Story = {
  args: {
    billing: onPlan('basic', {
      clients: 12,
      invoices_per_month: 5,
      quotes_per_month: 2,
      storage_bytes: 120_000_000,
      ai_tokens_per_month: 40_000,
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot=usage-nudge]')).toBeNull()
    await expect(tile(canvasElement, 'Clients')).toHaveTextContent('12of 30')
    await expect(tile(canvasElement, 'Clients')).toHaveTextContent('Per workspace')
    await expect(tile(canvasElement, 'Invoice issues')).toHaveTextContent(
      'Per team member, shared · Resets 1 Dec, 00:00 UTC',
    )
    await expect(tile(canvasElement, 'Quotes sent')).toHaveTextContent('2of 5')
    await expect(tile(canvasElement, 'Storage')).toHaveTextContent('120 MBof 500 MB')
    await expect(tile(canvasElement, 'Expenses')).toHaveAttribute('data-state', 'off')
    await expect(tile(canvasElement, 'Expenses')).toHaveTextContent('Not included')
    const automated = tile(canvasElement, 'Automated actions')
    await expect(automated).toHaveTextContent('Not included')
    // what counts is explained in a help tip, not on the tile
    await userEvent.hover(
      within(automated).getByRole('button', { name: 'About Automated actions' }),
    )
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      /^Each automatic step counts once/,
    )
  },
}
export const NormalDark: Story = { ...Normal, parameters: { dark: true } }
export const NormalPhone: Story = { ...Normal, ...phone }

/** 12 of 15 invoice issues: orange, first, with what Pro gives per team member. */
export const NearLimit: Story = {
  args: { billing: onPlan('basic', { invoices_per_month: 12, clients: 4 }) },
  play: async ({ canvasElement }) => {
    const issues = tile(canvasElement, 'Invoice issues')
    await expect(canvasElement.querySelector('[data-slot=usage-meter]')).toBe(issues)
    await expect(issues).toHaveAttribute('data-state', 'near')
    await expect(within(issues).getByText('Almost at limit')).toBeVisible()
    const nudge = canvasElement.querySelector<HTMLElement>('[data-slot=usage-nudge]')
    await expect(nudge).toHaveTextContent(
      'Invoice issues: almost at the plan’s limit. Pro includes 100 invoice issues a month per team member.',
    )
    await expect(
      within(nudge ?? canvasElement).getByRole('link', { name: 'See Pro' }),
    ).toHaveAttribute('href', '/settings/billing/plans/')
  },
}
export const NearLimitDark: Story = { ...NearLimit, parameters: { dark: true } }
export const NearLimitPhone: Story = { ...NearLimit, ...phone }

/** 15 of 15: red; issuing stops, drafts are kept. */
export const AtLimit: Story = {
  args: { billing: onPlan('basic', { invoices_per_month: 15 }) },
  play: async ({ canvasElement }) => {
    await expect(tile(canvasElement, 'Invoice issues')).toHaveAttribute('data-state', 'full')
    await expect(within(canvasElement).getByText('Limit reached')).toBeVisible()
    await expect(canvasElement.querySelector('[data-slot=usage-nudge]')).toHaveTextContent(
      'Invoice issues: the plan’s limit is reached. Drafts stay saved and can be issued once the allowance resets or the plan grows.',
    )
  },
}
export const AtLimitDark: Story = { ...AtLimit, parameters: { dark: true } }

/**
 * Business: no cap on clients, products, engagements, invoices, quotes, expenses and signatures; the count with
 * "of unlimited" and no meter to fill, never under pressure. An operator's unlimited value reads the same.
 */
export const Unlimited: Story = {
  args: {
    billing: onPlan(
      'business',
      { clients: 2400, quotes_per_month: 310, invoices_per_month: 640, emails_per_month: 820 },
      { emails_per_month: { state: 'unlimited', value: null } },
      2,
    ),
  },
  play: async ({ canvasElement }) => {
    for (const [label, used] of [
      ['Clients', "2'400"],
      ['Products & services', '0'],
      ['Active engagements', '0'],
      ['Invoice issues', '640'],
      ['Quotes sent', '310'],
      ['Expenses', '0'],
      ['Signature requests', '0'],
      ['Email recipients', '820'],
    ] as const) {
      const found = tile(canvasElement, label)
      expect(found).toHaveTextContent(`${used}of unlimited`)
      expect(found).toHaveAttribute('data-state', 'ok')
      expect(found).not.toHaveTextContent(/∞|NaN|-1|Not included/)
      expect(found.querySelector('[data-slot=meter]')).toBeNull()
    }
    await expect(tile(canvasElement, 'Storage')).toHaveTextContent('of 40 GB')
    await expect(canvasElement.querySelector('[data-slot=usage-nudge]')).toBeNull()
  },
}
export const UnlimitedDark: Story = { ...Unlimited, parameters: { dark: true } }

/** A custom limit for this workspace, with its end; pooled Pro allowances for three paid people. */
export const Override: Story = {
  args: {
    billing: onPlan(
      'pro',
      { clients: 280, invoices_per_month: 90 },
      { clients: { source: 'workspace', value: 400, expires_at: '2027-01-31T00:00:00Z' } },
      3,
    ),
  },
  play: async ({ canvasElement }) => {
    const clients = tile(canvasElement, 'Clients')
    await expect(clients).toHaveTextContent('280of 400')
    await expect(within(clients).getByText(/^Custom limit until/)).toBeVisible()
    // 100 per team member × 3, one pool
    await expect(tile(canvasElement, 'Invoice issues')).toHaveTextContent('90of 300')
    await expect(tile(canvasElement, 'Quotes sent')).toHaveTextContent('0of 300')
  },
}
export const OverrideDark: Story = { ...Override, parameters: { dark: true } }
export const OverridePhone: Story = { ...Override, ...phone }

/** A count the API does not report yet reads as such, not as zero. */
export const NotCountedYet: Story = {
  args: { billing: onPlan('pro', { download_bytes_per_month: null }) },
  play: async ({ canvasElement }) => {
    const downloads = tile(canvasElement, 'File downloads')
    await expect(downloads).toHaveTextContent('—of 20 GB')
    await expect(within(downloads).getByText('Not counted yet')).toBeVisible()
  },
}

/** The trial: Business's allowances for the whole trial, without a monthly reset or growth per person. */
export const Trial: Story = {
  args: {
    billing: {
      ...onPlan(
        'business',
        { clients: 4, invoices_per_month: 6, quotes_per_month: 3, ai_tokens_per_month: 900_000 },
        {
          // the trial's own allowances replace Business's unlimited ones
          clients: { state: 'limited', value: 100 },
          invoices_per_month: { state: 'limited', value: 10, reset_at: null, per_seat: false },
          quotes_per_month: { state: 'limited', value: 10, reset_at: null, per_seat: false },
          ai_tokens_per_month: { reset_at: null, per_seat: false },
          emails_per_month: { reset_at: null, per_seat: false },
        },
      ),
      status: 'trialing',
      trial: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Usage' })).toHaveTextContent(
      'For the whole trial',
    )
    await expect(canvas.queryByText(/This month since/)).toBeNull()
    await expect(tile(canvasElement, 'Invoice issues')).toHaveTextContent('For the whole trial')
    await expect(tile(canvasElement, 'Clients')).not.toHaveTextContent('For the whole trial')
    await expect(tile(canvasElement, 'Quotes sent')).toHaveTextContent('3of 10')
    await expect(canvas.queryByText(/Resets|Per team member/)).toBeNull()
  },
}

export const TrialPhone: Story = { ...Trial, ...phone }
