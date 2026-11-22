import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

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
    await expect(body().getByRole('link', { name: /All engagements/ })).toBeVisible()
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
