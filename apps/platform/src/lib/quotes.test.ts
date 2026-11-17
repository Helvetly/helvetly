import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { resetQuotesMock, sampleQuote } from '@/mocks/quotes'

import { ApiError } from './api'
import {
  isQuoteStatus,
  listQuery,
  quoteCommands,
  quoteErrorMessage,
  quoteName,
  quoteNumber,
  quotePdfUrl,
  quotesApi,
  searchQuotes,
} from './quotes'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => resetQuotesMock())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('numbers read as on the PDF: a revision says so, a draft has none yet', () => {
  expect(quoteNumber({ number: null, revision: 1 })).toBe('Draft')
  expect(quoteNumber({ number: 'Q-2026-001', revision: 1 })).toBe('Q-2026-001')
  expect(quoteNumber({ number: 'Q-2026-001', revision: 2 })).toBe('Q-2026-001 (Rev. 2)')
  expect(quoteName({ number: null, revision: 1 })).toBe('Draft quote')
  expect(quoteName({ number: 'Q-2026-001', revision: 3 })).toBe('Quote Q-2026-001 (Rev. 3)')
})

test.each([
  ['draft, never sent', { status: 'draft', number: null }, ['edit', 'delete', 'send']],
  ['revised draft', { status: 'draft', number: 'Q-2026-001' }, ['edit', 'send']],
  ['sent', { status: 'sent', number: 'Q-2026-001' }, ['send', 'accept', 'decline', 'revise']],
  ['expired', { status: 'expired', number: 'Q-2026-001' }, ['accept', 'decline', 'revise']],
  ['declined', { status: 'declined', number: 'Q-2026-001' }, ['revise']],
  ['accepted', { status: 'accepted', number: 'Q-2026-001' }, ['invoice']],
] as const)('a %s quote offers what the lifecycle allows', (_, state, allowed) => {
  const can = quoteCommands({ ...state, invoice: null })
  expect(Object.entries(can).flatMap(([command, ok]) => (ok ? [command] : []))).toEqual(
    expect.arrayContaining([...allowed]),
  )
  expect(Object.values(can).filter(Boolean)).toHaveLength(allowed.length)
})

test('an accepted quote is turned into an invoice once', () => {
  const invoice = { id: 'inv_1', number: '' }
  expect(quoteCommands({ status: 'accepted', number: 'Q-1', invoice }).invoice).toBe(false)
})

test('statuses, filters and PDF links follow the contract', () => {
  expect(isQuoteStatus('expired')).toBe(true)
  expect(isQuoteStatus('open')).toBe(false)
  expect(isQuoteStatus(null)).toBe(false)
  expect(listQuery({ clientId: 'cli_1', status: 'sent' }).toString()).toBe(
    'client_id=cli_1&status=sent',
  )
  expect(listQuery({}).toString()).toBe('')
  expect(quotePdfUrl('quo_1')).toBe('/api/v1/quotes/quo_1/pdf')
  expect(quotePdfUrl('quo 1', true)).toBe('/api/v1/quotes/quo%201/pdf?download=1')
})

test('the two quote refusals get a sentence that says what to do', () => {
  expect(quoteErrorMessage(new ApiError(409, 'quote_invoiced', 'x'))).toMatch(/already made/)
  expect(quoteErrorMessage(new ApiError(503, 'mail_unavailable', 'x'))).toMatch(/Mark the quote/)
  expect(quoteErrorMessage(new ApiError(409, 'invalid_state', 'Server says no.'))).toBe(
    'Server says no.',
  )
})

test('lists by client and status', async () => {
  const sent = await quotesApi.list({ status: 'sent' })
  expect(sent.data.map((quote) => quote.id)).toEqual(['quo_sent'])
  const forClient = await quotesApi.list({ clientId: 'cli_3' })
  expect(forClient.data.map((quote) => quote.id)).toEqual(['quo_accepted', 'quo_expired'])
})

test('a draft is created, sent with a number, accepted and invoiced once', async () => {
  const { data: draft } = await quotesApi.create({
    client_id: 'cli_1',
    issue_date: '2026-11-03',
    valid_until: '2026-12-03',
    lines: [],
  })
  expect(draft).toMatchObject({ status: 'draft', number: null })

  const { data: sent } = await quotesApi.send(draft.id, { email: false })
  expect(sent.status).toBe('sent')
  expect(sent.number).toMatch(/^Q-2026-\d{3}$/)
  await expect(quotesApi.update(sent.id, { reference: 'PO 1' })).rejects.toMatchObject({
    status: 409,
    code: 'quote_locked',
  })
  await expect(quotesApi.remove(sent.id)).rejects.toMatchObject({ code: 'invalid_state' })

  const { data: accepted } = await quotesApi.accept(sent.id, 'By phone')
  expect(accepted).toMatchObject({
    status: 'accepted',
    decided_by: 'staff',
    decision_note: 'By phone',
  })

  const { data: invoiced } = await quotesApi.invoice(sent.id)
  expect(invoiced.invoice).toEqual({ id: `inv_from_${sent.id}`, number: '' })
  await expect(quotesApi.invoice(sent.id)).rejects.toMatchObject({
    status: 409,
    code: 'quote_invoiced',
  })
})

test('a declined quote is revised into a draft with the same number', async () => {
  const { data } = await quotesApi.revise('quo_declined')
  expect(data).toMatchObject({ status: 'draft', number: 'Q-2026-002', revision: 2 })
  expect(data.decision_note).toBeNull()
})

test('a valid-until before the date is refused per field', async () => {
  const error = await quotesApi
    .update('quo_draft', { issue_date: '2026-11-10', valid_until: '2026-11-01' })
    .catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({
    status: 422,
    details: { fields: { valid_until: expect.any(String) } },
  })
  expect(sampleQuote().payable_total).toBe('2529.54')
})

test('search matches number, client and reference, ignoring case and spaces', () => {
  const quotes = [
    sampleQuote({ id: 'a', number: 'Q-2026-004', reference: 'PO 4711' }),
    sampleQuote({ id: 'b', number: 'Q-2026-002', revision: 2 }),
    sampleQuote({
      id: 'c',
      number: null,
      client: { id: 'cli_9', number: 9, name: 'Keller Holzbau AG' },
    }),
  ]
  const ids = (search: string) => searchQuotes(quotes, search).map((quote) => quote.id)
  expect(ids('')).toEqual(['a', 'b', 'c'])
  expect(ids('  ')).toEqual(['a', 'b', 'c'])
  expect(ids('q-2026-004')).toEqual(['a'])
  expect(ids('rev. 2')).toEqual(['b'])
  expect(ids(' po 47 ')).toEqual(['a'])
  expect(ids('holzbau')).toEqual(['c'])
  expect(ids('draft')).toEqual(['c'])
  expect(ids('nothing')).toEqual([])
})
