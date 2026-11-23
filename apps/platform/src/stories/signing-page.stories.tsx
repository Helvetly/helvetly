import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { SigningPage } from '@/components/signatures/signing-page'
import type { SigningView } from '@/lib/signatures'
import { blankPdf } from '@/mocks/blank-pdf'

const body = () => within(document.body)
/** The one of several copies (the header's and the phone's action bar's) shown at this width. */
const shown = (elements: HTMLElement[]) => elements.filter((el) => el.checkVisibility())

// A 36 px high logo, as the email logo endpoint serves it.
const logo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="36"><rect width="96" height="36" rx="6" fill="#0b7268"/><text x="48" y="24" font-family="sans-serif" font-size="15" fill="#fff" text-anchor="middle">Muster</text></svg>',
)}`

const signingView = (request: Partial<SigningView['request']> = {}): SigningView => ({
  request: {
    title: 'Services Agreement',
    message: 'Hello Anna, here is the agreement we discussed. Thank you!',
    status: 'pending',
    sender: { name: 'Pete Keller', email: 'pete@muster.ch' },
    workspace: 'Muster Treuhand AG',
    logo,
    expires_at: '2026-12-23T00:00:00Z',
    page_count: 1,
    ...request,
  },
  signer: { id: 'sgr_1', name: 'Anna Kunde', email: 'anna@example.com', status: 'viewed' },
  fields: [
    {
      id: 'sfd_sig',
      signer_id: 'sgr_1',
      page: 1,
      kind: 'signature',
      x: 0.12,
      y: 0.78,
      w: 0.3,
      h: 0.06,
      label: null,
      value: null,
    },
  ],
  consent_text:
    'I agree to sign this document electronically. My electronic signature is a simple electronic signature (SES) and binds me as my handwritten one would where the law allows it.',
})

const handlers = (view: SigningView) => [
  http.get('/api/v1/public/sign/:token', () => HttpResponse.json({ data: view })),
  http.get('/api/v1/public/sign/:token/document', () =>
    HttpResponse.text(blankPdf(), { headers: { 'Content-Type': 'application/pdf' } }),
  ),
]

const meta = {
  title: 'Signatures/Signing page',
  component: SigningPage,
  parameters: {
    layout: 'fullscreen',
    bare: true,
    ownMain: true,
    msw: { handlers: handlers(signingView()) },
  },
  beforeEach: () => {
    window.location.hash = '#TOKENTOKENTOKEN234'
    return () => {
      window.location.hash = ''
    }
  },
} satisfies Meta<typeof SigningPage>
export default meta
type Story = StoryObj<typeof meta>

/** The business's logo and name lead; the member who sent it is named once, as the sender. */
export const Branded: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText('Muster Treuhand AG asks you to sign “Services Agreement”')
    await expect(canvas.getByRole('heading', { name: 'Services Agreement' })).toBeVisible()
    await expect(canvas.getAllByText('Muster Treuhand AG')[0]).toBeVisible()
    await expect(canvasLogo()).toBeVisible()
    await expect(shown(canvas.getAllByText('0 of 1 fields'))).toHaveLength(1)
    await expect(canvas.getAllByText('Sent by Pete Keller')[0]).toBeVisible()
    await expect(canvas.queryByText(/Pete Keller from/)).toBeNull()
  },
}

const canvasLogo = () => document.querySelector<HTMLImageElement>('header img')

/** Without a logo, a neutral monogram of the company name. */
export const Monogram: Story = {
  parameters: { msw: { handlers: handlers(signingView({ logo: '' })) } },
  play: async ({ canvas }) => {
    await canvas.findByText('Muster Treuhand AG asks you to sign “Services Agreement”')
    await expect(canvasLogo()).toBeNull()
    await expect(canvas.getByText('MT')).toBeVisible()
  },
}

/** The full consent text stays one click away; Finish says why it is off until the field and consent are done. */
export const ConsentAndFinish: Story = {
  play: async ({ canvas }) => {
    const finish = await canvas.findByRole('button', { name: 'Finish' })
    await expect(finish).toBeDisabled()

    await userEvent.click(canvas.getByRole('button', { name: 'Details' }))
    await expect(
      await body().findByText(/My electronic signature is a simple electronic signature/),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(canvas.getByRole('button', { name: 'What does this mean?' }))
    await expect(await body().findByText(/not a qualified one \(QES\)/)).toBeVisible()
    await userEvent.keyboard('{Escape}')

    await userEvent.hover(finish.parentElement ?? finish)
    await expect(
      await body().findByRole('tooltip', {
        name: 'Fill in every field and agree to sign electronically first.',
      }),
    ).toBeInTheDocument()
    await userEvent.unhover(finish.parentElement ?? finish)

    await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to sign electronically' }))
    await expect(canvas.getByRole('button', { name: 'Finish' })).toBeDisabled()

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Sign here' }, { timeout: 5000 }),
    )
    await userEvent.click(await body().findByRole('button', { name: 'Adopt and sign' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Finish' })).toBeEnabled())
    await expect(shown(canvas.getAllByText('1 of 1 fields'))).toHaveLength(1)
  },
}

/** Phones: the logo and the title in the header, progress in the action bar, nothing cut off sideways. */
export const Phone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Services Agreement' })).toBeVisible()
    await expect(canvasLogo()).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Decline' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Finish' })).toBeVisible()
    await expect(shown(canvas.getAllByText('0 of 1 fields'))).toHaveLength(1)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/** A closed request keeps the business's branding. */
export const Completed: Story = {
  parameters: {
    msw: {
      handlers: handlers({
        ...signingView({ status: 'completed' }),
        signer: { id: 'sgr_1', name: 'Anna Kunde', email: 'anna@example.com', status: 'signed' },
      }),
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Everyone has signed' })).toBeVisible()
    await expect(canvas.getByText('Muster Treuhand AG')).toBeVisible()
  },
}
