'use client'
// Quotes (Offerten), typed by hand from docs/quotes-contract.md. A quote shares the invoice's lines,
// maths and fields; totals come from the server, never from here.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { ApiError, errorMessage, request } from '@/lib/api'
import type { ApprovalState } from '@/lib/approvals'
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
import { sortRows, type Sort, type SortValue } from '@/lib/list-sort'

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
  /** Hidden copies: delivered, in no header the others see. */
  bcc?: string[]
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

/** Quotes whose number, client or reference contain `search`, ignoring case; all of them for none. */
export function searchQuotes(quotes: Quote[], search: string) {
  const term = search.trim().toLowerCase()
  if (!term) return quotes
  return quotes.filter((quote) =>
    [quoteNumber(quote), quote.client.name, quote.reference ?? ''].some((text) =>
      text.toLowerCase().includes(term),
    ),
  )
}

/** The Filters popover's quote filters, as in the page URL; null or '' for none. */
export type QuoteFilters = { from: string; to: string; min: string | null; max: string | null }

/** Quotes dated within `from`–`to` whose total lies within `min`–`max`. */
export function filterQuotes(quotes: Quote[], { from, to, min, max }: QuoteFilters) {
  return quotes.filter(
    (quote) =>
      (!from || quote.issue_date >= from) &&
      (!to || quote.issue_date <= to) &&
      (min === null || Number(quote.payable_total) >= Number(min)) &&
      (max === null || Number(quote.payable_total) <= Number(max)),
  )
}

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
/** Newest first by date; equal dates keep the API's order (the newest made first). */
export const DEFAULT_QUOTE_SORT: Sort<QuoteSortField> = { field: 'date', desc: true }

const SORT_VALUES: Record<QuoteSortField, (quote: Quote) => SortValue> = {
  // Drafts have no number yet and go last.
  number: (quote) => quote.number && `${quote.number} ${quote.revision}`,
  client: (quote) => quote.client.name,
  date: (quote) => quote.issue_date,
  valid: (quote) => quote.valid_until,
  total: (quote) => Number(quote.payable_total),
  // In the order of the lifecycle, as the tabs show it.
  status: (quote) => QUOTE_STATUSES.findIndex((entry) => entry.value === quote.status),
}

export const sortQuotes = (quotes: Quote[], sort: Sort<QuoteSortField>) =>
  sortRows(quotes, SORT_VALUES[sort.field], sort.desc)

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

export type QuoteFilter = { clientId?: string | null; status?: QuoteStatus | null }

export function listQuery({ clientId, status }: QuoteFilter) {
  const query = new URLSearchParams()
  if (clientId) query.set('client_id', clientId)
  if (status) query.set('status', status)
  return query
}

export const quotesApi = {
  list: (filter: QuoteFilter = {}) => {
    const query = listQuery(filter)
    return request<{ data: Quote[] }>(`/quotes${query.size ? `?${query}` : ''}`)
  },
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
}

/** A plain link, so the browser sends the session cookie and saves or shows the file. */
export const quotePdfUrl = (id: string, download = false) =>
  `/api/v1${path(id)}/pdf${download ? '?download=1' : ''}`

export const quoteKeys = {
  all: ['quotes'] as const,
  lists: ['quotes', 'list'] as const,
  list: (filter: QuoteFilter) => ['quotes', 'list', listQuery(filter).toString()] as const,
  detail: (id: string) => ['quotes', 'detail', id] as const,
}

export function useQuotes(filter: QuoteFilter = {}) {
  return useQuery({
    queryKey: quoteKeys.list(filter),
    queryFn: async () => (await quotesApi.list(filter)).data,
  })
}

export const quoteQuery = (id: string) => ({
  queryKey: quoteKeys.detail(id),
  queryFn: async () => (await quotesApi.get(id)).data,
})

export function useQuote(id: string | null) {
  return useQuery({ ...quoteQuery(id ?? ''), enabled: id !== null })
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
