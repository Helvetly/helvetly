// The client's quotes in the portal, typed by hand from "Client portal" in docs/quotes-contract.md.
import { apiUrl, request } from '@helvetly/ui/lib/http'

import { translate } from '@/lib/i18n'

export type PortalQuote = {
  id: string
  number: string
  revision: number
  status: 'sent' | 'accepted' | 'declined' | 'expired'
  issue_date: string
  valid_until: string
  currency: string
  total: string
  decided_at: string | null
  decision_note: string | null
}

export type QuoteDecision = 'accept' | 'decline'

/** The API's limit on the note sent with an answer. */
export const NOTE_MAX = 1000

const base = '/public/portal/quotes'
const id = encodeURIComponent

export const listPortalQuotes = async () =>
  (await request<{ data: PortalQuote[] }>(base, { public: true })).data

export const portalQuotePdfUrl = (quoteId: string) => apiUrl(`${base}/${id(quoteId)}/pdf`)

/** A 409 `invalid_state` throws an ApiError saying the quote expired or was already answered. */
export const decidePortalQuote = async (quoteId: string, decision: QuoteDecision, note: string) =>
  (
    await request<{ data: PortalQuote }>(`${base}/${id(quoteId)}/${decision}`, {
      method: 'POST',
      public: true,
      json: note.trim() ? { note: note.trim() } : {},
    })
  ).data

/** Waiting for the client's answer. */
export const isAwaiting = (quote: PortalQuote) => quote.status === 'sent'

/** "Q-2026-001", "Q-2026-001 · Rev. 2" from the second revision on. */
export const quoteName = (quote: PortalQuote) =>
  `${quote.number}${quote.revision > 1 ? translate('rev', { revision: quote.revision }) : ''}`
