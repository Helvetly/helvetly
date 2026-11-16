import type { InvoiceKind } from '@/lib/invoices'

/** What POST /invoices makes; the other kinds come from an issued invoice. */
export const CREATABLE: InvoiceKind[] = [
  'invoice',
  'partial',
  'prepayment',
  'proforma',
  'self_billed',
]

/** What the editor drawer shows: a new document (id null) or the draft `id`. */
export type Compose = { id: string | null; kind: InvoiceKind; client: string | null }

const LEGACY = /\/invoices\/(?:new|edit)$/

/** /invoices/new and /invoices/edit?id=… are older links (Heidi, client pages): they open the same drawer. */
export const isLegacyEditorPath = (pathname: string) => LEGACY.test(pathname)

const toKind = (value: string | null) => CREATABLE.find((kind) => kind === value) ?? 'invoice'

/** The drawer's state from the URL: ?compose=new|<draft id>, with ckind and cclient for a new document. */
export function parseCompose(pathname: string, query: URLSearchParams): Compose | null {
  if (isLegacyEditorPath(pathname))
    return { id: query.get('id'), kind: toKind(query.get('kind')), client: query.get('client') }
  const compose = query.get('compose')
  if (!compose) return null
  return compose === 'new'
    ? { id: null, kind: toKind(query.get('ckind')), client: query.get('cclient') }
    : { id: compose, kind: 'invoice', client: null }
}

/** `query` with the drawer opened on `target` (or closed with null); everything else stays. */
export function composeQuery(query: URLSearchParams, target: Compose | null) {
  const next = new URLSearchParams(query)
  for (const key of ['compose', 'ckind', 'cclient']) next.delete(key)
  if (!target) return next
  next.set('compose', target.id ?? 'new')
  if (!target.id && target.kind !== 'invoice') next.set('ckind', target.kind)
  if (!target.id && target.client) next.set('cclient', target.client)
  return next
}

export const editHref = (id: string) => `/invoices?compose=${encodeURIComponent(id)}`
export const newInvoiceHref = (clientId: string) =>
  `/invoices?compose=new&cclient=${encodeURIComponent(clientId)}`
