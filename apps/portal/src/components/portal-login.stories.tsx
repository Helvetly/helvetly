import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalHandlers, portalScope, scopedPortal } from '@/mocks/portal'

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

/** Under a workspace's own address (/w/<slug>/): its name and mark, not Helvetly's. */
export const WorkspaceBranding: Story = {
  parameters: { msw: { handlers: [signedOut, scopedPortal(), ...portalHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Müller Treuhand AG' })).toBeVisible()
    await expect(canvas.getByText('MT')).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Client portal' })).toBeNull()
    await expect(canvas.getByLabelText('Email')).toBeVisible()
  },
}

const logo =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#3b6e8f"/><path d="M16 44V20l16 14 16-14v24" stroke="#fff" stroke-width="5" fill="none"/></svg>',
  )

export const WorkspaceLogo: Story = {
  parameters: {
    msw: {
      handlers: [signedOut, scopedPortal({ ...portalScope, logo_url: logo }), ...portalHandlers],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Müller Treuhand AG' })).toBeVisible()
    await waitFor(() =>
      expect(canvasElement.querySelector(`img[src^="data:image/svg"]`)).not.toBeNull(),
    )
  },
}

export const WorkspaceBrandingPhone: Story = {
  parameters: { ...WorkspaceBranding.parameters, ...phone },
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await WorkspaceBranding.play?.(context)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}
