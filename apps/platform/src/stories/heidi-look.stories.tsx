import { HeidiMark, HeidiOrb, HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Bell, LifeBuoy } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fn, spyOn, userEvent, waitFor, within } from 'storybook/test'

import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider } from '@/components/heidi/heidi-provider'
import { Message } from '@/components/heidi/message'
import type { ChatMessage } from '@/components/heidi/use-heidi'
import { RecordDrawersContext } from '@/components/record-link'

import { screenHandlers } from './screen-fixtures'

const scope = 'storybook:heidi-look'
const handlers = [
  ...screenHandlers,
  http.get('/api/v1/heidi/usage', () =>
    HttpResponse.json({
      period: '2026-11',
      tokens_used: 0,
      tokens_included: 0,
      tokens_purchased: 0,
      tokens_remaining: 0,
      mode: 'local',
    }),
  ),
  http.get('/api/v1/heidi/suggestions', () =>
    HttpResponse.json({
      data: [
        { title: 'Overdue invoices', prompt: 'Which invoices are overdue?' },
        { title: 'This month', prompt: 'How much did I invoice this month?' },
      ],
    }),
  ),
]

const meta = {
  title: 'Heidi/Look',
  parameters: { msw: { handlers } },
  beforeEach: () => {
    for (const key of ['helvetly:heidi:panel', `helvetly:heidi:conversation:${scope}`])
      localStorage.removeItem(key)
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const running = (element: Element) =>
  element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running')

/** Every size and surface Heidi's mark appears on, still and animated. */
function Gallery() {
  return (
    <div className="grid max-w-xl gap-6">
      <section aria-label="Still" className="flex items-end gap-6 rounded-xl border bg-card p-6">
        <HeidiSparkle className="size-4" />
        <HeidiSparkle className="size-6" />
        <HeidiSparkle className="size-16" />
        <HeidiMark />
        <HeidiMark className="size-6" />
        <span className="flex size-9 items-center justify-center rounded-lg bg-heidi-soft/60">
          <HeidiSparkle className="size-[18px]" />
        </span>
      </section>
      <section aria-label="Animated" className="flex items-end gap-6 rounded-xl border bg-card p-6">
        <HeidiSparkle animated className="size-6" />
        <HeidiSparkle animated className="size-16" />
        <HeidiMark animated />
        <HeidiOrb />
      </section>
    </div>
  )
}

export const Marks: Story = {
  render: () => <Gallery />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const still = canvas.getByRole('region', { name: 'Still' })
    const animated = canvas.getByRole('region', { name: 'Animated' })
    // In lists Heidi rests; the orb and the introduced marks move, never with reduced motion.
    await expect(running(still)).toHaveLength(0)
    if (reducedMotion()) await expect(running(animated)).toHaveLength(0)
    else await waitFor(() => expect(running(animated).length).toBeGreaterThan(0))
  },
}

export const MarksDark: Story = { ...Marks, parameters: { dark: true } }

/** The sidebar's bottom group as nav.ts builds it: Heidi among plain line icons. */
function Sidebar() {
  return (
    <SidebarProvider className="min-h-0 w-64">
      <SidebarMenu className="gap-px p-2">
        <SidebarMenuItem>
          <SidebarMenuButton>
            <LifeBuoy />
            <span>Help & feedback</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton>
            <HeidiSparkle />
            <span>Ask Heidi</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton>
            <Bell />
            <span>Notifications</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarProvider>
  )
}

export const SidebarEntry: Story = {
  render: () => <Sidebar />,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: /Ask Heidi/ })
    // Still in the sidebar; a real pointer over it (CSS :hover) makes its crosses twinkle.
    await expect(running(button)).toHaveLength(0)
  },
}

export const SidebarEntryDark: Story = { ...SidebarEntry, parameters: { dark: true } }

function Panel() {
  return (
    <HeidiProvider scope={scope}>
      <div className="flex h-[640px] justify-end">
        <HeidiPanel />
      </div>
    </HeidiProvider>
  )
}

export const EmptyPanel: Story = {
  parameters: { layout: 'fullscreen' },
  // Opened the way a reload finds it: the panel remembers it was open.
  beforeEach: () => {
    localStorage.setItem('helvetly:heidi:panel', JSON.stringify({ open: true, width: 420 }))
  },
  render: () => <Panel />,
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByRole('heading', { name: 'Heidi' })).toBeVisible()
    const suggestion = await body.findByText('Which invoices are overdue?')
    await waitFor(() => expect(suggestion).toBeVisible()) // the panel slides in
  },
}

export const EmptyPanelDark: Story = {
  ...EmptyPanel,
  parameters: { ...EmptyPanel.parameters, dark: true },
}

