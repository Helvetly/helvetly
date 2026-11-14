import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider } from '@/components/heidi/heidi-provider'
import { HelpDialog } from '@/components/help/help-dialog'

import { screenHandlers } from './screen-fixtures'

const scope = 'storybook:help'
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
const heidiHandlers = [
  ...screenHandlers,
  http.get('/api/v1/heidi/usage', () => HttpResponse.json(usage)),
  http.get('/api/v1/heidi/suggestions', () =>
    HttpResponse.json({
      data: [{ title: 'Overdue invoices', prompt: 'Which invoices are overdue?' }],
    }),
  ),
]
const feedbackOk = http.post('/api/v1/feedback', () =>
  HttpResponse.json({ id: 'f1' }, { status: 201 }),
)

function Host() {
  const [open, setOpen] = useState(true)
  return (
    <HeidiProvider scope={scope}>
      <Button onClick={() => setOpen(true)}>Help</Button>
      <HeidiPanel />
      <HelpDialog open={open} onOpenChange={setOpen} />
    </HeidiProvider>
  )
}

const meta = {
  title: 'Help & feedback',
  parameters: { msw: { handlers: [...heidiHandlers, feedbackOk] } },
  beforeEach: () => {
    for (const key of ['helvetly:heidi:panel', `helvetly:heidi:conversation:${scope}`])
      localStorage.removeItem(key)
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const dialog = () => within(document.body).findByRole('dialog', { name: 'Help & feedback' })
const png = (name: string, size = 3) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' })

export const Default: Story = {
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await expect(help.getByRole('radio', { name: /Report a problem/ })).toBeChecked()
    // The dialog fades in.
    await waitFor(() => expect(help.getByRole('button', { name: /Ask Heidi/ })).toBeVisible())
    await expect(help.getByRole('button', { name: /Drop, paste or browse/ })).toBeVisible()
  },
}

export const AskHeidiOpensThePanel: Story = {
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.click(help.getByRole('button', { name: /Ask Heidi/ }))
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog', { name: 'Help & feedback' })).toBeNull(),
    )
    const panel = document.body.querySelector('aside[aria-label="Heidi"]')
    await waitFor(() => expect(panel).not.toHaveAttribute('inert'))
  },
}

export const FeedbackValidation: Story = {
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.click(help.getByRole('button', { name: 'Send feedback' }))
    await expect(await help.findByRole('alert')).toHaveTextContent('Describe what happened')
  },
}

export const TooManyScreenshots: Story = {
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.upload(
      help.getByLabelText(/Screenshots/),
      Array.from({ length: 6 }, (_, i) => png(`s${i + 1}.png`)),
    )
    await expect(await help.findByRole('alert')).toHaveTextContent('at most 5')
    await userEvent.click(help.getByRole('button', { name: 'Remove screenshot 6: s6.png' }))
    await waitFor(() => expect(help.queryByRole('alert')).toBeNull())
  },
}

export const ScreenshotTooLarge: Story = {
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.upload(help.getByLabelText(/Screenshots/), png('big.png', 5 * 1024 * 1024 + 1))
    await expect(await help.findByRole('alert')).toHaveTextContent('big.png is larger than 5 MB')
  },
}

export const FeedbackSending: Story = {
  parameters: {
    msw: {
      handlers: [http.post('/api/v1/feedback', () => delay('infinite')), ...heidiHandlers],
    },
  },
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.type(help.getByLabelText(/Description/), 'The totals look off')
    await userEvent.click(help.getByRole('button', { name: 'Send feedback' }))
    const sending = await help.findByRole('button', { name: 'Sending…' })
    await expect(sending).toBeDisabled()
    await expect(help.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
}

export const FeedbackServerError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/feedback', () =>
          HttpResponse.json(
            { error: { code: 'rate_limited', message: 'Too many reports. Try again later.' } },
            { status: 429 },
          ),
        ),
        ...heidiHandlers,
      ],
    },
  },
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.type(help.getByLabelText(/Description/), 'The totals look off')
    await userEvent.click(help.getByRole('button', { name: 'Send feedback' }))
    await expect(await help.findByRole('alert')).toHaveTextContent('Too many reports')
  },
}

export const FeedbackSent: Story = {
  render: () => <Host />,
  play: async () => {
    const help = within(await dialog())
    await userEvent.click(help.getByRole('radio', { name: /Suggest an idea/ }))
    await userEvent.type(help.getByLabelText(/Description/), 'Dark invoices please')
    await userEvent.upload(help.getByLabelText(/Screenshots/), png('a.png'))
    await userEvent.click(help.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog', { name: 'Help & feedback' })).toBeNull(),
    )
  },
}
