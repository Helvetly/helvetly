'use client'
// Quotes (Offerten), typed by hand from docs/quotes-contract.md. A quote shares the invoice's lines,
// maths and fields; totals come from the server, never from here.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { ApiError, errorMessage, request } from '@/lib/api'
import type { ApprovalState } from '@/lib/approvals'
import type { Page } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import {
  type Decimal,
  type DocLanguage,
  type InstalmentInput,
  type InstalmentSchedule,
  type Line,
  type LineInput,
  type Totals,
  type VatMode,
} from '@/lib/invoices'
import type { Sort } from '@/lib/list-sort'

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'

export type Quote = Totals & {
  id: string
  /** "Q-2026-001", set on the first send. */
  number: string | null
  revision: number
  /** `expired` is derived by the server: sent and past `valid_until`. */
  status: QuoteStatus
  client_id: string
  client: { id: string; number: number; name: string }
  issue_date: string
  valid_until: string
  currency: string
  language: DocLanguage
  vat_mode: VatMode
  reference: string | null
  /** As on an invoice: null prints `client.number`, "" prints none, other text prints instead. */
  client_number_display: string | null
  contract_reference: string | null
  /** The workspace document the contract is in; never printed. */
  contract_document: { id: string; name: string } | null
  intro: string | null
  footer: string | null
  /** Internal, never printed or shown in the portal. */
  note: string | null
  discount_percent: Decimal
  lines: Line[]
  /** The payment schedule offered with the quote; the invoice made from it takes it over. */
  instalments: InstalmentSchedule | null
  sent_at: string | null
  decided_at: string | null
  decided_by: 'staff' | 'client' | null
  decision_note: string | null
  /** The invoice draft it became; `number` is "" until that invoice is issued. */
  invoice: { id: string; number: string } | null
  /** The latest approval request of a draft (or the approval it was sent with); null without one. */
  approval_state: Exclude<ApprovalState, 'none'> | null
  created_at: string
  updated_at: string
}

/** One sent revision of a quote, as it was sent (`GET /quotes/{id}/revisions`), newest first. */
export type QuoteRevision = {
  revision: number
  /** Null for a revision sent before the history was kept whose PDF is gone. */
  sent_at: string | null
  /** Empty when it was marked as sent without an email. */
  sent_to: string[]
  outcome: 'accepted' | 'declined' | 'expired' | null
  outcome_at: string | null
  outcome_by: 'staff' | 'client' | null
  reason: string | null
  /** The revision the quote is at now; none is while the next revision is a draft. */
  current: boolean
  has_pdf: boolean
  /** The quote as it was sent; null for revisions sent before the history was kept. */
  snapshot: Quote | null
}

export type QuoteInput = Pick<
  Quote,
  | 'client_id'
  | 'issue_date'
  | 'valid_until'
  | 'currency'
  | 'language'
  | 'vat_mode'
  | 'reference'
  | 'intro'
  | 'footer'
  | 'note'
  | 'discount_percent'
> & {
  lines: LineInput[]
  client_number_display?: string | null
  contract_reference?: string | null
  contract_document_id?: string | null
  instalments?: InstalmentInput | null
}

export type QuoteSendInput = {
  to?: string[]
  cc?: string[]
  subject?: string
  message?: string
  /** false: only marks it sent (numbered, PDF filed), no email. */
  email?: boolean
}

export const QUOTE_STATUSES: { value: QuoteStatus; label: string; plural: string }[] = [
  { value: 'draft', label: translate('draft'), plural: translate('drafts') },
  { value: 'sent', label: translate('sent3'), plural: translate('sent3') },
  { value: 'accepted', label: translate('accepted'), plural: translate('accepted') },
  { value: 'declined', label: translate('declined'), plural: translate('declined') },
  { value: 'expired', label: translate('expired'), plural: translate('expired') },
]

export const isQuoteStatus = (value: string | null): value is QuoteStatus =>
  QUOTE_STATUSES.some((status) => status.value === value)

export const statusLabel = (status: QuoteStatus) =>
  QUOTE_STATUSES.find((entry) => entry.value === status)?.label ?? status

/** "Q-2026-001", "Q-2026-001 (Rev. 2)", or "Draft" before the first send. */
export function quoteNumber(quote: Pick<Quote, 'number' | 'revision'>) {
  if (!quote.number) return translate('draft')
  return quote.revision > 1
    ? translate('rev', { number: quote.number, revision: quote.revision })
    : quote.number
}

