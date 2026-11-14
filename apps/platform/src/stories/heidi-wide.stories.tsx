import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider, useHeidi } from '@/components/heidi/heidi-provider'

import { screenHandlers } from './screen-fixtures'

const scope = 'storybook:wide'
/** 44rem: the readable column a wide panel keeps in its middle. */
const COLUMN = 704

const meta = {
  title: 'Heidi/Wide panel',
  parameters: {
    msw: {
      handlers: [
        ...screenHandlers,
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({
            period: '2026-11',
            tokens_used: 0,
            tokens_included: 0,
            tokens_purchased: 0,
            tokens_remaining: 0,
            mode: 'local',
            usage_uncertain: false,
            can_purchase: false,
          }),
        ),
        http.get('/api/v1/heidi/suggestions', () =>
          HttpResponse.json({
            data: [
              { title: 'Overdue invoices', prompt: 'Which invoices are overdue?' },
              { title: 'Expenses', prompt: 'Summarize this month’s expenses' },
              { title: 'Invoicing', prompt: 'What needs invoicing?' },
              { title: 'Invoices', prompt: 'Show recent invoices' },
            ],
          }),
        ),
        http.post(
          '/api/v1/heidi/chat',
          () =>
            new HttpResponse(
              'data: {"type":"text","value":"Two invoices are overdue, together CHF 1,200."}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n',
              { headers: { 'Content-Type': 'text/event-stream' } },
            ),
        ),
      ],
    },
  },
  beforeEach: () => {
    // As wide as the panel goes (half the window), so a desktop-wide Storybook shows the column.
    localStorage.setItem('helvetly:heidi:panel', JSON.stringify({ open: false, width: 1200 }))
    localStorage.removeItem(`helvetly:heidi:conversation:${scope}`)
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Open() {
  const heidi = useHeidi()
  return <Button onClick={() => heidi?.setOpen(true)}>Open assistant</Button>
}

function Panel() {
  return (
    <HeidiProvider scope={scope}>
      <div className="flex h-[720px]">
        <div className="flex-1">
          <Open />
        </div>
        <HeidiPanel />
      </div>
    </HeidiProvider>
  )
}

/** The column is capped and centred, and the composer row lines up with it. */
async function expectColumn(column: HTMLElement, composerRow: HTMLElement) {
  for (const element of [column, composerRow]) {
    await expect(getComputedStyle(element).maxWidth).toBe(`${COLUMN}px`)
    await expect(element.getBoundingClientRect().width).toBeLessThanOrEqual(COLUMN)
  }
  const a = column.getBoundingClientRect()
  const b = composerRow.getBoundingClientRect()
  await expect(Math.abs(a.left + a.width / 2 - (b.left + b.width / 2))).toBeLessThan(1)
}

/** In a wide panel the welcome and its suggestions keep a readable width instead of the full panel. */
export const Welcome: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    const row = await canvas.findByRole('button', { name: /Which invoices are overdue/ })
    const column = row.closest('section')?.parentElement?.parentElement
    const composerRow = canvas
      .getByRole('textbox', { name: 'Message Heidi' })
      .closest('form')?.parentElement
    if (!column || !composerRow) throw new Error('The panel’s column or composer row is missing')
    await expectColumn(column, composerRow)
    await expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(COLUMN)
  },
}

export const WelcomeDark: Story = { ...Welcome, parameters: { dark: true } }

/** The conversation keeps the same column. */
export const Conversation: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await userEvent.click(await canvas.findByRole('button', { name: /Which invoices are overdue/ }))
    const log = await canvas.findByRole('log', { name: 'Conversation' })
    await waitFor(() => expect(within(log).getByText(/Two invoices are overdue/)).toBeVisible())
    const column = log.parentElement
    const composerRow = canvas
      .getByRole('textbox', { name: 'Message Heidi' })
      .closest('form')?.parentElement
    if (!column || !composerRow) throw new Error('The panel’s column or composer row is missing')
    await expectColumn(column, composerRow)
  },
}
