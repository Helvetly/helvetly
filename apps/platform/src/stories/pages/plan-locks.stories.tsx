import { Button } from '@helvetly/ui/components/button'
import { Input } from '@helvetly/ui/components/input'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useMutation } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { featureLock, LockedArea } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { ExpensesPage } from '@/components/expenses/expenses-page'
import { Providers } from '@/components/providers'
import { LedgerPage } from '@/components/settings/ledger'
import { request } from '@/lib/api'
import type { Billing } from '@/lib/billing'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './frame'

const basic = billingFixture({
  plan: 'basic',
  status: 'active',
  interval: 'month',
  pricing: 'per_seat',
  locked: false,
  has_customer: true,
})
const billingIs = (billing: Billing) =>
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing }))

const meta = {
  title: 'Pages/Plan locks',
  beforeEach: closeHeidi,
  parameters: pageParameters('/expenses', {}, [billingIs(basic)]),
  render: () => (
    <Frame>
      <ExpensesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
/** A toast slides in: found at once, visible a moment later. */
const toastShows = async (text: string) => {
  const found = await body().findByText(text)
  await waitFor(() => expect(found).toBeVisible())
}

/**
 * Basic has no expenses or Heidi: the page says so with the way to Pro, adds nothing new and keeps what there is; the
 * sidebar tags both entry points with the plan that has them, and Heidi's opens a toast instead of her panel.
 */
export const ExpensesOnBasic: Story = {
  play: async () => {
    const screen = body()
    const notice = await screen.findByText(
      /Your plan doesn’t include expenses; Pro does\./,
      {},
      { timeout: 8000 },
    )
    await expect(notice.closest('[data-slot=feature-lock-notice]')).toHaveTextContent(
      'Expenses you already have stay available to read.',
    )
    await expect(screen.getByRole('link', { name: 'See Pro' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
    await expect(screen.queryByRole('button', { name: 'New expense' })).toBeNull()
    const nav = screen.getByRole('link', { name: /^Expenses/ })
    await expect(within(nav).getByText('Pro')).toBeVisible()
    const heidi = screen.getByRole('button', { name: /^Ask Heidi/ })
    await expect(heidi.querySelector('[data-slot=plan-tag]')).toHaveTextContent('Pro')
    await userEvent.click(heidi)
    await toastShows('Your plan doesn’t include Heidi; Pro does.')
    // her panel stays shut
    await expect(
      screen.getByRole('complementary', { hidden: true, name: 'Heidi' }),
    ).toHaveAttribute('inert')
  },
}
export const ExpensesOnBasicDark = dark(ExpensesOnBasic)
export const ExpensesOnBasicPhone: Story = {
  ...phone(ExpensesOnBasic),
  // the phone's tab bar has no sidebar tags: the page's notice is the entry point there
  play: async () => {
    const screen = body()
    await expect(
      await screen.findByText(
        /Your plan doesn’t include expenses; Pro does\./,
        {},
        { timeout: 8000 },
      ),
    ).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'New expense' })).toBeNull()
  },
}

/** The ledger on Basic: the notice instead of the report, and the report is not even asked for. */
export const LedgerOnBasic: Story = {
  parameters: pageParameters('/books/ledger', {}, [
    billingIs(basic),
    http.get('/api/v1/ledger', () => {
      throw new Error('the ledger is asked for on a plan without it')
    }),
  ]),
  render: () => (
    <Frame>
      <LedgerPage />
    </Frame>
  ),
  play: async () => {
    const screen = body()
    await expect(
      await screen.findByText(
        /Your plan doesn’t include the ledger; Pro does\./,
        {},
        { timeout: 8000 },
      ),
    ).toBeVisible()
    await expect(screen.queryByRole('button', { name: /Export/ })).toBeNull()
  },
}
export const LedgerOnBasicDark = dark(LedgerOnBasic)

/** A change as a screen makes it: its own onError after the app's one error path (Providers' MutationCache). */
const useChange = (path: string) =>
  useMutation({ mutationFn: () => request(path, { method: 'POST' }), onError: toastError })

function Refusals() {
  const feature = useChange('/test/feature')
  const noPlan = useChange('/test/no-plan')
  const limit = useChange('/test/limit')
  return (
    <div className="flex flex-wrap gap-2 p-6">
      <Button onClick={() => feature.mutate()}>Add an expense</Button>
      <Button onClick={() => noPlan.mutate()}>Add a client</Button>
      <Button onClick={() => limit.mutate()}>Issue an invoice</Button>
    </div>
  )
}

const refuse = (status: number, code: string, message: string, details: object) =>
  HttpResponse.json({ error: { code, message, details } }, { status })

export const PlanErrorToasts: Story = {
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        billingIs(basic),
        http.post('/api/v1/test/feature', () =>
          refuse(403, 'feature_not_in_plan', 'Expenses are not part of the Basic plan.', {
            feature: 'expenses',
            plan: 'basic',
            required_plan: 'pro',
          }),
        ),
        http.post('/api/v1/test/no-plan', () =>
          refuse(402, 'plan_required', 'This workspace has no active plan.', {}),
        ),
        http.post('/api/v1/test/limit', () =>
          refuse(402, 'limit_reached', 'Basic issues 15 invoices a month per team member.', {
            key: 'invoices_per_month',
            used: 15,
            reserved: 0,
            limit: 15,
            unit: 'count',
            reset_at: '2026-12-01T00:00:00Z',
            offer_id: 'helvetly-v1',
            upgrade_plan: 'pro',
          }),
        ),
      ],
    },
  },
  render: () => (
    <Providers>
      <Refusals />
    </Providers>
  ),
  play: async () => {
    const screen = body()
    // 403 feature_not_in_plan: the API's words, once, with the plan that has it
    await userEvent.click(screen.getByRole('button', { name: 'Add an expense' }))
    await toastShows('Expenses are not part of the Basic plan.')
    await expect(screen.getAllByText('Expenses are not part of the Basic plan.')).toHaveLength(1)
    const toast = screen.getByText('Expenses are not part of the Basic plan.').closest('li')
    await expect(
      within(toast ?? document.body).getByRole('button', { name: 'See Pro' }),
    ).toBeVisible()
    // 402 plan_required: the same path, to the plans
    await userEvent.click(screen.getByRole('button', { name: 'Add a client' }))
    await toastShows('This workspace has no active plan.')
    await expect(screen.getByRole('button', { name: 'See plans' })).toBeVisible()
    // 402 limit_reached (the current body): the prompt with the meter, the reset and the kept draft
    await userEvent.click(screen.getByRole('button', { name: 'Issue an invoice' }))
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.getByText('Monthly invoice limit reached')).toBeVisible()
    await expect(
      dialog.getByText(
        /Your draft is saved and can be issued later\. The allowance resets on 1 Dec, 00:00 UTC\./,
      ),
    ).toBeVisible()
    await expect(screen.getByRole('dialog')).toHaveTextContent(/15\s*of\s*15/)
    await userEvent.click(dialog.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
}
export const PlanErrorToastsDark = dark(PlanErrorToasts)

