import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { resetQuotesMock, sampleQuote } from '@/mocks/quotes'

import { ApiError } from './api'
import {
  bulkTargets,
  DEFAULT_QUOTE_SORT,
  isQuoteStatus,
  listQuery,
  quoteCommands,
  quoteErrorMessage,
  quoteName,
  quoteNumber,
  quotePdfUrl,
  quotesApi,
  type QuoteListParams,
  type Quote,
} from './quotes'

const idsOf = (list: Quote[]) => list.map((quote) => quote.id)

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
  ['draft, never sent', { status: 'draft', number: null }, ['edit', 'delete', 'send', 'duplicate']],
  ['revised draft', { status: 'draft', number: 'Q-2026-001' }, ['edit', 'send', 'duplicate']],
  [
    'sent',
    { status: 'sent', number: 'Q-2026-001' },
    ['send', 'accept', 'decline', 'revise', 'duplicate'],
  ],
  [
    'expired',
    { status: 'expired', number: 'Q-2026-001' },
    ['accept', 'decline', 'revise', 'duplicate'],
  ],
  ['declined', { status: 'declined', number: 'Q-2026-001' }, ['revise', 'duplicate']],
  ['accepted', { status: 'accepted', number: 'Q-2026-001' }, ['invoice', 'duplicate']],
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
    'page=1&page_size=50&status=sent&client_id=cli_1',
  )
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

const listedIds = async (params: Partial<QuoteListParams>) =>
  (await quotesApi.list(params)).data.map((quote) => quote.id)

describe('the list query', () => {
  test('sends the page, the view, the search, every filter and the sort as the API names them', () => {
    const query = listQuery({
      page: 3,
      pageSize: 100,
      search: '  holzbau ',
      status: 'expired',
      clientName: ' Keller ',
      from: '2026-10-01',
      to: '2026-11-30',
      min: '100',
      max: '2500.50',
      sort: { field: 'valid', desc: true },
    })
    expect(query.toString()).toBe(
      'page=3&page_size=100&search=holzbau&status=expired&client_name=Keller&issued_from=2026-10-01&issued_to=2026-11-30&total_min=100&total_max=2500.50&sort=-valid_until',
    )
  })

  test('leaves out what does not narrow; a column maps onto its API sort key', () => {
    expect(listQuery({}).toString()).toBe('page=1&page_size=50')
    expect(listQuery({ sort: DEFAULT_QUOTE_SORT }).get('sort')).toBe('-issue_date')
    expect(listQuery({ sort: { field: 'date', desc: false } }).get('sort')).toBe('issue_date')
    expect(listQuery({ min: '0', clientId: 'cli_3' }).toString()).toBe(
      'page=1&page_size=50&client_id=cli_3&total_min=0',
    )
  })

  test('the answer is one page with the totals in meta', async () => {
    const first = await quotesApi.list({ pageSize: 2 })
    expect(first.data).toHaveLength(2)
    expect(first.meta).toMatchObject({ page: 1, page_size: 2 })
    expect(first.meta.total_pages).toBe(Math.ceil(first.meta.total / 2))
    const last = await quotesApi.list({ page: first.meta.total_pages, pageSize: 2 })
    expect(last.data.length).toBeGreaterThan(0)
    expect(last.data.map((quote) => quote.id)).not.toContain(first.data[0]?.id)
  })

  test('the number as shown, client and reference are searched', async () => {
    expect(await listedIds({ search: 'rev. 2' })).toEqual(['quo_expired'])
    expect(await listedIds({ search: 'nobody' })).toEqual([])
    expect(await listedIds({ clientName: 'nobody' })).toEqual([])
  })
})

test('bulk actions apply only where the lifecycle allows', () => {
  const draft = sampleQuote({ id: 'draft' })
  const revised = sampleQuote({ id: 'revised', number: 'Q-1', revision: 2 })
  const sent = sampleQuote({ id: 'sent', number: 'Q-2', status: 'sent' })
  const expired = sampleQuote({ id: 'expired', number: 'Q-3', status: 'expired' })
  const accepted = sampleQuote({ id: 'accepted', number: 'Q-4', status: 'accepted' })
  const targets = bulkTargets([draft, revised, sent, expired, accepted])
  expect(idsOf(targets.markSent)).toEqual(['draft', 'revised'])
  expect(idsOf(targets.accept)).toEqual(['sent', 'expired'])
  expect(idsOf(targets.decline)).toEqual(['sent', 'expired'])
  expect(idsOf(targets.remove)).toEqual(['draft'])
})

test('duplicating makes a new unnumbered draft', async () => {
  const { data } = await quotesApi.duplicate('quo_accepted')
  expect(data).toMatchObject({ status: 'draft', number: null, revision: 1, invoice: null })
  expect(data.id).not.toBe('quo_accepted')
})
