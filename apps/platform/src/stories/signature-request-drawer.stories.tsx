import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { RequestDrawer } from '@/components/signatures/request-drawer'
import type { SignatureEvent, SignatureRequest, Signer } from '@/lib/signatures'

import { dark, desktop, pageParameters, phone } from './pages/frame'

const signer = (change: Partial<Signer>): Signer => ({
  id: 'sgr_1',
  position: 1,
  name: 'Piotr Krajewski',
  email: 'piotr@example.ch',
  status: 'signed',
  sent_at: '2026-11-20T10:00:00Z',
  viewed_at: '2026-11-20T11:00:00Z',
  signed_at: '2026-11-20T12:00:00Z',
  declined_at: null,
  decline_reason: null,
  ...change,
})

const event = (type: SignatureEvent['type'], index: number, who?: Signer): SignatureEvent => ({
  type,
  signer: who ? { id: who.id, name: who.name, email: who.email } : null,
  at: `2026-11-2${index % 10}T10:0${index % 10}:00Z`,
  ip: '203.0.113.24',
  user_agent: 'Mozilla/5.0',
  hash: `h${index}`,
})

const first = signer({})
const second = signer({
  id: 'sgr_2',
  position: 2,
  name: 'Piotr Krajewski',
  email: 'piotr.krajewski@example.ch',
  status: 'sent',
  viewed_at: null,
  signed_at: null,
})

const request = (change: Partial<SignatureRequest> = {}): SignatureRequest => ({
  id: 'sig_1',
  title: 'Services Agreement',
  message: null,
  status: 'pending',
  signing_order: 'sequential',
  document: { id: 'doc_1', name: 'Services Agreement.pdf' },
  signed_document: null,
  folder_id: null,
  original_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  final_sha256: null,
  page_count: 1,
  expires_at: '2026-12-23T10:00:00Z',
  created_by: { id: 'usr_1', name: 'Anna Muster' },
  created_at: '2026-11-20T10:00:00Z',
  completed_at: null,
  signers: [{ ...first, name: 'Luc Romand', email: 'luc@example.ch' }, second],
  fields: [],
  events: [event('created', 0), event('sent', 1, first), event('viewed', 2, first)],
  ...change,
})

const shown = (data: SignatureRequest) =>
  pageParameters('/documents', {}, [
    http.get('/api/v1/signatures/:id', () => HttpResponse.json({ data })),
    http.get('/api/v1/signatures/:id/original', () => new HttpResponse(null, { status: 404 })),
  ])

const meta = {
  title: 'Documents/Signature request drawer',
  parameters: shown(request()),
  render: () => (
    <>
      <RequestDrawer id="sig_1" onClose={() => {}} />
      <Toaster />
    </>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const sidebar = async () =>
  body().findByRole('complementary', { name: 'Details' }, { timeout: 8000 })

/** Out for signature one after another: Send reminder names the signer whose turn it is. */
export const SendReminder: Story = {
  play: async () => {
    const button = await body().findByRole('button', { name: 'Send reminder' }, { timeout: 8000 })
    await userEvent.hover(button)
    await expect(await body().findByRole('tooltip')).toHaveTextContent('Reminds Piotr Krajewski')
  },
}

/** A completed request has nobody to remind: no Send reminder, no Revoke. */
export const CompletedHidesReminder: Story = {
  parameters: shown(
    request({
      status: 'completed',
      completed_at: '2026-11-22T10:00:00Z',
      signers: [first, { ...second, status: 'signed', signed_at: '2026-11-22T10:00:00Z' }],
    }),
  ),
  play: async () => {
    await sidebar()
    await expect(body().queryByRole('button', { name: 'Send reminder' })).toBeNull()
    await expect(body().queryByRole('button', { name: 'Revoke' })).toBeNull()
  },
}

const long = 'Maximiliane Alexandra von Hohenzollern-Sigmaringen-Wittelsbach'
const longEmail =
  'maximiliane.alexandra.von.hohenzollern-sigmaringen@a-very-long-company-domain.example.ch'

/** Very long names and emails truncate inside the sidebar; nothing runs off its right edge and badges stay whole. */
export const LongNames: Story = {
  parameters: shown(
    request({
      created_by: { id: 'usr_1', name: long },
      document: { id: 'doc_1', name: `${long} – Services Agreement final version.pdf` },
      signers: [
        signer({ name: long, email: longEmail }),
        signer({
          id: 'sgr_2',
          position: 2,
          name: long,
          email: longEmail,
          status: 'viewed',
          signed_at: null,
        }),
      ],
      events: [event('created', 0), event('viewed', 1, signer({ name: long, email: longEmail }))],
    }),
  ),
  play: async () => {
    const aside = await sidebar()
    await waitFor(() => expect(within(aside).getAllByText(long).length).toBeGreaterThan(0))
    await expect(aside.scrollWidth).toBeLessThanOrEqual(aside.clientWidth)
    // Truncated text is clipped by its own box; what matters is that no box pushes the sidebar wider.
    const badge = within(aside).getByText('Viewed')
    await expect(badge).toBeVisible()
    await expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth)
    await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(
      aside.getBoundingClientRect().right,
    )
    await expect(within(aside).getByText(/^9f86d081884c…f00a08$/)).toBeVisible()
  },
}
export const LongNamesPhone = phone(LongNames)

/** Every kind of step in the audit trail, each with its own colour and icon. */
export const AllEvents: Story = {
  parameters: shown(
    request({
      status: 'expired',
      signers: [first, { ...second, status: 'declined', declined_at: '2026-11-22T10:00:00Z' }],
      events: [
        event('created', 0),
        event('sent', 1, first),
        event('reminded', 2, first),
        event('viewed', 3, first),
        event('signed', 4, first),
        event('declined', 5, second),
        event('revoked', 6),
        event('completed', 7),
      ],
    }),
  ),
  play: async () => {
    const aside = await sidebar()
    const trail = await within(aside).findByRole('list', { name: 'Audit trail' })
    const tones = [...trail.querySelectorAll('li')].map((item) => item.dataset.tone)
    await expect(tones).toEqual([
      'neutral',
      'info',
      'info',
      'violet',
      'success',
      'danger',
      'danger',
      'success',
      'warning',
    ])
  },
}
export const AllEventsDark = dark(AllEvents)
