// The Go API serves quotes (docs/quotes-contract.md); this is the fake the lib and screen tests run
// against, never registered in development or production. It keeps quotes in memory and follows the
// contract's lifecycle; totals are a simple stand-in for internal/invoicecalc.
import { delay, http, HttpResponse } from 'msw'

import type {
  InstalmentInput,
  InstalmentSchedule,
  InvoiceInput,
  Line,
  LineInput,
} from '@/lib/invoices'
import type { Quote, QuoteInput, QuoteSendInput } from '@/lib/quotes'

const at = '2026-11-03T09:30:00Z'

const line = (position: number, description: string, quantity: string, price: string): Line => ({
  id: `qln_${position}`,
  position,
  description,
  quantity,
  unit: 'hour',
  unit_price: price,
  discount_percent: '0',
  vat_category: 'S',
  vat_rate: '8.1',
  vat_exemption_code: null,
  vat_exemption_reason: null,
  amount: (Number(quantity) * Number(price)).toFixed(2),
})

// shortcut: float maths on fixture amounts; the real totals come from internal/invoicecalc.
function withTotals(quote: Quote): Quote {
  const net = quote.lines.reduce((sum, entry) => sum + Number(entry.amount), 0)
  const discount = (net * Number(quote.discount_percent)) / 100
  const vat = quote.vat_mode === 'none' ? 0 : ((net - discount) * 8.1) / 100
  const total = (net - discount + vat).toFixed(2)
  return {
    ...quote,
    subtotal: net.toFixed(2),
    discount_amount: discount.toFixed(2),
    net_total: (net - discount).toFixed(2),
    vat_breakdown:
      quote.vat_mode === 'none'
        ? []
        : [
            {
              category: 'S',
              rate: '8.1',
              taxable_amount: (net - discount).toFixed(2),
              vat_amount: vat.toFixed(2),
            },
          ],
    vat_total: vat.toFixed(2),
    total,
    rounding_amount: '0.00',
    payable_total: total,
  }
}

export const sampleQuote = (change: Partial<Quote> = {}): Quote =>
  withTotals({
    id: 'quo_1',
    number: null,
    revision: 1,
    status: 'draft',
    client_id: 'cli_1',
    client: { id: 'cli_1', number: 1, name: 'Alpenglow Studio GmbH' },
    issue_date: '2026-11-03',
    valid_until: '2026-12-03',
    currency: 'CHF',
    language: 'de',
    vat_mode: 'exclusive',
    reference: null,
    client_number_display: null,
    contract_reference: null,
    contract_document: null,
    intro: null,
    footer: null,
    note: null,
    discount_percent: '0',
    lines: [line(1, 'Brand workshop', '8', '180.00'), line(2, 'Logo design', '6', '150.00')],
    instalments: null,
    subtotal: '0.00',
    discount_amount: '0.00',
    net_total: '0.00',
    vat_breakdown: [],
    vat_total: '0.00',
    total: '0.00',
    rounding_amount: '0.00',
    payable_total: '0.00',
    sent_at: null,
    decided_at: null,
    decided_by: null,
    decision_note: null,
    invoice: null,
    created_at: at,
    updated_at: at,
    ...change,
  })

// The clients of the story workspace (src/stories/pages/api.ts) and the unit tests' sampleClient.
const CLIENT_NAMES: Record<string, string> = {
  cli_1: 'Alpenglow Studio GmbH',
  cli_2: 'Keller Holzbau AG',
  cli_3: 'Sophie Meier',
  cli_4: 'Frei Logistik GmbH',
}
const client = (id: string) => ({
  client_id: id,
  client: { id, number: Number(id.replace(/\D/g, '')) || 1, name: CLIENT_NAMES[id] ?? id },
})

