import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import type { Field, SigningView } from '@/lib/signatures'

import { SigningPage } from './signing-page'

// No pdf.js in jsdom: the document is its overlay of page 1.
vi.mock('@/components/invoices/pdf-view', () => ({
  PdfView: ({ overlay }: { overlay?: (page: number) => ReactNode }) => (
    <div className="relative">{overlay?.(1)}</div>
  ),
}))
vi.mock('./script-fonts', () => ({
  SCRIPT_FONTS: [{ id: 'a', label: 'Flowing', family: 'serif' }],
}))
vi.mock('./ink', () => ({
  INK: '#000',
  typedPng: async () => 'data:image/png;base64,AAAA',
  trimmedPng: () => 'data:image/png;base64,AAAA',
}))

const field = (id: string, kind: Field['kind'], label: string | null = null): Field => ({
  id,
  signer_id: 'sgr_1',
  page: 1,
  kind,
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.05,
  label,
  value: null,
})

const view = (change: {
  request?: Partial<SigningView['request']>
  signer?: Partial<SigningView['signer']>
}): SigningView => ({
  request: {
    title: 'Service agreement',
    message: 'Please sign.',
    status: 'pending',
    sender: { name: 'Pete K.', email: 'pete@example.com' },
    workspace: 'Muster GmbH',
    expires_at: '2026-12-06T00:00:00Z',
    page_count: 2,
    ...change.request,
  },
  signer: {
    id: 'sgr_1',
    name: 'Anna Muster',
    email: 'anna@example.com',
    status: 'viewed',
    ...change.signer,
  },
  fields: [
    field('sfd_sig', 'signature'),
    field('sfd_date', 'date'),
    field('sfd_job', 'text', 'Job title'),
  ],
  consent_text: 'I agree to sign this document electronically.',
})

let current: SigningView | null = view({})
let signed: unknown
const server = setupServer(
  http.get('/api/v1/public/sign/:token', () =>
    current
      ? HttpResponse.json({ data: current })
      : HttpResponse.json(
          { error: { code: 'link_invalid', message: 'Not valid.' } },
          { status: 404 },
        ),
  ),
  http.post('/api/v1/public/sign/:token', async ({ request }) => {
    signed = await request.json()
    return HttpResponse.json({ data: view({ signer: { status: 'signed' } }) })
  }),
  http.all('*', () => new HttpResponse(null, { status: 404 })),
)
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  window.location.hash = '#tok123'
  current = view({})
  signed = undefined
})

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SigningPage />
    </QueryClientProvider>,
  )

test.each([
  [null, 'This link doesn’t work'],
  [view({ request: { status: 'revoked' } }), 'This request was withdrawn'],
  [view({ signer: { status: 'waiting' } }), 'It’s not your turn yet'],
  [view({ signer: { status: 'signed' } }), 'You’ve signed'],
  [view({ request: { status: 'declined' } }), 'Signing was stopped'],
  [view({ request: { status: 'expired' } }), 'This request has expired'],
])('shows the right state', async (state, title) => {
  current = state
  renderPage()
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
})

test('a link without a token says so', async () => {
  window.location.hash = ''
  renderPage()
  expect(
    await screen.findByRole('heading', { name: 'This link is incomplete' }),
  ).toBeInTheDocument()
})

test('a malformed encoded token shows an invalid link without crashing', async () => {
  current = null
  window.location.hash = '#%E0%A4%A'
  renderPage()
  expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument()
})

test('signing needs the signature, the text fields and consent, then posts them', async () => {
  const user = userEvent.setup()
  renderPage()
  const finish = await screen.findByRole('button', { name: 'Finish' })
  expect(screen.getByText(/simple electronic signature \(SES\)/)).toBeInTheDocument()
  expect(finish).toBeDisabled()

  // The empty field's pulse stops for people who ask for reduced motion.
  expect(screen.getByRole('button', { name: 'Sign here' })).toHaveClass(
    'motion-reduce:animate-none',
  )
  await user.click(screen.getByRole('button', { name: 'Sign here' }))
  await user.click(await screen.findByRole('button', { name: 'Adopt and sign' }))
  await user.type(screen.getByRole('textbox', { name: 'Job title' }), 'CEO')
  expect(finish).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: 'I agree to sign electronically' }))
  await user.click(finish)

  expect(await screen.findByRole('heading', { name: 'You’ve signed' })).toBeInTheDocument()
  expect(signed).toEqual({
    consent: true,
    signature: { method: 'typed', image: 'data:image/png;base64,AAAA' },
    values: { sfd_job: 'CEO' },
  })
})

test('a document changed after it was sent says so and asks for a new one', async () => {
  server.use(
    http.post('/api/v1/public/sign/:token', () =>
      HttpResponse.json(
        { error: { code: 'original_changed', message: 'original_changed' } },
        { status: 409 },
      ),
    ),
  )
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Sign here' }))
  await user.click(await screen.findByRole('button', { name: 'Adopt and sign' }))
  await user.type(screen.getByRole('textbox', { name: 'Job title' }), 'CEO')
  await user.click(screen.getByRole('checkbox', { name: 'I agree to sign electronically' }))
  await user.click(screen.getByRole('button', { name: 'Finish' }))
  expect(
    await screen.findByText(/changed after it was sent, so it can’t be signed\. Ask the sender/),
  ).toBeInTheDocument()
})

test('opening another signing link resets the signature and consent', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Sign here' }))
  await user.click(await screen.findByRole('button', { name: 'Adopt and sign' }))
  await user.type(screen.getByRole('textbox', { name: 'Job title' }), 'CEO')
  await user.click(screen.getByRole('checkbox', { name: 'I agree to sign electronically' }))

  current = view({ request: { title: 'Another agreement' } })
  await act(async () => {
    window.location.hash = '#tok456'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(await screen.findByText('Another agreement')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign here' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Job title' })).toHaveValue('')
  expect(screen.getByRole('checkbox', { name: 'I agree to sign electronically' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
})

test('declining needs a reason', async () => {
  const user = userEvent.setup()
  let reason: unknown
  server.use(
    http.post('/api/v1/public/sign/:token/decline', async ({ request }) => {
      reason = await request.json()
      return HttpResponse.json({ data: view({ signer: { status: 'declined' } }) })
    }),
  )
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Decline' }))
  const confirm = screen.getAllByRole('button', { name: 'Decline' }).at(-1)
  expect(confirm).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Wrong date')
  if (confirm) await user.click(confirm)
  await waitFor(() => expect(reason).toEqual({ reason: 'Wrong date' }))
  expect(await screen.findByRole('heading', { name: 'You declined to sign' })).toBeInTheDocument()
})
