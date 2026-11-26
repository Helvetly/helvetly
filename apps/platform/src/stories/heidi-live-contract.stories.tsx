import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider, useHeidi } from '@/components/heidi/heidi-provider'

import { screenHandlers } from './screen-fixtures'

const scope = 'storybook:workspace'
const usage = {
  period: '2026-11',
  tokens_used: 0,
  tokens_included: 0,
  tokens_purchased: 0,
  tokens_remaining: 0,
  mode: 'local',
  usage_uncertain: false,
  can_purchase: false,
}
const confirmed = fn()
const fakeApi = [
  ...screenHandlers,
  http.get('/api/v1/heidi/usage', () => HttpResponse.json(usage)),
  http.get('/api/v1/heidi/suggestions', () =>
    HttpResponse.json({
      data: [{ title: 'Overdue invoices', prompt: 'Which invoices are overdue?' }],
    }),
  ),
  http.post(
    '/api/v1/heidi/chat',
    () =>
      new HttpResponse(
        'data: {"type":"text","value":"No overdue invoices."}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  ),
]

function Open() {
  const heidi = useHeidi()
  return <Button onClick={() => heidi?.setOpen(true)}>Open assistant</Button>
}
function Panel({ workspace = scope }: { workspace?: string }) {
  return (
    <HeidiProvider key={workspace} scope={workspace}>
      <Open />
      <HeidiPanel />
    </HeidiProvider>
  )
}
function SwitchingPanel() {
  const [workspace, setWorkspace] = useState(scope)
  return (
    <>
      <Button variant="outline" onClick={() => setWorkspace('storybook:other-workspace')}>
        Switch workspace
      </Button>
      <Panel workspace={workspace} />
    </>
  )
}

const meta = {
  title: 'Heidi/Live contract',
  parameters: { msw: { handlers: fakeApi } },
  beforeEach: () => {
    confirmed.mockClear()
    for (const key of [
      'helvetly:heidi:panel',
      `helvetly:heidi:conversation:${scope}`,
      'helvetly:heidi:conversation:storybook:other-workspace',
    ])
      localStorage.removeItem(key)
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const LocalFactsAndHonestUsage: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await canvas.findByRole('textbox', { name: 'Message Heidi' })
    await expect(canvas.queryByText(/Local assistance|can make mistakes/)).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Buy more' })).not.toBeInTheDocument()
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Which invoices are overdue?' }),
    )
    const log = await canvas.findByRole('log', { name: 'Conversation' })
    // The answer fades in from opacity 0, so wait until it has, not just until it exists.
    await waitFor(() => expect(within(log).getByText('No overdue invoices.')).toBeVisible())
  },
}

const refusal =
  'I can only help with Helvetly and your business: invoices, clients, expenses, VAT and the like. Try asking:\n\n- Which invoices are overdue?\n- Summarize this month’s expenses'
const offTopicApi = [
  http.post(
    '/api/v1/heidi/chat',
    () =>
      new HttpResponse(
        `data: ${JSON.stringify({ type: 'text', value: refusal })}\n\ndata: {"type":"actions","actions":[{"id":"list_overdue_invoices","label":"Show overdue invoices"}]}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  ),
]

/** Heidi stays on Helvetly and the business: the composer says so, and an off-topic question gets a normal answer that points back. */
export const OffTopicRefusal: Story = {
  parameters: { msw: { handlers: [...offTopicApi, ...fakeApi] } },
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    const box = await canvas.findByRole('textbox', { name: 'Message Heidi' })
    await expect(box).toHaveAttribute(
      'placeholder',
      'Ask Heidi about your invoices, clients, expenses…',
    )
    await expect(box.getAttribute('placeholder')).not.toMatch(/anything else/)
    await userEvent.type(box, 'Write C++ code for Fibonacci{Enter}')
    const log = await canvas.findByRole('log', { name: 'Conversation' })
    // The answer fades in as it streams; wait for it to settle.
    await waitFor(() =>
      expect(
        within(log).getByText(/I can only help with Helvetly and your business/),
      ).toBeVisible(),
    )
    await waitFor(() => expect(within(log).getByText('Which invoices are overdue?')).toBeVisible())
    await expect(within(log).getByRole('button', { name: 'Show overdue invoices' })).toBeVisible()
  },
}

/** Unreconciled usage is no basis for a percentage: no warning is shown. */
export const UnknownModelUsage: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({
            ...usage,
            mode: 'openai',
            usage_uncertain: true,
            tokens_used: 990,
            tokens_included: 1000,
          }),
        ),
        ...fakeApi,
      ],
    },
  },
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await canvas.findByRole('textbox', { name: 'Message Heidi' })
    await expect(canvas.queryByText(/of this month’s Heidi AI tokens/)).not.toBeInTheDocument()
  },
}

/** From 75% of the month's allowance, an amber bar on top of the composer says how much is used. */
export const TokenAllowanceWarning: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({
            ...usage,
            mode: 'openai',
            tokens_used: 390_000,
            tokens_included: 500_000,
            tokens_remaining: 110_000,
          }),
        ),
        ...fakeApi,
      ],
    },
  },
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    const bar = await canvas.findByText(/You have used 78% of this month’s Heidi AI tokens\./)
    // The panel slides in from opacity 0.
    await waitFor(() => expect(bar).toBeVisible())
    await expect(within(bar).getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans\/?$/),
    )
  },
}

export const ReloadedConfirmation: Story = {
  beforeEach: () =>
    localStorage.setItem(
      `helvetly:heidi:conversation:${scope}`,
      JSON.stringify({ id: 'paused', at: Date.now() }),
    ),
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/conversations/paused', () =>
          HttpResponse.json({
            data: [
              { id: 'question', role: 'user', text: 'Log 2 hours for Müller' },
              {
                id: 'answer',
                role: 'assistant',
                text: 'Review this entry before writing.',
                confirmation: {
                  type: 'confirmation',
                  id: 'cnf_story',
                  title: 'Log 2 hours for Müller?',
                  body: 'Record two hours on Lessons, dated today.',
                  confirm_label: 'Log it',
                  tone: 'default',
                },
              },
            ],
          }),
        ),
        http.post('/api/v1/heidi/chat/confirm', () => {
          confirmed()
          return new HttpResponse(
            'data: {"type":"status","label":"Recorded engagement entry"}\n\ndata: {"type":"text","value":"Recorded 2 hours."}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        }),
        ...fakeApi,
      ],
    },
  },
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    const body = within(document.body)
    const dialog = await body.findByRole('dialog', { name: 'Log 2 hours for Müller?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log it' }))
    await waitFor(() => expect(confirmed).toHaveBeenCalledOnce())
    await waitFor(() => expect(canvas.getByText(/Recorded 2 hours\./)).toBeVisible())
    await expect(
      body.queryByRole('dialog', { name: 'Log 2 hours for Müller?' }),
    ).not.toBeInTheDocument()
  },
}

export const WorkspaceSwitchClearsDraft: Story = {
  render: () => <SwitchingPanel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Message Heidi' }),
      'Private first-workspace draft',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Switch workspace' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await expect(canvas.getByRole('textbox', { name: 'Message Heidi' })).toHaveValue('')
    await expect(canvas.queryByText('Private first-workspace draft')).not.toBeInTheDocument()
  },
}

let releaseStep = () => {}
let releaseText = () => {}
const frame = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)

/** Until text streams in, the answer shows that Heidi is thinking, then the running step. */
export const ThinkingUntilText: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(
          '/api/v1/heidi/chat',
          () =>
            new HttpResponse(
              new ReadableStream({
                async start(controller) {
                  await new Promise<void>((resolve) => (releaseStep = resolve))
                  controller.enqueue(frame({ type: 'status', label: 'Looking up invoices' }))
                  await new Promise<void>((resolve) => (releaseText = resolve))
                  controller.enqueue(frame({ type: 'text', value: 'No overdue invoices.' }))
                  controller.enqueue(frame({ type: 'done', usage: { tokens: 0 } }))
                  controller.close()
                },
              }),
              { headers: { 'Content-Type': 'text/event-stream' } },
            ),
        ),
        ...fakeApi,
      ],
    },
  },
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await userEvent.type(canvas.getByRole('textbox', { name: 'Message Heidi' }), 'hi{Enter}')
    const log = await canvas.findByRole('log', { name: 'Conversation' })
    const thinking = await within(log).findByRole('status', { name: 'Heidi is thinking' })
    await expect(thinking).toHaveTextContent('Thinking…')
    releaseStep()
    await waitFor(() => expect(thinking).toHaveTextContent('Looking up invoices…'))
    releaseText()
    // The answer fades in from opacity 0, so wait until it has, not just until it exists.
    await waitFor(() => expect(within(log).getByText('No overdue invoices.')).toBeVisible())
    await waitFor(() => expect(within(log).queryByRole('status')).not.toBeInTheDocument())
    // Afterwards a muted "Worked for …" above the answer opens the steps Heidi took.
    const worked = within(log).getByRole('button', { name: /^Worked for / })
    await userEvent.click(worked)
    await expect(worked).toHaveAttribute('aria-expanded', 'true')
    await expect(within(log).getByRole('list', { name: 'Steps' })).toHaveTextContent(
      'Looking up invoices',
    )
  },
}

/** Selecting part of an answer offers "Quote"; the next message quotes it, shown above the question. */
export const ReplyQuotesSelectedText: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Which invoices are overdue?' }),
    )
    const log = await canvas.findByRole('log', { name: 'Conversation' })
    const answer = await within(log).findByText('No overdue invoices.')
    await waitFor(() => expect(answer.closest('[data-answer]')).not.toBeNull())
    const range = document.createRange()
    range.selectNodeContents(answer)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)

    await userEvent.click(await canvas.findByRole('button', { name: 'Quote' }))
    await expect(canvas.getByText('Replying to')).toBeVisible()
    const box = canvas.getByRole('textbox', { name: 'Message Heidi' })
    await expect(box).toHaveFocus()
    await userEvent.type(box, 'Since when?{Enter}')

    const quote = await within(log).findByRole('blockquote')
    await expect(quote).toHaveTextContent('No overdue invoices.')
    await expect(within(log).getByText('Since when?')).toBeVisible()
    await expect(canvas.queryByText('Replying to')).not.toBeInTheDocument()
  },
}

/** Session-only controls stay tied to the current overlay and run through its own click handler. */
export const ApplyLiveControl: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/heidi/chat', async ({ request }) => {
          const form = await request.formData()
          const offered = String(form.get('controls') ?? '').split(',')
          const target = offered.find((key) => key.startsWith('click.save'))
          if (
            !target ||
            offered.includes('click.delete') ||
            offered.some((key) => key.includes('Private'))
          ) {
            return HttpResponse.json(
              { error: { message: 'Invalid control list' } },
              { status: 400 },
            )
          }
          const frames = [
            { type: 'text', value: 'Review the save action.' },
            { type: 'actions', actions: [{ id: 'screen_action', label: '', control: target }] },
            { type: 'done', usage: { tokens: 10 } },
          ]
          return new HttpResponse(
            frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        }),
        ...fakeApi,
      ],
    },
  },
  render: function Screen() {
    const [saved, setSaved] = useState(0)
    return (
      <>
        <div>
          <Button>Delete</Button>
          <dialog open aria-label="Account details">
            <Button onClick={() => setSaved((n) => n + 1)}>Save</Button>
            <Button disabled>Delete</Button>
            <Button>Private client 183777</Button>
            <output>Saved {saved} times</output>
          </dialog>
        </div>
        <Panel />
      </>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    const box = await canvas.findByRole('textbox', { name: 'Message Heidi' })
    await userEvent.type(box, 'Zapisz formularz{Enter}')
    const log = within(await canvas.findByRole('log', { name: 'Conversation' }))
    await userEvent.click(await log.findByRole('button', { name: 'Save' }))
    await expect(canvas.getByText('Saved 0 times')).toBeVisible()
    await userEvent.click(log.getByRole('button', { name: 'Confirm' }))
    await expect(canvas.getByText('Saved 1 times')).toBeVisible()
    await expect(log.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}
