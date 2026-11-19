import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientDetail } from '@/components/clients/client-detail'
import { ClientForm } from '@/components/clients/client-form'
import type { Client, ClientInput } from '@/lib/clients'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/Client portal',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const PORTAL = 'https://portal.helvetly.com/w/mueller-treuhand/'
const saved = fn()
const resent = fn()

/** The client "John" from the report: a person whose only address is the billing email. */
const john = (change: Partial<Client> = {}) =>
  sampleClient({
    name: 'John',
    is_company: false,
    email: null,
    billing_email: 'client1@domain.com',
    portal_enabled: false,
    portal_invited_at: null,
    ...change,
  })

const handlers = (client: Client) => {
  let current = client
  return [
    sessionHandler(),
    http.get('/api/v1/auth/config', () =>
      HttpResponse.json({
        google: false,
        email: true,
        passkey: true,
        dev_codes: false,
      }),
    ),
    http.get('/api/v1/workspace/portal', () =>
      HttpResponse.json({ data: { slug: 'mueller-treuhand', url: PORTAL } }),
    ),
    http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: current })),
    http.patch<never, Partial<ClientInput>>('/api/v1/clients/cli_1', async ({ request }) => {
      const input = await request.json()
      saved(input)
      current = {
        ...current,
        ...input,
        portal_invited_at: input.portal_enabled
          ? '2026-11-10T12:00:00Z'
          : current.portal_invited_at,
      }
      return HttpResponse.json({ data: current })
    }),
    http.post('/api/v1/clients/cli_1/portal-invitation', () => {
      resent()
      current = { ...current, portal_invited_at: '2026-11-11T09:00:00Z' }
      return HttpResponse.json({ data: current })
    }),
    http.get('/api/v1/clients/cli_1/change-request', () => HttpResponse.json({ data: null })),
    http.get('/api/v1/clients/cli_1/self-billing-agreements', () =>
      HttpResponse.json({ data: [] }),
    ),
  ]
}

const detail = () => (
  <>
    <ClientDetail id="cli_1" canDelete onClose={fn()} onCommand={fn()} />
    <Toaster />
  </>
)
const body = () => within(document.body)
/** Waits out the drawer's fade-in. */
const visible = (element: HTMLElement) => waitFor(() => expect(element).toBeVisible())
const portalCard = async () =>
  within(
    (await body().findByRole('heading', { name: 'Client portal' })).closest('section') ??
      document.body,
  )

