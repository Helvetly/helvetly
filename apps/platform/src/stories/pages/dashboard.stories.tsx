import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture, entitlementsFixture } from '@/components/billing/billing-fixture'
import { Dashboard } from '@/components/dashboard/dashboard'

import { emptyExpenseSummary, unavailable } from '../screen-fixtures'
import { attentionHandlers } from './api'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Dashboard',
  beforeEach: closeHeidi,
  parameters: pageParameters('/', {}, attentionHandlers()),
  render: () => (
    <Frame>
      <Dashboard />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const region = (name: string) => body().findByRole('region', { name })

/** The greeting by name, the key figures as cards that open their lists, and every card. */
export const WithData: Story = {
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await body().findByText(/^Good (morning|afternoon|evening), Anna$/)
    await expect(body().getByText('Here’s what’s happening with your business')).toBeVisible()
    const figures = within(await region('Key figures'))
    await waitFor(() =>
      expect(figures.getByRole('link', { name: /^Outstanding/ })).toHaveAttribute(
        'href',
        '/invoices/?status=open',
      ),
    )
    await expect(figures.getByRole('link', { name: /^Overdue/ })).toHaveAttribute(
      'href',
      '/invoices/?status=overdue',
    )
    await expect(figures.getByRole('link', { name: /^Spent this month/ })).toHaveAttribute(
      'href',
      '/expenses/',
    )
    await expect(figures.getByRole('link', { name: /^Collection rate/ })).toBeVisible()
    await expect(body().getByRole('button', { name: 'About Cash flow' })).toBeVisible()
    await expect(await body().findByRole('link', { name: /All engagements/ })).toBeVisible()
    const spending = await body().findByRole('heading', { name: 'Spending by category' })
    const card = within(spending.closest('section') ?? document.body)
    await card.findByText('Travel')
    await expect(card.getByText('Uncategorised')).toBeVisible()
    await expect(card.getByRole('link', { name: /All expenses/ })).toHaveAttribute(
      'href',
      '/expenses/',
    )
  },
}
export const WithDataDark = dark(WithData)
export const WithDataPhone = phone(WithData)
/** On a phone the header's period button names only the period, without its dates. */
export const PeriodPhone: Story = {
  ...phone(WithData),
  beforeEach: () => localStorage.removeItem('helvetly.dashboard.period'),
  play: async () => {
    const trigger = await body().findByRole('button', { name: /^Period:/ }, { timeout: 8000 })
    await expect(trigger.closest('header')).not.toBeNull()
    await waitFor(() => expect(trigger.innerText).toMatch(/This month/))
    await expect(trigger.innerText).not.toMatch(/\d{4}/)
  },
}

/** While the figures load each card holds its place; nothing jumps in later. */
export const Loading: Story = {
  parameters: pageParameters('/', {}, [
    http.get('/api/v1/invoices/summary', async () => {
      await delay('infinite')
      return HttpResponse.json({})
    }),
    http.get('/api/v1/reports/key-figures', async () => {
      await delay('infinite')
      return HttpResponse.json({})
    }),
    ...attentionHandlers(),
  ]),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    const figures = await region('Key figures')
    await waitFor(() => expect(figures.querySelector('[aria-busy="true"]')).not.toBeNull())
    await expect(body().getByLabelText('Net cash flow')).toHaveTextContent('—')
  },
}

/** The cash flow fails alone: it says so and retries, the other cards still show. */
export const CashFlowError: Story = {
  parameters: pageParameters('/', {}, [
    http.get('/api/v1/reports/key-figures', unavailable),
    ...attentionHandlers(),
  ]),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await expect(await body().findByText(/^Cash flow couldn’t be loaded/)).toBeVisible()
    await expect(body().getByRole('button', { name: 'Retry cash flow' })).toBeVisible()
    const figures = within(await region('Key figures'))
    await figures.findByRole('link', { name: /^Outstanding/ })
  },
}

/** No spending this month: the category card says so calmly instead of an empty chart. */
export const NoSpending: Story = {
  parameters: pageParameters('/', {}, [
    http.get('/api/v1/expenses/summary', () => HttpResponse.json({ data: emptyExpenseSummary })),
    ...attentionHandlers(),
  ]),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await expect(await body().findByText('No expenses this month yet.')).toBeVisible()
    const figures = within(await region('Key figures'))
    await expect(await figures.findByRole('link', { name: /^Spent this month/ })).toHaveTextContent(
      '0 expenses',
    )
  },
}

const auditUsage = http.get('/api/v1/heidi/usage', () =>
  HttpResponse.json({ provider_available: true, consent: { granted: true } }),
)
const auditBilling = (used: number) =>
  http.get('/api/v1/billing', () =>
    HttpResponse.json({
      data: billingFixture({
        plan: 'business',
        entitlements: entitlementsFixture('business', {
          used: { workspace_audits_per_month: used },
        }),
      }),
    }),
  )
let auditQueries: string[] = []