export const sampleQuotes = (): Quote[] => [
  sampleQuote({ id: 'quo_draft', note: 'Ask about the print run.' }),
  sampleQuote({
    id: 'quo_sent',
    number: 'Q-2026-004',
    status: 'sent',
    ...client('cli_2'),
    issue_date: '2026-10-28',
    valid_until: '2026-11-27',
    sent_at: '2026-10-28T10:00:00Z',
  }),
  sampleQuote({
    id: 'quo_accepted',
    number: 'Q-2026-003',
    status: 'accepted',
    ...client('cli_3'),
    issue_date: '2026-10-12',
    valid_until: '2026-11-11',
    sent_at: '2026-10-12T10:00:00Z',
    decided_at: '2026-10-15T08:00:00Z',
    decided_by: 'client',
    decision_note: 'Looks good, let’s start in December.',
  }),
  sampleQuote({
    id: 'quo_declined',
    number: 'Q-2026-002',
    status: 'declined',
    ...client('cli_2'),
    issue_date: '2026-09-20',
    valid_until: '2026-10-20',
    sent_at: '2026-09-20T10:00:00Z',
    decided_at: '2026-09-25T08:00:00Z',
    decided_by: 'client',
    decision_note: 'Too expensive for this year.',
  }),
  sampleQuote({
    id: 'quo_expired',
    number: 'Q-2026-001',
    revision: 2,
    status: 'expired',
    ...client('cli_3'),
    issue_date: '2026-08-01',
    valid_until: '2026-08-31',
    sent_at: '2026-08-01T10:00:00Z',
  }),
]

let quotes = sampleQuotes()
let sequence = 4

/** Every test or story starts from the same quotes (or the ones given). */
export function resetQuotesMock(list = sampleQuotes()) {
  quotes = list
  sequence = 4
}

const fail = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
const invalid = (fields: Record<string, string>) =>
  fail(422, 'validation_failed', 'Check the highlighted fields.', { fields })
const notFound = () => fail(404, 'not_found', 'Not found.')
const wrongState = (message: string) => fail(409, 'invalid_state', message)
const one = (quote: Quote, status = 200) => HttpResponse.json({ data: quote }, { status })

const find = (id: string) => quotes.find((quote) => quote.id === id)
function store(quote: Quote) {
  const saved = withTotals({ ...quote, updated_at: new Date().toISOString() })
  quotes = quotes.some((entry) => entry.id === quote.id)
    ? quotes.map((entry) => (entry.id === quote.id ? saved : entry))
    : [saved, ...quotes]
  return saved
}

const asLines = (input: LineInput[]): Line[] =>
  input.map((entry, i) => ({
    ...entry,
    id: `qln_${i + 1}`,
    position: i + 1,
    amount: (Number(entry.quantity) * Number(entry.unit_price)).toFixed(2),
  }))

