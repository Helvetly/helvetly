import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor } from 'storybook/test'

/**
 * The browser may restart the mock service worker mid-run; it then forgets this page and lets requests through to
 * the dev server. The stories below run in order in one page: the first makes the worker forget the page, the second
 * must still get its mocked answer, because the loader checks the worker before every story.
 */
const meta = {
  title: 'Test harness/Mock worker recovery',
  render: () => <p>Mock worker check</p>,
  tags: ['!dev'],
  parameters: {
    msw: { handlers: [http.get('/api/v1/mock-check', () => HttpResponse.json({ mocked: true }))] },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const WorkerForgetsThePage: Story = {
  play: async () => {
    // What a restarted worker looks like: this page is no longer among its clients.
    navigator.serviceWorker.controller?.postMessage('CLIENT_CLOSE')
    await waitFor(async () => expect((await fetch('/api/v1/mock-check')).status).toBe(404))
  },
}

export const NextStoryIsMockedAgain: Story = {
  play: async () => {
    const response = await fetch('/api/v1/mock-check')
    await expect(response.status).toBe(200)
    await expect(await response.json()).toEqual({ mocked: true })
  },
}