/** "Quote Q-2026-001" or "Draft quote". */
export const quoteName = (quote: Pick<Quote, 'number' | 'revision'>) =>
  quote.number ? translate('quote3', { value1: quoteNumber(quote) }) : translate('draftQuote')

/** The Filters popover's quote filters, as in the page URL; null or '' for none. */
export type QuoteFilters = { from: string; to: string; min: string | null; max: string | null }

export type QuoteCommand =
  | 'edit'
  | 'delete'
  | 'send'
  | 'accept'
  | 'decline'
  | 'revise'
  | 'invoice'
  | 'duplicate'

/** What staff may do to a quote in its state (the lifecycle table of the contract). */
export function quoteCommands(quote: Pick<Quote, 'status' | 'number' | 'invoice'>) {
  const { status } = quote
  return {
    edit: status === 'draft',
    delete: status === 'draft' && quote.number === null,
    send: status === 'draft' || status === 'sent',
    accept: status === 'sent' || status === 'expired',
    decline: status === 'sent' || status === 'expired',
    revise: status === 'sent' || status === 'expired' || status === 'declined',
    invoice: status === 'accepted' && quote.invoice === null,
    duplicate: true,
  } satisfies Record<QuoteCommand, boolean>
}

/** Which of the selected quotes each bulk action applies to; the others are left as they are. */
export function bulkTargets(quotes: Quote[]) {
  const where = (command: QuoteCommand) => quotes.filter((quote) => quoteCommands(quote)[command])
  return {
    // Marking sent numbers a draft; a sent quote is already marked. One awaiting its approval stays a draft
    // (the API answers 409 approval_required for one that needs a request nobody made yet).
    markSent: quotes.filter(
      (quote) => quote.status === 'draft' && quote.approval_state !== 'pending',
    ),
    accept: where('accept'),
    decline: where('decline'),
    remove: where('delete'),
  }
}

export const QUOTE_SORT_FIELDS = ['number', 'client', 'date', 'valid', 'total', 'status'] as const
export type QuoteSortField = (typeof QUOTE_SORT_FIELDS)[number]
/** Newest first by date; equal dates come newest made first (the API's tie-break). */
export const DEFAULT_QUOTE_SORT: Sort<QuoteSortField> = { field: 'date', desc: true }

/** The API's sort key of each column (drafts have no number and go last either way; status in lifecycle order). */
const SORT_KEYS: Record<QuoteSortField, string> = {
  number: 'number',
  client: 'client',
  date: 'issue_date',
  valid: 'valid_until',
  total: 'total',
  status: 'status',
}

/** A friendly sentence for a refused write; the server's message for anything else. */
export function quoteErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'quote_invoiced')
      return translate('anInvoiceWasAlreadyMadeFromThisQuoteOpen')
    if (error.code === 'mail_unavailable') return translate('emailIsnTSetUpOnThisServerMark2')
  }
  return errorMessage(error)
}

// The API

const path = (id: string) => `/quotes/${encodeURIComponent(id)}`
const post = (json: unknown = {}) => ({ method: 'POST' as const, json })
type One<T> = { data: T }

/** Everything that decides which quotes the list shows: the page, the view, the search, the filters and the sort. */
export type QuoteListParams = QuoteFilters & {
  page: number
  pageSize: number
  search: string
  status: QuoteStatus | null
  clientId?: string | null
  clientName: string
  sort: Sort<QuoteSortField>
}

export const PAGE_SIZE = 50

/** The list query: a client's quotes by default (newest made first), or the page's filters, sort and page. */
export function listQuery({
  page = 1,
  pageSize = PAGE_SIZE,
  search = '',
  status = null,
  clientId,
  clientName = '',
  from = '',
  to = '',
  min = null,
  max = null,
  sort,
}: Partial<QuoteListParams>) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (search.trim()) query.set('search', search.trim())
  if (status) query.set('status', status)
  if (clientId) query.set('client_id', clientId)
  if (clientName.trim()) query.set('client_name', clientName.trim())
  if (from) query.set('issued_from', from)
  if (to) query.set('issued_to', to)
  if (min !== null) query.set('total_min', min)
  if (max !== null) query.set('total_max', max)
  if (sort) query.set('sort', `${sort.desc ? '-' : ''}${SORT_KEYS[sort.field]}`)
  return query
}