/** The schedule as the API keeps it: the typed rows, or the payable total split evenly a month apart. */
export function asSchedule(input: InstalmentInput, payable: string): InstalmentSchedule {
  const cents = Math.round(Number(payable) * 100)
  const part = Math.floor(cents / input.count)
  const month = (i: number) => {
    const date = new Date(`${input.first_due_date}T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + i)
    return date.toISOString().slice(0, 10)
  }
  const rows =
    input.items && input.items.length > 0
      ? input.items
      : Array.from({ length: input.count }, (_, i) => ({
          due_date: month(i),
          amount: ((i === input.count - 1 ? cents - part * i : part) / 100).toFixed(2),
        }))
  return {
    interval: input.interval,
    items: rows.map((row, i) => ({
      seq: i + 1,
      due_date: row.due_date,
      amount: row.amount,
      effective: row.amount,
      paid: '0.00',
      open: row.amount,
      status: 'open',
      reference: null,
    })),
  }
}

/** The invoice preview the quote editor asks for its totals, with the rows of a schedule. */
export const quotePreviewHandler = http.post<never, Partial<InvoiceInput>>(
  '/api/v1/invoices/preview',
  async ({ request }) => {
    const input = await request.json()
    const totals = withTotals(sampleQuote({ lines: asLines(input.lines ?? []) }))
    const instalments = input.instalments
      ? asSchedule(input.instalments, totals.payable_total)
      : null
    return HttpResponse.json({ data: { ...totals, instalments } })
  },
)

function apply(
  quote: Quote,
  body: Partial<QuoteInput>,
): { quote: Quote } | { fields: Record<string, string> } {
  const { lines, client_id, instalments, ...rest } = body
  const merged: Quote = {
    ...quote,
    ...rest,
    ...(lines ? { lines: asLines(lines) } : {}),
    ...(client_id ? client(client_id) : {}),
  }
  const next: Quote =
    instalments === undefined
      ? merged
      : {
          ...merged,
          instalments: instalments && asSchedule(instalments, withTotals(merged).payable_total),
        }
  const fields: Record<string, string> = {}
  if (!next.client_id) fields.client_id = 'Choose a client.'
  if (next.valid_until < next.issue_date)
    fields.valid_until = 'The quote must be valid on or after its date.'
  return Object.keys(fields).length ? { fields } : { quote: next }
}

type Params = { id: string }

export const quoteHandlers = [
  http.get('/api/v1/quotes', async ({ request }) => {
    await delay()
    const query = new URL(request.url).searchParams
    const clientId = query.get('client_id')
    const status = query.get('status')
    return HttpResponse.json({
      data: quotes.filter(
        (quote) =>
          (!clientId || quote.client_id === clientId) && (!status || quote.status === status),
      ),
    })
  }),
  http.get<Params>('/api/v1/quotes/:id/pdf', () => new HttpResponse(null, { status: 204 })),
  http.get<Params>('/api/v1/quotes/:id', ({ params }) => {
    const quote = find(params.id)
    return quote ? one(quote) : notFound()
  }),
  http.post<never, Partial<QuoteInput>>('/api/v1/quotes', async ({ request }) => {
    const id = `quo_${Math.random().toString(36).slice(2, 10)}`
    const made = apply(sampleQuote({ id, client_id: '', lines: [] }), await request.json())
    if ('fields' in made) return invalid(made.fields)
    return one(store(made.quote), 201)
  }),
  http.patch<Params, Partial<QuoteInput>>('/api/v1/quotes/:id', async ({ params, request }) => {
    const quote = find(params.id)
    if (!quote) return notFound()
    if (quote.status !== 'draft')
      return fail(409, 'quote_locked', 'Only a draft quote can be changed: revise it first.')
    const made = apply(quote, await request.json())
    if ('fields' in made) return invalid(made.fields)
    return one(store(made.quote))
  }),
  http.delete<Params>('/api/v1/quotes/:id', ({ params }) => {
    const quote = find(params.id)
    if (!quote) return notFound()
    if (quote.number) return wrongState('A sent quote can’t be deleted.')
    quotes = quotes.filter((entry) => entry !== quote)
    return new HttpResponse(null, { status: 204 })
  }),
  http.post<Params, QuoteSendInput>('/api/v1/quotes/:id/send', async ({ params, request }) => {
    const quote = find(params.id)
    if (!quote) return notFound()
    if (quote.status !== 'draft' && quote.status !== 'sent')
      return wrongState('Only a draft or sent quote can be sent.')
    await request.json()
    const number = quote.number ?? `Q-2026-${String((sequence += 1)).padStart(3, '0')}`
    return one(store({ ...quote, number, status: 'sent', sent_at: new Date().toISOString() }))
  }),
  ...(['accept', 'decline'] as const).map((action) =>
    http.post<Params, { note?: string }>(
      `/api/v1/quotes/:id/${action}`,
      async ({ params, request }) => {
        const quote = find(params.id)
        if (!quote) return notFound()
        if (quote.status !== 'sent' && quote.status !== 'expired')
          return wrongState('This quote was already answered.')
        const { note } = await request.json()
        return one(
          store({
            ...quote,
            status: action === 'accept' ? 'accepted' : 'declined',
            decided_at: new Date().toISOString(),
            decided_by: 'staff',
            decision_note: note ?? null,
          }),
        )
      },
    ),
  ),
  http.post<Params>('/api/v1/quotes/:id/revise', ({ params }) => {
    const quote = find(params.id)
    if (!quote) return notFound()
    if (quote.status === 'draft' || quote.status === 'accepted')
      return wrongState('Only a sent, expired or declined quote can be revised.')
    return one(
      store({
        ...quote,
        status: 'draft',
        revision: quote.revision + 1,
        decided_at: null,
        decided_by: null,
        decision_note: null,
      }),
    )
  }),
  http.post<Params>('/api/v1/quotes/:id/invoice', ({ params }) => {
    const quote = find(params.id)
    if (!quote) return notFound()
    if (quote.invoice)
      return fail(409, 'quote_invoiced', 'An invoice was already made from this quote.')
    if (quote.status !== 'accepted') return wrongState('Only an accepted quote becomes an invoice.')
    return one(store({ ...quote, invoice: { id: `inv_from_${quote.id}`, number: '' } }), 201)
  }),
]