/** The scope modal first; the drawer opens on Start with a severity summary and one-line rows. */
export const WorkspaceAudit: Story = {
  beforeEach: () => {
    auditQueries = []
    return closeHeidi()
  },
  parameters: pageParameters('/', {}, [
    ...attentionHandlers(),
    auditUsage,
    auditBilling(3),
    http.post('/api/v1/reports/workspace-audit', ({ request }) => {
      auditQueries.push(new URL(request.url).search)
      return HttpResponse.json({
        counts: { clients: 1, invoices: 1, documents: 1, payments: 1 },
        read: 1,
        partial: 0,
        pending: [],
        findings: [
          {
            id: 'mismatch',
            code: 'original_total',
            class: 'error',
            severity: 'high',
            category: 'invoices',
            values: ['CHF 800.00', 'CHF 880.00'],
            evidence: [
              { kind: 'document', id: 'doc_example', label: 'Original.pdf' },
              { kind: 'invoice', id: 'inv_example', label: '2026/IN/010' },
            ],
          },
          {
            id: 'credits',
            code: 'unreferenced_transfer',
            class: 'review',
            severity: 'low',
            category: 'payments',
            values: ['3'],
            evidence: [{ kind: 'document', id: 'doc_bank', label: 'Statement March.pdf' }],
          },
        ],
      })
    }),
  ]),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'AI Audit' }))
    const modal = within(await body().findByRole('dialog', { name: 'AI Audit' }))
    await expect(modal.getByText(/AI automation allowance/)).toBeVisible()
    await expect(await modal.findByText('7 of 10 audits left this month')).toBeVisible()
    await userEvent.click(modal.getByRole('radio', { name: 'Choose areas' }))
    const start = modal.getByRole('button', { name: 'Start audit' })
    await expect(start).toBeDisabled()
    await userEvent.click(modal.getByRole('checkbox', { name: /Invoices and amounts/ }))
    await userEvent.click(modal.getByRole('checkbox', { name: /Payments and bank/ }))
    await userEvent.click(start)
    const drawer = within(await body().findByRole('dialog', { name: 'AI Audit' }))
    await expect(
      await drawer.findByText('Scope: Invoices and amounts and Payments and bank'),
    ).toBeVisible()
    await waitFor(() => expect(auditQueries).toEqual(['?lang=en&areas=invoices,payments']))
    await expect(drawer.getByRole('button', { name: /^1\s*High$/ })).toBeVisible()
    await userEvent.click(await drawer.findByText('Original and record totals differ'))
    await expect(drawer.getByRole('link', { name: 'Original.pdf' })).toHaveAttribute(
      'href',
      '/documents/?file=doc_example',
    )
    await expect(drawer.getByText('CHF 880.00')).toBeVisible()
    await userEvent.click(drawer.getByText('Bank credits without invoice references'))
    await expect(drawer.getByText('3 bank credits without a reference')).toBeVisible()
    await userEvent.click(drawer.getByRole('button', { name: /^1\s*High$/ }))
    await expect(drawer.queryByText('Bank credits without invoice references')).toBeNull()
    await userEvent.click(drawer.getByRole('button', { name: /^1\s*High$/ }))
    await userEvent.click(drawer.getByRole('button', { name: /^Payments\s*1$/ }))
    await expect(drawer.queryByText('Original and record totals differ')).toBeNull()
  },
}

export const WorkspaceAuditLocked: Story = {
  parameters: pageParameters('/', {}, [...attentionHandlers(), auditUsage]),
  play: async () => {
    const link = await body().findByRole('link', { name: /AI Audit.*Business/ })
    await expect(link).toHaveAttribute('href', '/settings/billing/plans/')
    await expect(within(link).getByText('Business')).toBeVisible()
    await expect(body().queryByRole('dialog', { name: 'AI Audit' })).toBeNull()
  },
}

export const WorkspaceAuditLimitReached: Story = {
  parameters: pageParameters('/', {}, [...attentionHandlers(), auditUsage, auditBilling(10)]),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'AI Audit' }))
    const modal = within(await body().findByRole('dialog', { name: 'AI Audit' }))
    await expect(await modal.findByText(/You’ve used all AI audits for this month/)).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Start audit' })).toBeDisabled()
  },
}

export const WorkspaceAuditLockedPhone = phone(WorkspaceAuditLocked)
export const WorkspaceAuditLimitReachedDark = dark(WorkspaceAuditLimitReached)

/** While originals are read the button shows progress and reopens the running audit, never a new one. */
export const WorkspaceAuditRunning: Story = {
  parameters: pageParameters('/', {}, [
    ...attentionHandlers(),
    auditUsage,
    auditBilling(0),
    http.post('/api/v1/reports/workspace-audit', () =>
      HttpResponse.json({
        counts: { documents: 2 },
        read: 0,
        partial: 0,
        pending: ['doc_a', 'doc_b'],
        findings: [],
      }),
    ),
    http.post('/api/v1/reports/workspace-audit/documents/:id', async () => {
      await delay('infinite')
      return HttpResponse.json({ status: 'read' })
    }),
  ]),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'AI Audit' }))
    const modal = within(await body().findByRole('dialog', { name: 'AI Audit' }))
    const start = modal.getByRole('button', { name: 'Start audit' })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.click(start)
    const drawer = within(await body().findByRole('dialog', { name: 'AI Audit' }))
    await expect(await drawer.findByText('Checking original 1 of 2')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    const running = await body().findByRole('button', { name: 'Checking original 1 of 2' })
    await expect(running).toHaveTextContent(/Auditing 1\/2/)
    await userEvent.click(running)
    await expect(
      await within(await body().findByRole('dialog', { name: 'AI Audit' })).findByRole('button', {
        name: 'Pause audit',
      }),
    ).toBeVisible()
    await expect(body().queryByRole('button', { name: 'Start audit' })).toBeNull()
  },
}