/** Content the plan lacks that must stay on screen: blurred and inert, the warning notice and the way to the plans on top. */
export const LockedAreaBlurred: Story = {
  render: () => {
    const lock = featureLock(basic, 'expenses')
    return (
      <div className="p-4">
        {lock && (
          <LockedArea lock={lock} kept="Expenses you already have stay available to read.">
            <div className="grid gap-3 pt-24">
              <Button>New expense</Button>
              <Input aria-label="Supplier" />
              <p className="text-body">Office rent, 1 200.00 CHF</p>
            </div>
          </LockedArea>
        )}
      </div>
    )
  },
  play: async () => {
    const screen = body()
    const notice = await screen.findByText(/Your plan doesn’t include expenses; Pro does\./)
    await expect(notice.closest('[data-slot=feature-lock-notice]')).toHaveAttribute(
      'data-tone',
      'warning',
    )
    await expect(screen.getByRole('link', { name: 'See Pro' })).toBeVisible()
    // the content behind is inert: out of the tab order and the accessibility tree
    await expect(screen.getByText('Office rent, 1 200.00 CHF').closest('[inert]')).not.toBeNull()
    await expect(screen.queryByRole('button', { name: 'New expense' })).toBeNull()
  },
}
export const LockedAreaBlurredDark = dark(LockedAreaBlurred)
export const LockedAreaBlurredPhone = phone(LockedAreaBlurred)
