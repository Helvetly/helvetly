import {
  type BillingInterval,
  BillingIntervalToggle,
} from '@helvetly/ui/components/billing-interval-toggle'
import { PlanCard, PlanPrice, type PlanPrices } from '@helvetly/ui/components/plan-card'
import { PlanComparison } from '@helvetly/ui/components/plan-comparison'
import {
  PLAN_IDS,
  type PlanCatalogue,
  planCards,
  planComparison,
  type PlanId,
  ROW_FEATURES,
} from '@helvetly/ui/lib/plan-features'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

const meta = {
  title: 'Billing/Plan cards and comparison',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// The offer helvetly-v1 as the API publishes it (apps/web/src/lib/public-offer.golden.json), trimmed to what the
// cards and the table read.
const CHEAPEST: Partial<Record<string, PlanId>> = {
  heidi: 'pro',
  ai_import: 'pro',
  automations: 'pro',
  invoice_reminders: 'pro',
  invoice_instalments: 'pro',
  invoice_corrections: 'pro',
  engagement_automation: 'pro',
  document_templates: 'pro',
  simple_signatures: 'pro',
  vat_returns: 'pro',
  ledger_exports: 'pro',
  data_export: 'pro',
  remove_branding: 'pro',
  client_portal: 'business',
  custom_portal_domain: 'business',
  einvoice_xml: 'business',
  employees: 'business',
  document_approvals: 'business',
}
const plansFrom = (cheapest: PlanId) => {
  const has = (id: PlanId) => PLAN_IDS.indexOf(id) >= PLAN_IDS.indexOf(cheapest)
  return { free: has('free'), basic: has('basic'), pro: has('pro'), business: has('business') }
}
const allowance = (
  period: string | null,
  free: number,
  basic: number,
  pro: number,
  business: number | null,
) => ({
  period,
  plans: {
    free: { included: free !== 0, value: free },
    basic: { included: basic !== 0, value: basic },
    pro: { included: pro !== 0, value: pro },
    business: { included: business !== 0, value: business },
  },
})
const MONTH = 'calendar_month_utc'
const OFFER: PlanCatalogue = {
  plans: [
    { id: 'free', name: 'Free' },
    { id: 'basic', name: 'Basic' },
    { id: 'pro', name: 'Pro' },
    { id: 'business', name: 'Business' },
  ],
  features: Object.fromEntries(
    ROW_FEATURES.map((key) => [key, plansFrom(CHEAPEST[key] ?? 'free')]),
  ),
  max_self_service_seats: { free: 1, basic: 5, pro: 25, business: null },
  limits: {
    clients: allowance(null, 5, 30, 300, null),
    products: allowance(null, 10, 25, 250, null),
    engagements: allowance(null, 1, 3, 20, null),
    invoices_per_month: allowance(MONTH, 3, 15, 100, null),
    quotes_per_month: allowance(MONTH, 3, 5, 100, null),
    expenses_per_month: allowance(MONTH, 1, 10, 300, null),
    scheduled_events_per_month: allowance(MONTH, 3, 10, 100, null),
    signatures_per_month: allowance(MONTH, 0, 0, 50, null),
    storage_bytes: allowance(null, 100e6, 500e6, 5e9, 20e9),
    emails_per_month: allowance(MONTH, 20, 100, 500, 2000),
    ai_tokens_per_month: allowance(MONTH, 0, 0, 5e6, 20e6),
    ai_automation_tokens_per_month: allowance(MONTH, 0, 0, 5e6, 20e6),
    automation_actions_per_month: allowance(MONTH, 0, 0, 1500, 6000),
  },
}
const price = (month: number, year: number, people: number, extra: number, extraYear: number) => ({
  month,
  year,
  included_people: people,
  extra_person_month: extra,
  extra_person_year: extraYear,
})
const PRICES: Record<PlanId, PlanPrices> = {
  free: price(0, 0, 1, 0, 0),
  basic: price(1900, 18300, 1, 1000, 9600),
  pro: price(4900, 47100, 2, 1500, 14400),
  business: price(14900, 143100, 5, 2000, 19200),
}

const button = (label: string) => (
  <button
    type="button"
    className="inline-flex h-10 w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
  >
    {label}
  </button>
)

function CardsView() {
  const [interval, setInterval] = useState<BillingInterval>('year')
  return (
    <div className="grid gap-8">
      <BillingIntervalToggle value={interval} onValueChange={setInterval} className="mx-auto" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {planCards(OFFER, 'en').map((card) => (
          <PlanCard
            key={card.plan}
            data={card}
            featured={card.plan === 'pro'}
            price={<PlanPrice prices={PRICES[card.plan]} interval={interval} currency="chf" />}
            cta={button(card.plan === 'free' ? 'Start free' : `Choose ${card.name}`)}
          />
        ))}
      </div>
    </div>
  )
}

/** The four cards: lead features in bold, the rest by group, the limits, and prices that follow the toggle. */
export const Cards: Story = {
  render: () => <CardsView />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [free, basic, pro, business] = canvas.getAllByRole('article')
    if (!free || !basic || !pro || !business) throw new Error('four plan cards expected')
    await expect(within(free).getByText('1 person · free forever')).toBeVisible()
    await expect(within(free).getByText('No card needed')).toBeVisible()
    await expect(within(basic).getByText('Everything in Free, with more room:')).toBeVisible()
    await expect(within(pro).getByText('39.25')).toBeVisible()
    await expect(within(pro).getByText('Billed CHF 471 yearly · you save CHF 117')).toBeVisible()
    await expect(within(business).getByText('Everything in Pro, plus:')).toBeVisible()
    await expect(
      within(business).getByText('White-labelled client portal on your own domain'),
    ).toBeVisible()
    await expect(canvasElement.textContent).not.toContain('∞')

    await userEvent.click(canvas.getByRole('radio', { name: 'Monthly' }))
    await expect(within(pro).getByText('49')).toBeVisible()
    await expect(
      within(pro).getByText('2 people included · +CHF 15 per extra person'),
    ).toBeVisible()
  },
}

/** The comparison table below the cards: every row, grouped as the cards, with a (?) where it helps. */
export const Comparison: Story = {
  render: () => (
    <PlanComparison
      groups={planComparison(OFFER, 'en')}
      featured="pro"
      plans={OFFER.plans.map((plan) => ({
        ...plan,
        head: <span className="mt-3 block">{button(`Choose ${plan.name}`)}</span>,
      }))}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Compare every feature' })
    const row = (name: string) =>
      within(within(table).getByRole('rowheader', { name }).closest('tr') ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    await expect(row('Invoices')).toEqual(['3 / month', '15 / month', '100 / month', 'Unlimited'])
    await expect(row('E-signatures')).toEqual([
      'Not included',
      'Not included',
      '50 / month',
      'Unlimited',
    ])
    await expect(row('Developer API & MCP')).toEqual([
      'Not included',
      'Not included',
      'Included',
      'Included',
    ])
    await userEvent.click(within(table).getByRole('button', { name: 'About E-invoices (XML)' }))
    await expect(await within(document.body).findByText(/Factur-X \/ ZUGFeRD/)).toBeVisible()
  },
}
