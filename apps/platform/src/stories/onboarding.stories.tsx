import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { WelcomePage } from '@/components/onboarding/onboarding'
import type { Session } from '@/lib/api'
import { sampleSettings } from '@/test/invoice-api'

import { storySession } from './screen-fixtures'

const session: Session = { ...storySession, onboarded: false }
const settings = sampleSettings()

const meta = {
  title: 'Onboarding',
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/welcome' } },
    msw: {
      handlers: [
        http.get('/api/v1/session', () => HttpResponse.json(session)),
        http.post('/api/v1/session/onboarded', () => new HttpResponse(null, { status: 204 })),
        http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })),
        http.put('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })),
      ],
    },
  },
  render: () => <WelcomePage session={session} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const step = (canvasElement: HTMLElement, name: string) =>
  within(canvasElement).findByTestId(`onboarding-step-${name}`)
const next = async (canvasElement: HTMLElement, from: string, label: RegExp) => {
  const current = within(await step(canvasElement, from))
  const button = await current.findByRole('button', { name: label })
  // A step's button stays disabled while the previous step still saves.
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

export const Welcome: Story = {
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    // Each step fades in.
    await waitFor(() =>
      expect(welcome.getByRole('heading', { name: 'Welcome to Helvetly, Anna' })).toBeVisible(),
    )
    const cards = welcome.getAllByRole('listitem')
    await expect(cards.length).toBeLessThanOrEqual(4)
    for (const title of [
      'Get paid',
      'Clients & documents',
      'Bring your data',
      'Heidi, your assistant',
    ])
      expect(welcome.getByText(title)).toBeVisible()
  },
}

export const WelcomeDark: Story = { ...Welcome, parameters: { dark: true } }

export const AllSteps: Story = {
  play: async ({ canvasElement }) => {
    await next(canvasElement, 'welcome', /Get started/)
    const company = within(await step(canvasElement, 'company'))
    await waitFor(() =>
      expect(company.getByRole('heading', { name: 'Your company' })).toBeVisible(),
    )
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    await next(canvasElement, 'preferences', /Continue/)
    const done = within(await step(canvasElement, 'done'))
    await waitFor(() => expect(done.getByRole('heading', { name: 'You’re all set' })).toBeVisible())
    await expect(done.getByText('Your company is ready to issue invoices')).toBeVisible()
    for (const name of [
      /Add your first client/,
      /Create an invoice/,
      /Import your clients/,
      /Ask Heidi/,
    ])
      expect(done.getByRole('button', { name })).toBeEnabled()
  },
}

export const AllStepsDark: Story = { ...AllSteps, parameters: { dark: true } }
