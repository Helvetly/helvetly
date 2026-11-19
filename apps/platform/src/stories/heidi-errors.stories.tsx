import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider, useHeidi } from '@/components/heidi/heidi-provider'

import { screenHandlers } from './screen-fixtures'

const scope = 'storybook:heidi-errors'
const base = [
  ...screenHandlers,
  http.get('/api/v1/heidi/usage', () =>
    HttpResponse.json({
      period: '2026-11',
      tokens_used: 0,
      tokens_included: 1000,
      tokens_purchased: 0,
      tokens_remaining: 1000,
      mode: 'openai',
      usage_uncertain: false,
      can_purchase: false,
    }),
  ),
  http.get('/api/v1/heidi/suggestions', () =>
    HttpResponse.json({
      data: [{ title: 'Refund', prompt: 'Refund 16 of 24 prepaid lessons' }],
    }),
  ),
]

/** The server's words stand in for an older or unknown code; known codes are worded by the app. */
const serverWords = 'Server words that must not be shown.'

/** A turn that streams its status, then ends with an error frame of code. */
const failing = (code: string) =>
  http.post(
    '/api/v1/heidi/chat',
    () =>
      new HttpResponse(
        `data: {"type":"status","label":"Writing the answer"}\n\ndata: ${JSON.stringify({ type: 'error', code, message: serverWords })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  )

function Open() {
  const heidi = useHeidi()
  return <Button onClick={() => heidi?.setOpen(true)}>Open assistant</Button>
}

const meta = {
  title: 'Heidi/Errors',
  render: () => (
    <HeidiProvider scope={scope}>
      <Open />
      <HeidiPanel />
    </HeidiProvider>
  ),
  beforeEach: () => {
    for (const key of ['helvetly:heidi:panel', `helvetly:heidi:conversation:${scope}`])
      localStorage.removeItem(key)
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const failsWith = (code: string, text: RegExp): Story => ({
  parameters: { msw: { handlers: [failing(code), ...base] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Refund 16 of 24 prepaid lessons' }),
    )
    const log = await canvas.findByRole('log', { name: 'Conversation' })
    const alert = await within(log).findByRole('alert')
    await waitFor(() => expect(alert).toBeVisible())
    await expect(alert).toHaveTextContent(text)
    await expect(alert).not.toHaveTextContent(serverWords)
    await expect(alert).not.toHaveTextContent(/OpenAI|reconcil/i)

    // The icon sits on the first line of text; Retry comes after the text, below it.
    const message = within(alert).getByText(text)
    const retry = within(alert).getByRole('button', { name: 'Retry' })
    const icon = alert.querySelector('svg')
    if (!icon) throw new Error('alert icon')
    const top = message.getBoundingClientRect().top
    await expect(Math.abs(icon.getBoundingClientRect().top - top)).toBeLessThan(6)
    await expect(retry.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      message.getBoundingClientRect().bottom - 1,
    )
  },
})

/** A temporary provider failure: plain words and a Retry. */
export const ProviderUnavailable = failsWith(
  'heidi_provider_unavailable',
  /Heidi couldn't answer right now\. Nothing was changed\. Try again in a moment\./,
)

/** The provider's rate limit, after the server's own retries. */
export const RateLimited = failsWith(
  'heidi_busy',
  /Heidi is busy right now\. Try again in a minute\./,
)

/** Wrong key, model or provider account: owners and admins are told what to check. */
export const Misconfigured = failsWith(
  'heidi_ai_misconfigured',
  /AI is not configured correctly\. Check the model settings\./,
)

/** Another Heidi call is still in flight: no jargon, local commands still work. */
export const UsageBeingChecked = failsWith(
  'heidi_usage_uncertain',
  /Heidi is still finishing an earlier request.*local commands still work\./,
)

export const RateLimitedDark: Story = {
  ...RateLimited,
  parameters: { ...RateLimited.parameters, dark: true },
}

/** A refusal before the stream starts (HTTP 503) is worded by its code too. */
export const RefusedBeforeStreaming: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/heidi/chat', () =>
          HttpResponse.json(
            { error: { code: 'heidi_busy', message: serverWords } },
            { status: 503 },
          ),
        ),
        ...base,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Refund 16 of 24 prepaid lessons' }),
    )
    const alert = await within(await canvas.findByRole('log', { name: 'Conversation' })).findByRole(
      'alert',
    )
    await expect(alert).toHaveTextContent('Heidi is busy right now. Try again in a minute.')
  },
}