export const quotesApi = {
  list: (params: Partial<QuoteListParams> = {}) =>
    request<Page<Quote>>(`/quotes?${listQuery(params)}`),
  get: (id: string) => request<One<Quote>>(path(id)),
  create: (input: Partial<QuoteInput>) => request<One<Quote>>('/quotes', post(input)),
  update: (id: string, input: Partial<QuoteInput>) =>
    request<One<Quote>>(path(id), { method: 'PATCH', json: input }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  send: (id: string, input: QuoteSendInput) => request<One<Quote>>(`${path(id)}/send`, post(input)),
  accept: (id: string, note?: string) =>
    request<One<Quote>>(`${path(id)}/accept`, post(note ? { note } : {})),
  decline: (id: string, note?: string) =>
    request<One<Quote>>(`${path(id)}/decline`, post(note ? { note } : {})),
  revise: (id: string) => request<One<Quote>>(`${path(id)}/revise`, post()),
  invoice: (id: string) => request<One<Quote>>(`${path(id)}/invoice`, post()),
  duplicate: (id: string) => request<One<Quote>>(`${path(id)}/duplicate`, post()),
  revisions: (id: string) => request<{ data: QuoteRevision[] }>(`${path(id)}/revisions`),
}

/** A plain link, so the browser sends the session cookie and saves or shows the file. */
export const quotePdfUrl = (id: string, download = false) =>
  `/api/v1${path(id)}/pdf${download ? '?download=1' : ''}`

/** The PDF one revision was sent with (the API redirects to the stored file, saved as an attachment). */
export const quoteRevisionPdfUrl = (id: string, revision: number) =>
  `/api/v1${path(id)}/revisions/${revision}/pdf`

export const quoteKeys = {
  all: ['quotes'] as const,
  lists: ['quotes', 'list'] as const,
  list: (params: Partial<QuoteListParams>) =>
    ['quotes', 'list', listQuery(params).toString()] as const,
  detail: (id: string) => ['quotes', 'detail', id] as const,
}

/** One page of quotes; the previous page stays on screen while the next loads. */
export function useQuotes(params: Partial<QuoteListParams> = {}) {
  return useQuery({
    queryKey: quoteKeys.list(params),
    queryFn: () => quotesApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export const quoteQuery = (id: string) => ({
  queryKey: quoteKeys.detail(id),
  queryFn: async () => (await quotesApi.get(id)).data,
})

export function useQuote(id: string | null) {
  return useQuery({ ...quoteQuery(id ?? ''), enabled: id !== null })
}

/** The quote's sent revisions; read again whenever the quote changes (a send, an answer, a revision). */
export function useQuoteRevisions(quote: Pick<Quote, 'id' | 'updated_at'>) {
  return useQuery({
    queryKey: [...quoteKeys.detail(quote.id), 'revisions', quote.updated_at],
    queryFn: async () => (await quotesApi.revisions(quote.id)).data,
  })
}

function refresh(queryClient: QueryClient, quote?: Quote) {
  if (quote) queryClient.setQueryData(quoteKeys.detail(quote.id), quote)
  void queryClient.invalidateQueries({ queryKey: quoteKeys.lists })
}

/** Creates (no id) or saves a draft quote. */
export function useSaveQuote() {
  const queryClient = useQueryClient()
  return useMutation<Quote, ApiError, { id?: string; input: Partial<QuoteInput> }>({
    mutationFn: async ({ id, input }) =>
      (id ? await quotesApi.update(id, input) : await quotesApi.create(input)).data,
    onSuccess: (quote) => refresh(queryClient, quote),
  })
}

export function useDeleteQuote() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: quotesApi.remove,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: quoteKeys.detail(id) })
      refresh(queryClient)
    },
  })
}

/** Send, accept, decline, revise or invoice: every write that answers with the quote. */
export function useQuoteAction<Variables>(run: (variables: Variables) => Promise<One<Quote>>) {
  const queryClient = useQueryClient()
  return useMutation<Quote, ApiError, Variables>({
    mutationFn: async (variables) => (await run(variables)).data,
    onSuccess: (quote) => {
      refresh(queryClient, quote)
      // The invoice made from it is a new draft in the invoice lists.
      if (quote.invoice) void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}
