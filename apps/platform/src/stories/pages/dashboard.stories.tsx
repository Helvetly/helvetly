import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Dashboard } from '@/components/dashboard/dashboard'
import { dashboard } from '@/mocks/data'

import { emptyExpenseSummary, storySession, unavailable } from '../screen-fixtures'
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
/** A dashboard card by its title. */
const cardNamed = async (title: string) => {
  const heading = await body().findByRole('heading', { name: title, level: 2 })
  const section = heading.closest('section')
  if (!section) throw new Error(`${title} is not a card`)
  return within(section)
}
/** The cards' titles in page order. */
const order = () =>
  [...document.querySelectorAll('[data-dashboard-card] h2')].map((heading) => heading.textContent)
const LAYOUT_KEY = `helvetly.dashboard.layout:${JSON.stringify([storySession.workspace.id, storySession.user.id])}`

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
    await expect(await figures.findByRole('link', { name: /^Spent this month/ })).toHaveAttribute(
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
    const cash = await cardNamed('Cash flow')
    await expect(await cash.findByText(/^Cash flow couldn’t be loaded/)).toBeVisible()
    await expect(cash.getByRole('button', { name: 'Retry cash flow' })).toBeVisible()
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

/** While originals are read the button shows progress and reopens the running audit, never a new one. */
export const WorkspaceAuditRunning: Story = {
  parameters: pageParameters('/', {}, [
    ...attentionHandlers(),
    auditUsage,
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
    await userEvent.click(modal.getByRole('button', { name: 'Start audit' }))
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

/** The cash flow card covers 30 days to a year; years compare in their own card, by measure and year. */
export const YearOverYear: Story = {
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    const cash = await cardNamed('Cash flow')
    await expect(cash.getByRole('radio', { name: '12M' })).toBeChecked()
    await expect(cash.queryByRole('radio', { name: 'Years' })).toBeNull()
    const years = await cardNamed('Year over year')
    const headline = await years.findByLabelText(/^2026 year to date/)
    await expect(years.getByRole('button', { name: '2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(years.getByRole('button', { name: '2024' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    const income = headline.textContent
    await userEvent.click(years.getByRole('radio', { name: 'Net' }))
    await waitFor(() => expect(headline.textContent).not.toBe(income))
    await userEvent.click(years.getByRole('button', { name: '2024' }))
    await expect(years.getByRole('button', { name: '2024' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

/** One year of records: nothing to compare yet, and the card says so instead of a lone line. */
export const YearOverYearOneYear: Story = {
  parameters: pageParameters('/', {}, [
    http.get('/api/v1/reports/key-figures', () =>
      HttpResponse.json({
        ...dashboard,
        cash_flow: {
          ...dashboard.cash_flow,
          years: dashboard.cash_flow.years.filter((point) => point.date.startsWith('2026')),
        },
      }),
    ),
    ...attentionHandlers(),
  ]),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    const years = await cardNamed('Year over year')
    await expect(await years.findByText('Not enough history yet')).toBeVisible()
    await expect(years.queryByRole('radio', { name: 'Net' })).toBeNull()
  },
}

/**
 * Customize hides and shows cards and moves them (the arrows here, a card's grip by keyboard); the
 * layout survives a reload for this workspace and person, and Reset brings the default back.
 */
export const Customize: Story = {
  beforeEach: () => localStorage.removeItem(LAYOUT_KEY),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await userEvent.click(body().getByRole('button', { name: 'Customize' }))
    const panel = within(await body().findByRole('dialog', { name: 'Customize' }))
    await expect(panel.getByRole('button', { name: 'Reset layout' })).toBeDisabled()
    await userEvent.click(panel.getByRole('checkbox', { name: 'Spending by category' }))
    await waitFor(() => expect(order()).not.toContain('Spending by category'))
    await userEvent.click(panel.getByRole('button', { name: 'Move Year over year up' }))
    await waitFor(() =>
      expect(order().slice(0, 3)).toEqual(['Cash flow', 'Year over year', 'Needs attention']),
    )
    await expect(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')).toMatchObject({
      hidden: ['spending'],
    })
    await userEvent.keyboard('{Escape}')
    // Closing gives focus back to Customize; wait for that before taking it.
    await waitFor(() => expect(body().queryByRole('dialog', { name: 'Customize' })).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(body().getByRole('button', { name: 'Customize' })),
    )

    // The grip moves its card by keyboard, and keeps focus on it.
    const grip = body().getByRole('button', { name: 'Move Cash flow' })
    grip.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(order().slice(0, 2)).toEqual(['Year over year', 'Cash flow']))
    await waitFor(() =>
      expect(document.activeElement).toBe(body().getByRole('button', { name: 'Move Cash flow' })),
    )
    await expect(body().getByText(/Cash flow moved to position 2 of/)).toBeInTheDocument()

    await userEvent.click(body().getByRole('button', { name: 'Customize' }))
    const again = within(await body().findByRole('dialog', { name: 'Customize' }))
    await userEvent.click(again.getByRole('button', { name: 'Reset layout' }))
    await waitFor(() =>
      expect(order().slice(0, 3)).toEqual(['Cash flow', 'Needs attention', 'Year over year']),
    )
    await expect(order()).toContain('Spending by category')
    await expect(localStorage.getItem(LAYOUT_KEY)).toBeNull()
  },
}

/** A saved layout is read back: a hidden card stays hidden after a reload. */
export const CustomizeSaved: Story = {
  beforeEach: () => {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ order: ['attention', 'cash-flow'], hidden: ['year-over-year'] }),
    )
    return () => localStorage.removeItem(LAYOUT_KEY)
  },
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await cardNamed('Cash flow')
    const titles = [...document.querySelectorAll('[data-dashboard-card] h2')].map(
      (heading) => heading.textContent,
    )
    await expect(titles.slice(0, 2)).toEqual(['Needs attention', 'Cash flow'])
    await expect(titles).not.toContain('Year over year')
  },
}
export const CustomizePhone = phone(Customize)