/** Turning the portal on in the detail lets the billing email sign in and says the invitation went out. */
export const TurnOnInDetail: Story = {
  parameters: { msw: { handlers: handlers(john()) } },
  render: detail,
  play: async () => {
    saved.mockClear()
    const card = await portalCard()
    await visible(await card.findByText('Off'))
    await expect(card.getByText(/Turn it on to let the client sign in/)).toBeVisible()
    await userEvent.click(card.getByRole('switch', { name: 'Client portal' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ portal_enabled: true }))
    await expect(await card.findByText('client1@domain.com')).toBeVisible()
    await expect(card.getByText('On')).toBeVisible()
    await expect(card.getByText('billing email')).toBeVisible()
    await expect(card.getByText('Sent 10 Nov 2026')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Resend' })).toBeVisible()
    await expect(card.queryByRole('alert')).toBeNull()
  },
}

/** On, but the client has no address: a clear warning instead of a login nobody can use. */
export const OnWithoutAnEmail: Story = {
  parameters: {
    msw: { handlers: handlers(john({ billing_email: null, portal_enabled: true })) },
  },
  render: detail,
  play: async () => {
    const card = await portalCard()
    await expect(await card.findByRole('alert')).toHaveTextContent(
      'Add an email to let this client sign in.',
    )
    await expect(card.queryByText('Signs in with')).toBeNull()
    await expect(card.queryByText('Invitation')).toBeNull()
  },
}

/** Not invited yet: a grey "Not sent" badge and "Send invitation", which sends it and shows the date. */
export const SendInvitation: Story = {
  parameters: { msw: { handlers: handlers(john({ portal_enabled: true })) } },
  render: detail,
  play: async () => {
    resent.mockClear()
    const card = await portalCard()
    await visible(await card.findByText('Not sent'))
    await userEvent.click(card.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(resent).toHaveBeenCalledOnce())
    await visible(await card.findByText('Sent 11 Nov 2026'))
    await expect(card.getByRole('button', { name: 'Resend' })).toBeVisible()
    await expect(
      await body().findByText('Invitation sent to client1@domain.com.'),
    ).toBeInTheDocument()
  },
}

/** After the first sign-in the badge says so; resending stays possible. */
export const SignedIn: Story = {
  parameters: {
    msw: {
      handlers: handlers(
        john({
          email: 'john@home.ch',
          portal_enabled: true,
          portal_invited_at: '2026-11-01T10:00:00Z',
          portal_signed_in_at: '2026-11-03T08:00:00Z',
        }),
      ),
    },
  },
  render: detail,
  play: async () => {
    const card = await portalCard()
    await visible(await card.findByText('Signed in 3 Nov 2026'))
    await expect(card.queryByText('billing email')).toBeNull()
    await expect(card.getByRole('button', { name: 'Resend' })).toBeVisible()
  },
}

export const SignedInDark: Story = {
  ...SignedIn,
  parameters: { ...SignedIn.parameters, dark: true },
}

export const SignedInPhone: Story = {
  ...SignedIn,
  parameters: {
    ...SignedIn.parameters,
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}

/** The portal link opens the portal and copies with one click. */
export const CopyPortalLink: Story = {
  parameters: { msw: { handlers: handlers(john({ portal_enabled: true })) } },
  render: detail,
  play: async () => {
    const card = await portalCard()
    await expect(
      await card.findByRole('link', { name: 'portal.helvetly.com/w/mueller-treuhand' }),
    ).toHaveAttribute('href', PORTAL)
    const write = fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    await expect(card.getByRole('link', { name: 'Open the portal' })).toHaveAttribute(
      'target',
      '_blank',
    )
    await userEvent.click(card.getByRole('button', { name: 'Copy portal link' }))
    await expect(write).toHaveBeenCalledWith(PORTAL)
    await expect(await body().findByText('Portal link copied.')).toBeInTheDocument() // the toast
  },
}

/** In the form the portal is its own section; turning it on says who signs in and that saving invites them. */
export const FormSection: Story = {
  parameters: { msw: { handlers: handlers(john()) } },
  render: () => <ClientForm client={john()} onClose={fn()} onSaved={fn()} />,
  play: async () => {
    const section = within(
      (await body().findByRole('heading', { name: 'Client portal' })).closest('section') ??
        document.body,
    )
    // The form puts the cursor in the name shortly after it opens; act after that, as a person would, or the
    // opening focus lands after the click below on a fast machine.
    await waitFor(() => expect(document.getElementById('client-name')).toHaveFocus())
    const billing = within(
      body().getByRole('heading', { name: 'Billing defaults' }).closest('section') ?? document.body,
    )
    await expect(billing.queryByRole('switch', { name: /sign in/i })).toBeNull()
    await userEvent.click(section.getByRole('switch', { name: 'Let the client sign in' }))
    await expect(section.getByText('client1@domain.com')).toBeVisible()
    await expect(
      section.getByText('When you save, client1@domain.com gets an email with the portal link.'),
    ).toBeVisible()

    // Removing the only address turns the line into the warning; its link goes to the email field.
    await userEvent.clear(body().getByLabelText('Invoices go to'))
    await expect(section.getByRole('alert')).toHaveTextContent(
      'Add an email to let this client sign in.',
    )
    await userEvent.click(section.getByRole('button', { name: 'Add an email' }))
    await expect(body().getByLabelText('Email')).toHaveFocus()
  },
}
