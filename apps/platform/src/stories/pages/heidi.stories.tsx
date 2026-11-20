import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Dashboard } from '@/components/dashboard/dashboard'
import { messageTime } from '@/components/heidi/message'
import type { HeidiMessage } from '@/lib/heidi'

import { attentionHandlers } from './api'
import { dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const answeredAt = new Date().toISOString()
const conversation: HeidiMessage[] = [
  { id: 'q1', role: 'user', text: 'Which invoices are overdue?', created_at: answeredAt },
  {
    id: 'a1',
    role: 'assistant',
    created_at: answeredAt,
    text: '1 invoice is overdue.',
    records: [
      {
        kind: 'invoice',
        id: 'inv_3',
        title: '2026-043',
        detail: 'Sophie Meier · due 20 Oct 2026',
        status: 'overdue',
        amount: '3134.90',
        currency: 'CHF',
      },
    ],
    actions: [
      {
        id: 'send_invoice',
        invoice_id: 'inv_3',
        label: 'Send a reminder',
        subject: 'Reminder: invoice 2026-043',
      },
    ],
  },
]

// The panel opens the way a reload finds it: open, with the stored conversation (user:workspace scope).
const meta = {
  title: 'Pages/Heidi',
  beforeEach: () => {
    localStorage.setItem('helvetly:heidi:panel', JSON.stringify({ open: true, width: 420 }))
    localStorage.setItem(
      'helvetly:heidi:conversation:usr_story:wrk_story',
      JSON.stringify({ id: 'story', at: Date.now() }),
    )
    return () => localStorage.removeItem('helvetly:heidi:panel')
  },
  parameters: pageParameters('/', {}, [
    ...attentionHandlers(),
    http.get('/api/v1/heidi/conversations', () =>
      HttpResponse.json({
        data: [
          {
            id: 'story',
            title: 'Which invoices are overdue?',
            updated_at: new Date().toISOString(),
          },
          {
            id: 'older',
            title: 'Draft a reminder for Müller AG about the September invoice',
            updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          },
        ],
      }),
    ),
    http.get('/api/v1/heidi/conversations/story', () => HttpResponse.json({ data: conversation })),
    http.get('/api/v1/heidi/conversations/older', () =>
      HttpResponse.json({
        data: [
          {
            id: 'o1',
            role: 'user',
            text: 'Draft a reminder for Müller AG about the September invoice',
          },
          { id: 'o2', role: 'assistant', text: 'Here is a short, friendly reminder you can send.' },
        ],
      }),
    ),
  ]),
  render: () => (
    <Frame>
      <Dashboard />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = {
  play: async (context) => {
    // On a phone Heidi is a sheet that never reopens by itself: open it with ⌘J.
    if (window.innerWidth < 768) {
      await shows('Cash flow')?.(context)
      await userEvent.keyboard('{Meta>}j{/Meta}')
    }
    await shows(
      'Which invoices are overdue?',
      '1 invoice is overdue.',
      '2026-043',
      'CHF 3’134.90',
      'Send a reminder',
      messageTime(new Date(answeredAt)),
    )?.(context)
    // Copy waits, quietly, under the finished answer.
    await expect(
      within(context.canvasElement.ownerDocument.body).getByRole('button', { name: 'Copy' }),
    ).toBeInTheDocument()
  },
}
export const ConversationDark = dark(Conversation)
export const ConversationPhone = phone(Conversation)

// The history lists earlier chats; picking one continues it in place.
export const ChatHistory: Story = {
  play: async (context) => {
    await shows('Which invoices are overdue?')?.(context)
    const canvas = within(context.canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Chats' }))
    const list = await canvas.findByRole('navigation', { name: 'Chats' })
    await expect(within(list).getByRole('button', { current: true })).toHaveTextContent(
      'Which invoices are overdue?',
    )
    await userEvent.click(within(list).getByText(/Draft a reminder for Müller AG/))
    // Messages fade in: wait for the answer to settle.
    const answer = await canvas.findByText('Here is a short, friendly reminder you can send.')
    await waitFor(() => expect(answer).toBeVisible())
  },
}
export const ChatHistoryDark = dark(ChatHistory)
