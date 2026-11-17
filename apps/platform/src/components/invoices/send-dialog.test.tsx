import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { QuoteSendDialog } from '@/components/quotes/quote-dialogs'
import { emailTemplateHandlers } from '@/mocks/email-templates'
import { sampleQuote } from '@/mocks/quotes'
import { listItem, sampleInvoice } from '@/test/invoice-api'

import { SendDialog } from './invoice-dialogs'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const invoice = listItem(sampleInvoice({ status: 'open', number: '2026-001' }))
const quote = sampleQuote({ id: 'quo_sent' })
const fakeDraft = { to: ['billing@acme.ch'], subject: 'Fake subject', message: 'Fake\n\nmessage' }

/** The fake draft by default, the real mock of the email API with SUPERLITE_REAL=1. */
const draftHandlers = () =>
  process.env.SUPERLITE_REAL
    ? emailTemplateHandlers
    : [
        http.get('/api/v1/invoices/:id/email', () => HttpResponse.json({ data: fakeDraft })),
        http.get('/api/v1/quotes/:id/email', () => HttpResponse.json({ data: fakeDraft })),
      ]

const draftOf = async (path: string) => (await (await fetch(path)).json()).data

function open(kind: 'invoice' | 'quote', handlers: Parameters<typeof server.use> = []) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const posted: { body: Record<string, unknown> | null } = { body: null }
  server.use(
    ...handlers,
    http.get('/api/v1/clients/:id', () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'No.' } }, { status: 404 }),
    ),
    http.post<never, Record<string, unknown>>(
      /\/api\/v1\/(invoices|quotes)\/[^/]+\/send$/,
      async ({ request }) => {
        posted.body = await request.json()
        return HttpResponse.json({ data: kind === 'invoice' ? sampleInvoice() : sampleQuote() })
      },
    ),
    ...draftHandlers(),
  )
  render(
    <QueryClientProvider client={queries}>
      <TooltipProvider>
        {kind === 'invoice' ? (
          <SendDialog invoice={invoice} onClose={() => {}} />
        ) : (
          <QuoteSendDialog quote={quote} onClose={() => {}} />
        )}
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return Object.assign(posted, { queries })
}

const field = (name: RegExp) => screen.getByRole('textbox', { name })

test.each([
  ['invoice', '/api/v1/invoices/inv_1/email'],
  ['quote', '/api/v1/quotes/quo_sent/email'],
] as const)(
  'prefillsSubjectAndMessageFromDraft and sendsTheShownTexts (%s)',
  async (kind, path) => {
    const posted = open(kind)
    const draft = await draftOf(path)
    expect(field(/^Subject/)).toBeDisabled()
    await vi.waitFor(() => expect(field(/^Subject/)).toHaveValue(draft.subject))
    expect(field(/^Message/)).toHaveValue(draft.message)
    expect(field(/^Message/)).not.toHaveAttribute('placeholder')
    expect(field(/^To/)).toHaveValue(draft.to.join(', '))
    expect(field(/^Subject/)).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => expect(posted.body).not.toBeNull())
    expect(posted.body).toEqual({ to: draft.to, subject: draft.subject, message: draft.message })
  },
)

test('userEditsAreNotOverwrittenByRefetch', async () => {
  let calls = 0
  const posted = open('invoice', [
    http.get('/api/v1/invoices/:id/email', async () => {
      calls += 1
      await delay(calls === 1 ? 0 : 50)
      return HttpResponse.json({ data: { ...fakeDraft, subject: `Draft ${calls}` } })
    }),
  ])
  await vi.waitFor(() => expect(field(/^Subject/)).toHaveValue('Draft 1'))
  await userEvent.clear(field(/^Subject/))
  await userEvent.type(field(/^Subject/), 'Mine')
  await userEvent.clear(field(/^To/))
  await userEvent.type(field(/^To/), 'me@x.ch')
  void posted.queries.refetchQueries()
  await vi.waitFor(() => expect(calls).toBeGreaterThan(1))
  await delay(100)
  expect(field(/^Subject/)).toHaveValue('Mine')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await vi.waitFor(() => expect(posted.body).not.toBeNull())
  expect(posted.body).toMatchObject({ to: ['me@x.ch'], subject: 'Mine' })
})

test.each([
  ['invoice', 'invoices/:id'],
  ['quote', 'quotes/:id'],
] as const)('draftErrorFallsBackToEmptyFields (%s)', async (kind, route) => {
  const posted = open(kind, [
    http.get(`/api/v1/${route}/email`, () =>
      HttpResponse.json({ error: { code: 'internal', message: 'No.' } }, { status: 500 }),
    ),
  ])
  await vi.waitFor(() => expect(field(/^Subject/)).toBeEnabled())
  expect(field(/^Subject/)).toHaveValue('')
  expect(field(/^Message/)).toHaveValue('')
  await userEvent.type(field(/^To/), 'a@b.ch')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await vi.waitFor(() => expect(posted.body).not.toBeNull())
  expect(posted.body).toEqual({ to: ['a@b.ch'] })
})
