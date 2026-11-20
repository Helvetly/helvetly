import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { accountChoice, portalHandlers, scopedPortal } from '@/mocks/portal'

import { PortalLogin } from './portal-login'

const signedOut = http.get('/api/v1/public/portal/session', () =>
  HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in.' } }, { status: 401 }),
)

const meta = {
  title: 'Portal/Login',
  component: PortalLogin,
  // Signed out by default: the sign-in page sends a signed-in client home instead.
  parameters: { msw: { handlers: [signedOut, ...portalHandlers] } },
} satisfies Meta<typeof PortalLogin>
export default meta
type Story = StoryObj<typeof meta>

export const EmailThenCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(await canvas.findByLabelText('Email'), 'anna@example.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(await canvas.findByText('Check your email')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Resend code in/ })).toBeDisabled()
  },
}

export const WrongCodeShowsTriesLeft: Story = {
  parameters: {
    msw: {
      handlers: [
        signedOut,
        http.post('/api/v1/public/portal/auth/verify', () =>
          HttpResponse.json(
            {
              error: {
                code: 'code_invalid',
                message: 'Wrong code.',
                details: { attempts_left: 2 },
              },
            },
            { status: 400 },
          ),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(await canvas.findByLabelText('Email'), 'anna@example.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await userEvent.type(await canvas.findByLabelText('Code'), '123456')
    await waitFor(() => expect(canvas.getByText(/2 tries left/)).toBeVisible())
  },
}

export const SignedInShowsNoForm: Story = {
  parameters: { msw: { handlers: portalHandlers } },
  play: async ({ canvasElement }) => {
    // A client who is already signed in is sent home; the form never shows.
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy]')).not.toBeNull())
    await expect(within(canvasElement).queryByLabelText('Email')).toBeNull()
  },
}

export const ResendShowsAToast: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/public/portal/auth/start', () =>
          HttpResponse.json({ resend_in: 0, expires_in: 600 }, { status: 202 }),
        ),
        signedOut,
        ...portalHandlers,
      ],
    },
  },
  render: () => (
    <>
      <PortalLogin />
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(await canvas.findByLabelText('Email'), 'anna@example.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Resend code' }))
    await expect(await canvas.findByText('New code sent')).toBeInTheDocument() // the toast
    await expect(canvas.getByText('The previous one no longer works.')).toBeInTheDocument()
  },
}

const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

/** The trust line under the card: no password, a one-time code by email. */
export const Welcome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Client portal' })).toBeVisible()
    await expect(canvas.getByText('No password — we email you a one-time code.')).toBeVisible()
  },
}

export const Languages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Change language/ }))
    const page = within(document.body)

    await Promise.all(
      ['Deutsch', 'English', 'Français', 'Italiano'].map((name) =>
        expect(within(page.getByRole('dialog')).getByRole('button', { name })).toBeVisible(),
      ),
    )

    await userEvent.keyboard('{Escape}')
    await expect(await canvas.findByRole('button', { name: /^Change language/ })).toHaveFocus()
  },
}

export const WelcomeDark: Story = { ...Welcome, parameters: { ...meta.parameters, dark: true } }

export const WelcomePhone: Story = {
  parameters: { ...meta.parameters, ...phone },
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await Welcome.play?.(context)
    await expect(window.innerWidth).toBe(390)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

export const CodeStepDark: Story = {
  parameters: { ...meta.parameters, dark: true },
  play: EmailThenCode.play,
}

/** On a phone the six code boxes fit without pushing the page sideways. */
export const CodeStepPhone: Story = {
  parameters: { ...meta.parameters, ...phone },
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await EmailThenCode.play?.(context)
    await expect(window.innerWidth).toBe(390)
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

/** A supplier's own sign-in: its mark and name above the form, Helvetly's logo gone. */
export const Branded: Story = {
  args: { workspace: { name: 'Muster Beratung und Treuhand AG' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Muster Beratung und Treuhand AG')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Client portal' })).toBeVisible()
    await expect(canvas.getByText('MB')).toBeVisible()
  },
}

/** Under a workspace's own address (/w/<slug>/) the page reads the mark and name from GET /scope. */
export const WorkspaceAddress: Story = {
  parameters: { msw: { handlers: [signedOut, scopedPortal(), ...portalHandlers] } },
  // The page reads its scope from the address; the story's own address comes back afterwards.
  beforeEach: () => {
    const before = window.location.href
    window.history.replaceState(window.history.state, '', '/w/mueller-treuhand/login/')
    return () => window.history.replaceState(window.history.state, '', before)
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Müller Treuhand AG')).toBeVisible()
    await expect(canvas.getByText('MT')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Client portal' })).toBeVisible()
    await expect(canvas.getByLabelText('Email')).toBeVisible()
  },
}

/** The workspace turned its whole portal off: the calm "not available" page instead of the form, naming nobody. */
export const WorkspacePortalOff: Story = {
  parameters: {
    msw: {
      handlers: [
        signedOut,
        http.get('/api/v1/public/portal/scope', () =>
          HttpResponse.json(
            { error: { code: 'portal_closed', message: 'This client portal is not available.' } },
            { status: 404 },
          ),
        ),
        ...portalHandlers,
      ],
    },
  },
  beforeEach: WorkspaceAddress.beforeEach,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'The client portal is not available' }),
    ).toBeVisible()
    await expect(canvas.queryByLabelText('Email')).toBeNull()
    await expect(canvas.queryByText('Müller Treuhand AG')).toBeNull()
  },
}

export const WorkspaceAddressPhone: Story = {
  parameters: { ...WorkspaceAddress.parameters, ...phone },
  beforeEach: WorkspaceAddress.beforeEach,
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await WorkspaceAddress.play?.(context)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/** On the shared portal an address with several clients chooses one right after its code. */
export const CodeThenAccountChooser: Story = {
  parameters: { msw: { handlers: [signedOut, ...accountChoice(), ...portalHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(await canvas.findByLabelText('Email'), 'anna@example.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await userEvent.type(await canvas.findByLabelText('Code'), '123456')
    await expect(await canvas.findByRole('heading', { name: 'Choose an account' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Müller Treuhand AG as Keller AG' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Studio Berg as Anna Keller' })).toBeVisible()
    await expect(canvas.getByText('anna@example.ch')).toBeVisible()
    // Another address: back to the email step.
    await userEvent.click(canvas.getByRole('button', { name: 'Use another email' }))
    await expect(await canvas.findByLabelText('Email')).toBeVisible()
  },
}

let redeemed: string[] = []
const ticketArrival = {
  parameters: {
    msw: {
      handlers: [
        signedOut,
        scopedPortal(),
        http.post('/api/v1/public/portal/auth/ticket', async ({ request }) => {
          redeemed.push(((await request.json()) as { ticket: string }).ticket)
          return HttpResponse.json(
            { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
            { status: 401 },
          )
        }),
        ...portalHandlers,
      ],
    },
  },
  beforeEach: () => {
    redeemed = []
    const before = window.location.href
    window.history.replaceState(
      window.history.state,
      '',
      '/w/mueller-treuhand/login/#ticket=one-time',
    )
    return () => window.history.replaceState(window.history.state, '', before)
  },
}

/** Arriving from the chooser: the ticket is taken off the address and spent once; a spent one asks to sign in again. */
export const ArrivalWithASpentTicket: Story = {
  ...ticketArrival,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('That sign-in has expired.')
    await expect(redeemed).toEqual(['one-time'])
    await expect(window.location.hash).toBe('')
    await expect(canvas.getByLabelText('Email')).toBeVisible()
  },
}
