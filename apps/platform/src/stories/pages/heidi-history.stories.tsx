import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Dashboard } from '@/components/dashboard/dashboard'
import type { HeidiConversation } from '@/lib/heidi'

import { dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const daysAgo = (days: number) => {
  const at = new Date()
  at.setDate(at.getDate() - days)
  at.setHours(10, 15, 0, 0)
  return at.toISOString()
}

const chats: HeidiConversation[] = [
  {
    id: 'story',
    title: 'How do I create and send my first invoice?',
    snippet: 'Open Invoices → New invoice, pick the client, add lines, then Issue and send.',
    messages: 2,
    updated_at: ago(0.5),
  },
  {
    id: 'clients',
    title: 'Show recent clients',
    snippet: 'Your five most recent clients are Müller AG, Sophie Meier, …',
    messages: 2,
    updated_at: ago(0.6),
  },
  {
    id: 'overdue-1',
    title: 'Which invoices are overdue?',
    snippet: 'One invoice is overdue: 2026-043 to Sophie Meier, CHF 3’134.90.',
    messages: 4,
    updated_at: daysAgo(1),
  },
  {
    id: 'overdue-2',
    title: 'Which invoices are overdue?',
    snippet: 'No invoices are overdue right now.',
    messages: 2,
    updated_at: daysAgo(3),
  },
  {
    id: 'hi',
    title: 'hi',
    snippet: 'Hello! Ask me about invoices, clients, expenses or VAT.',
    messages: 2,
    updated_at: daysAgo(30),
  },
]

const handlers = (list: HeidiConversation[]) => [
  http.get('/api/v1/heidi/conversations', () => HttpResponse.json({ data: list })),
  http.get('/api/v1/heidi/conversations/:id', ({ params }) =>
    HttpResponse.json({
      data: [
        { id: `${String(params.id)}-q`, role: 'user', text: 'Show recent clients' },
        { id: `${String(params.id)}-a`, role: 'assistant', text: 'Here are your recent clients.' },
      ],
    }),
  ),
]

const meta = {
  title: 'Pages/Heidi chat history',
  beforeEach: () => {
    localStorage.setItem('helvetly:heidi:panel', JSON.stringify({ open: true, width: 420 }))
    localStorage.setItem(
      'helvetly:heidi:conversation:usr_story:wrk_story',
      JSON.stringify({ id: 'story', at: Date.now() }),
    )
    return () => localStorage.removeItem('helvetly:heidi:panel')
  },
  parameters: pageParameters('/', {}, handlers(chats)),
  render: () => (
    <Frame>
      <Dashboard />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Opens the panel (a sheet on a phone, opened with ⌘J) and then the chat history. */
async function openHistory(context: Parameters<NonNullable<Story['play']>>[0]) {
  await shows('Cash flow')?.(context)
  if (window.innerWidth < 768) await userEvent.keyboard('{Meta>}j{/Meta}')
  const body = within(context.canvasElement.ownerDocument.body)
  await userEvent.click(await body.findByRole('button', { name: 'Chats' }))
  return body
}

/**
 * Chats come in date groups with a muted heading; each row has the question, the time beside it
 * and the latest answer, so the same question asked twice can be told apart. The current chat is
 * highlighted, arrow keys move between rows and the header search filters the list.
 */
export const History: Story = {
  play: async (context) => {
    const body = await openHistory(context)
    const list = await body.findByRole('navigation', { name: 'Chats' })
    const groups = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    await expect(groups).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older'])
    await expect(within(list).getByRole('button', { current: true })).toHaveTextContent(
      'How do I create and send my first invoice?',
    )
    const overdue = within(list).getAllByRole('button', { name: /Which invoices are overdue\?/ })
    await expect(overdue[0]).toHaveTextContent('4 messages · One invoice is overdue')
    await expect(overdue[1]).toHaveTextContent('No invoices are overdue right now.')

    // The time sits beside the title, not at the far edge.
    const row = within(list).getByRole('button', { name: /^hi/ })
    const title = within(row).getByText('hi')
    const time = row.querySelector('time')
    await expect(
      (time?.getBoundingClientRect().left ?? 0) - title.getBoundingClientRect().right,
    ).toBeLessThan(16)

    within(list).getAllByRole('button')[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(within(list).getByRole('button', { name: /^Show recent clients/ })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(row).toHaveFocus()

    await userEvent.click(body.getByRole('button', { name: 'Search chats' }))
    const search = body.getByRole('searchbox', { name: 'Search chats' })
    await userEvent.type(search, 'no invoices')
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(1))
    await userEvent.clear(search)
    await userEvent.type(search, 'zebra')
    await expect(await within(list).findByText('No chats match “zebra”.')).toBeVisible()
    await userEvent.clear(search)
    await userEvent.click(within(list).getByRole('button', { name: /^Show recent clients/ }))
    await expect(await body.findByText('Here are your recent clients.')).toBeInTheDocument()
  },
}
export const HistoryDark = dark(History)
export const HistoryPhone = phone(History)

/** Before the first chat, the history says what will appear there. */
export const HistoryEmpty: Story = {
  parameters: pageParameters('/', {}, handlers([])),
  play: async (context) => {
    const body = await openHistory(context)
    await expect(await body.findByText('No chats yet')).toBeVisible()
  },
}
