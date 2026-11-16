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

export const Company: Story = {
  play: async ({ canvasElement }) => {
    await next(canvasElement, 'welcome', /Get started/)
    const company = within(await step(canvasElement, 'company'))
    const zip = company.getByLabelText(/^ZIP/)
    await waitFor(() => expect(zip).toBeEnabled())
    // Focusing a field leaves every field below it where it was.
    const iban = company.getByLabelText('IBAN')
    const before = iban.getBoundingClientRect().top
    await userEvent.click(zip)
    await expect(zip).toHaveFocus()
    await expect(iban.getBoundingClientRect().top).toBe(before)
  },
}

/** A new workspace: the company step has no way past it until the required details are in. */
export const CompanyRequired: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoice-settings', () =>
          HttpResponse.json({
            data: sampleSettings({
              seller: {
                ...settings.seller,
                name: '',
                street: '',
                street_number: '',
                apt: null,
                zip: '',
                city: '',
              },
            }),
          }),
        ),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await next(canvasElement, 'welcome', /Get started/)
    const company = within(await step(canvasElement, 'company'))
    await waitFor(() => expect(company.getByLabelText(/Company name/)).toBeEnabled())
    await expect(company.queryByRole('button', { name: /do it later|Skip/ })).toBeNull()
    await userEvent.click(company.getByRole('button', { name: /Continue/ }))
    const name = await company.findByLabelText(/Company name/)
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(name).toHaveFocus())
    await expect(company.getByLabelText(/Apt \/ suite/)).not.toHaveAttribute('aria-invalid')
    await expect(canvasElement.querySelector('[data-testid="onboarding-step-logo"]')).toBeNull()
  },
}

export const CompanyRequiredDark: Story = {
  ...CompanyRequired,
  parameters: { ...CompanyRequired.parameters, dark: true },
}

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

/** A save the server refuses: the step stays, with the reason in a danger callout above it. */
export const SaveError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.put('/api/v1/invoice-settings', () =>
          HttpResponse.json(
            { error: { code: 'internal', message: 'The settings could not be saved.' } },
            { status: 500 },
          ),
        ),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await next(canvasElement, 'welcome', /Get started/)
    await next(canvasElement, 'company', /Continue/)
    const alert = await within(canvasElement).findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'danger')
    await expect(alert.querySelector('svg')).not.toBeNull()
    await expect(within(canvasElement).getByTestId('onboarding-step-company')).toBeVisible()
  },
}

export const SaveErrorDark: Story = {
  ...SaveError,
  parameters: { ...SaveError.parameters, dark: true },
}
