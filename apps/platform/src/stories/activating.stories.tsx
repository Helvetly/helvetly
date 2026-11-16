import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, within } from 'storybook/test'

import { Activating } from '@/components/billing/activating'
import { billingFixture } from '@/components/billing/billing-fixture'

import { screenHandlers, sessionHandler } from './screen-fixtures'

// Stripe has not told Helvetly yet: the workspace stays locked for as long as the story runs.
const locked = billingFixture()

const meta = {
  title: 'Financial overview/Activating',
  render: () => <Activating />,
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/activating' } },
    msw: {
      handlers: [
        http.get('/api/v1/billing', () => HttpResponse.json({ data: locked })),
        http.post('/api/v1/billing/sync', () => HttpResponse.json({ data: locked })),
        sessionHandler({ role: 'owner' }),
        ...screenHandlers,
      ],
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Back from a paid Checkout: a spinner and one line while the plan is read. */
export const Loading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'Activating your plan…' }),
    ).toBeVisible()
    await expect(canvas.getByText('Payment received. This takes a few seconds.')).toBeVisible()
    await expect(canvas.getByRole('status', { name: 'Activating your plan…' })).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
  },
}

export const LoadingDark: Story = { ...Loading, parameters: { dark: true } }

/** Still locked after the wait: a calm notice instead of an endless spinner, and two ways on. */
export const Slow: Story = {
  render: () => <Activating slowAfter={0} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('Your payment went through. The plan can take a minute to appear.'),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to billing' }).getAttribute('href')).toMatch(
      /^\/settings\/billing\/?$/,
    )
    await expect(canvas.queryByRole('heading', { name: 'Activating your plan…' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Check again' })).toBeEnabled()
  },
}

export const SlowDark: Story = { ...Slow, parameters: { dark: true } }