function Thinking() {
  return (
    <ul className="max-w-md rounded-xl border bg-card p-4">
      <Message
        message={{
          id: 'm1',
          role: 'assistant',
          text: '',
          attachments: [],
          actions: [],
          state: 'streaming',
          status: 'Looking at your invoices',
        }}
        busy
        highlighted={false}
        onRetry={() => {}}
        onSubmitForm={() => {}}
        onQuote={() => {}}
      />
    </ul>
  )
}

export const ThinkingState: Story = {
  render: () => <Thinking />,
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole('status', { name: 'Heidi is thinking' })
    await expect(status).toHaveTextContent('Looking at your invoices…')
    // A turning sparkle beside the label, not an avatar; still with reduced motion.
    const sparkle = status.parentElement?.querySelector('svg') ?? null
    await expect(sparkle).not.toBeNull()
    await expect(sparkle && getComputedStyle(sparkle).animationName).toBe(
      reducedMotion() ? 'none' : 'spin',
    )
  },
}

export const ThinkingStateDark: Story = { ...ThinkingState, parameters: { dark: true } }

const sampleAnswer = (change: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  text: '',
  attachments: [],
  actions: [],
  state: 'done',
  ...change,
})

function Worked() {
  const [startedAt] = useState(() => Date.now() - 3200)
  return (
    <ul className="grid max-w-md gap-4 rounded-xl border bg-card p-4">
      <Message
        message={sampleAnswer({
          id: 'working',
          state: 'streaming',
          startedAt,
          status: 'Reading receipt.pdf',
          steps: ['Checking the question', 'Reading receipt.pdf'],
        })}
        busy
        highlighted={false}
        onRetry={() => {}}
        onSubmitForm={() => {}}
        onQuote={() => {}}
      />
      <Message
        message={sampleAnswer({
          id: 'worked',
          text: 'The receipt is from **Migros**, 42.80 CHF, VAT 2.6%. Check the date before you book it.',
          workedMs: 4200,
          steps: ['Checking the question', 'Reading receipt.pdf', 'Saved documents'],
        })}
        busy={false}
        highlighted={false}
        onRetry={() => {}}
        onSubmitForm={() => {}}
        onQuote={() => {}}
      />
    </ul>
  )
}

/** While Heidi works: the step and a timer; afterwards a muted "Worked for 4s" that opens the steps. */
export const WorkingAndWorked: Story = {
  render: () => <Worked />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status', { name: 'Heidi is thinking' })).toHaveTextContent(
      'Reading receipt.pdf…',
    )
    await waitFor(() => expect(canvas.getByText(/^[34]s$/)).toBeVisible())
    const worked = canvas.getByRole('button', { name: 'Worked for 4s' })
    await userEvent.click(worked)
    const steps = canvas.getByRole('list', { name: 'Steps' })
    await expect(within(steps).getAllByRole('listitem')).toHaveLength(3)
    // The timer and step labels are muted, never full foreground text.
    await expect(getComputedStyle(worked).color).not.toBe(getComputedStyle(canvasElement).color)
  },
}

export const WorkingAndWorkedDark: Story = { ...WorkingAndWorked, parameters: { dark: true } }

const today = (hours: number, minutes: number) => {
  const at = new Date()
  at.setHours(hours, minutes, 0, 0)
  return at
}
const message = (fields: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage => ({
  text: '',
  attachments: [],
  actions: [],
  state: 'done',
  ...fields,
})
const retry = fn()

/** A question, a finished answer, one still streaming, one that failed and one stopped. */
function Answers() {
  const messages = [
    message({ id: 'q', role: 'user', text: 'Which invoices are overdue?', at: today(8, 30) }),
    message({
      id: 'a',
      role: 'assistant',
      text: 'One invoice is overdue: **2026-043** to Sophie Meier, CHF 3’134.90.',
      at: today(8, 31),
    }),
    message({
      id: 's',
      role: 'assistant',
      text: 'Looking at this month',
      state: 'streaming',
      at: today(8, 32),
    }),
    message({
      id: 'e',
      role: 'assistant',
      state: 'error',
      error: 'Heidi is unreachable.',
      at: today(8, 33),
    }),
    message({ id: 'x', role: 'assistant', text: 'So far:', state: 'stopped', at: today(8, 34) }),
  ]
  return (
    <ol className="grid max-w-md gap-6 rounded-xl border bg-card p-4">
      {messages.map((item) => (
        <Message
          key={item.id}
          message={item}
          busy={false}
          highlighted={false}
          onRetry={retry}
          onSubmitForm={() => {}}
          onQuote={() => {}}
        />
      ))}
    </ol>
  )
}

export const AnswerCard: Story = {
  beforeEach: () => {
    retry.mockClear()
  },
  render: () => <Answers />,
  play: async ({ canvasElement }) => {
    const items = within(canvasElement)
      .getAllByRole('listitem')
      .filter((item) => item.hasAttribute('data-message'))
    const [question, answer, streaming, failed, stopped] = items
    if (!question || !answer || !streaming || !failed || !stopped) throw new Error('Five messages')

    // The question keeps the lilac bubble and shows its time quietly beneath it.
    await expect(within(question).getByText('08:30').tagName).toBe('TIME')

    // An answer says it is Heidi's and when it came, as text on the panel, with a quiet Copy icon.
    // After the slide-in, which starts transparent.
    await waitFor(() => expect(within(answer).getByText('Heidi')).toBeVisible())
    const time = within(answer).getByText('08:31')
    await expect(time).toHaveAttribute('title', expect.stringContaining('08:31'))
    await expect(time).toHaveAttribute('datetime', today(8, 31).toISOString())
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await userEvent.click(within(answer).getByRole('button', { name: 'Copy' }))
    await expect(writeText).toHaveBeenCalledWith(expect.stringContaining('2026-043'))
    // The quiet action row fades in on hover and stays while "Copied" shows.
    const copied = await within(answer).findByRole('button', { name: 'Copied' })
    await waitFor(() => expect(copied).toBeVisible())

    // Streaming: the text so far, and no Copy until the answer is done.
    await expect(within(streaming).getByText('Looking at this month')).toBeVisible()
    await expect(within(streaming).queryByRole('button', { name: 'Copy' })).toBeNull()

    // A failure stays inside the card and can be retried.
    await expect(within(failed).getByRole('alert')).toHaveTextContent('Heidi is unreachable.')
    await userEvent.click(within(failed).getByRole('button', { name: 'Retry' }))
    await expect(retry).toHaveBeenCalledOnce()

    await expect(within(stopped).getByText('Stopped.')).toBeVisible()
  },
}

export const AnswerCardDark: Story = { ...AnswerCard, parameters: { dark: true } }

const openRecord = fn()

/** A local list answer: one sentence, then the records as rows that open in place. */
function RecordsAnswer() {
  return (
    <RecordDrawersContext value={openRecord}>
      <ol className="grid max-w-md gap-6 p-4">
        <Message
          message={message({
            id: 'r',
            role: 'assistant',
            text: 'Here’s where your 2 active engagements stand this period. **1 invoice** is overdue.',
            at: today(9, 5),
            records: [
              {
                kind: 'client',
                id: 'cli_1',
                title: 'John',
                detail: 'Client 1 · Zürich',
                status: 'draft',
              },
              {
                kind: 'invoice',
                id: 'inv_1',
                title: '2026-043',
                detail: 'Sophie Meier · due 20 Oct 2026',
                status: 'overdue',
                amount: '3134.9',
                currency: 'CHF',
              },
              {
                kind: 'engagement',
                id: 'eng_1',
                title: 'Bookkeeping retainer',
                detail: 'Keller AG · period ends 30 Nov 2026',
                progress: { used: '3.5', available: '10.000', unit: 'hour' },
              },
            ],
            actions: [{ id: 'list_overdue_invoices', label: 'See all overdue invoices' }],
          })}
          busy={false}
          highlighted={false}
          onRetry={() => {}}
          onSubmitForm={() => {}}
          onQuote={() => {}}
        />
      </ol>
    </RecordDrawersContext>
  )
}

export const RecordCards: Story = {
  beforeEach: () => {
    openRecord.mockClear()
  },
  render: () => <RecordsAnswer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText(/active engagements stand/)).toBeVisible())
    // Each record is one row: what it is, a detail line, and its money, status or progress.
    const invoice = canvas.getByRole('button', { name: /2026-043/ })
    await expect(invoice).toHaveTextContent('CHF 3’134.90')
    await expect(invoice).toHaveTextContent('Overdue')
    await expect(canvas.getByRole('button', { name: /John/ })).toHaveTextContent('Draft')
    await expect(canvas.getByText('3.5 of 10 h used')).toBeVisible()
    // A row opens the record in a drawer, in place.
    await userEvent.click(invoice)
    await expect(openRecord).toHaveBeenCalledWith({ kind: 'invoice', id: 'inv_1' })
    await userEvent.click(canvas.getByRole('button', { name: /Bookkeeping retainer/ }))
    await expect(openRecord).toHaveBeenLastCalledWith({ kind: 'engagement', id: 'eng_1' })
    // The follow-up action is a quiet outline button, not a heavy primary one.
    await expect(canvas.getByRole('button', { name: 'See all overdue invoices' })).toHaveAttribute(
      'data-variant',
      'outline',
    )
    // Copy is an icon with a tooltip, and the copy keeps the records as lines.
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const copy = canvas.getByRole('button', { name: 'Copy' })
    await userEvent.hover(copy)
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('tooltip'),
    ).toHaveTextContent('Copy')
    await userEvent.click(copy)
    await expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('- 2026-043 · Sophie Meier · due 20 Oct 2026 · CHF 3’134.90'),
    )
    await expect(await canvas.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  },
}

export const RecordCardsDark: Story = { ...RecordCards, parameters: { dark: true } }
