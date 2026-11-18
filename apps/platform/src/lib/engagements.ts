// Engagements, typed by hand from docs/engagements-contract.md.
import { useQuery } from '@tanstack/react-query'

import { request } from '@/lib/api'
import type { Page } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { invoicesApi, type Decimal, type Unit, type VatCategory } from '@/lib/invoices'
import { queryKeys } from '@/lib/queries'

export type InvoiceLink = {
  id: string
  number: string | null
  status: 'draft' | 'open' | 'paid'
  kind: 'advance' | 'usage'
}

export type Period = {
  id: string
  index: number
  starts_on: string
  ends_on: string
  natural_ends_on: string
  quantity: Decimal
  full_quantity: Decimal
  unearned: Decimal
  carried_in: Decimal
  available: Decimal
  unit_price: Decimal
  overage_unit_price: Decimal
  used: Decimal
  remaining: Decimal
  overage: Decimal
  expected: Decimal
  state: 'upcoming' | 'open' | 'closed'
  advance_invoice: InvoiceLink | null
  invoiced_quantity: Decimal
  uninvoiced_quantity: Decimal
  invoices: InvoiceLink[]
}
export type PeriodSummary = Omit<Period, 'invoices'>

export type Attention = 'under_pace' | 'ending_soon' | 'overage' | 'to_invoice'
export type Recurrence = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export type Engagement = {
  id: string
  number: number
  client: { id: string; number: number; name: string }
  title: string
  description: string | null
  product_id: string | null
  unit: Unit | null
  quantity: Decimal
  billing: 'advance' | 'arrears'
  price_basis: 'net' | 'gross'
  unit_price: Decimal
  unit_price_net: Decimal
  unit_price_gross: Decimal
  overage_unit_price: Decimal | null
  currency: string
  vat_category: VatCategory
  vat_rate: Decimal
  start_date: string
  recurrence: Recurrence
  interval: number
  end_date: string | null
  reference: string | null
  document_id: string | null
  status: 'scheduled' | 'active' | 'ended' | 'cancelled'
  cancelled_on: string | null
  rollover: boolean
  auto_invoice: boolean
  invoice_detail: 'summary' | 'per_entry'
  current_period: PeriodSummary | null
  attention: Attention[]
  created_at: string
  updated_at: string
}

export type EngagementInput = {
  client_id: string
  title: string
  description: string | null
  product_id: string | null
  unit: Unit | null
  quantity: Decimal
  billing: Engagement['billing']
  price_basis: Engagement['price_basis']
  unit_price: Decimal
  overage_unit_price: Decimal | null
  currency: string
  vat_category: VatCategory
  vat_rate: Decimal
  start_date: string
  recurrence: Recurrence
  interval: number
  end_date: string | null
  reference: string | null
  document_id: string | null
  rollover?: boolean
  auto_invoice?: boolean
  invoice_detail?: Engagement['invoice_detail']
}

export type EngagementSummary = {
  active: number
  ending_soon: number
  under_pace: number
  overage: number
  to_invoice: number
}

export type Entry = {
  id: string
  period_id: string
  date: string
  quantity: Decimal
  note: string | null
  performed_by: { id: string; name: string } | null
  invoice: InvoiceLink | null
  created_at: string
  created_by: { id: string; name: string } | null
}

export type EntryInput = {
  date?: string
  quantity: Decimal
  note?: string | null
  performed_by?: string | null
}

export type EngagementQuery = {
  q?: string
  client_id?: string
  status?: string
  attention?: Attention
  sort?: 'ends' | '-created_at' | 'title' | 'client'
  page?: number
  page_size?: number
}

const path = (id: string) => `/engagements/${encodeURIComponent(id)}`

export const listEngagements = (query: EngagementQuery = {}) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value))
  return request<Page<Engagement>>(`/engagements?${params}`)
}
export const getEngagementSummary = (clientId?: string) =>
  request<{ data: EngagementSummary }>(
    `/engagements/summary${clientId ? `?${new URLSearchParams({ client_id: clientId })}` : ''}`,
  )
export const getEngagement = (id: string) => request<{ data: Engagement }>(path(id))

export const engagementQuery = (id: string) => ({
  queryKey: [...queryKeys.engagements, id],
  queryFn: async () => (await getEngagement(id)).data,
})

/** The "All" view: the list a fresh visit to Engagements loads. */
export const ALL_STATUSES = 'scheduled,active,ended,cancelled'

export const engagementListQuery = (params: EngagementQuery) => ({
  queryKey: [...queryKeys.engagements, 'list', params],
  queryFn: () => listEngagements(params),
})
export const createEngagement = (input: EngagementInput) =>
  request<{ data: Engagement }>('/engagements', { method: 'POST', json: input })
export const updateEngagement = (id: string, input: Partial<EngagementInput>) =>
  request<{ data: Engagement }>(path(id), { method: 'PATCH', json: input })
export const deleteEngagement = (id: string) => request<void>(path(id), { method: 'DELETE' })
export const cancelEngagement = (id: string, cancelledOn?: string) =>
  request<{ data: Engagement }>(`${path(id)}/cancel`, {
    method: 'POST',
    json: cancelledOn ? { cancelled_on: cancelledOn } : {},
  })
export const resumeEngagement = (id: string) =>
  request<{ data: Engagement }>(`${path(id)}/resume`, { method: 'POST' })
export const renewEngagement = (id: string, startDate?: string) =>
  request<{ data: Engagement }>(`${path(id)}/renew`, {
    method: 'POST',
    json: startDate ? { start_date: startDate } : {},
  })
export const listPeriods = (id: string) => request<{ data: Period[] }>(`${path(id)}/periods`)
export const updatePeriod = (id: string, periodId: string, quantity: Decimal) =>
  request<{ data: Period }>(`${path(id)}/periods/${encodeURIComponent(periodId)}`, {
    method: 'PATCH',
    json: { quantity },
  })
export const listEntries = (id: string, periodId?: string) =>
  request<{ data: Entry[] }>(
    `${path(id)}/entries${periodId ? `?${new URLSearchParams({ period_id: periodId })}` : ''}`,
  )
export const createEntry = (id: string, input: EntryInput) =>
  request<{ data: { entry: Entry; period: Period } }>(`${path(id)}/entries`, {
    method: 'POST',
    json: input,
  })
export const updateEntry = (id: string, entryId: string, input: Partial<EntryInput>) =>
  request<{ data: { entry: Entry; period: Period } }>(
    `${path(id)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'PATCH', json: input },
  )
export const deleteEntry = (id: string, entryId: string) =>
  request<void>(`${path(id)}/entries/${encodeURIComponent(entryId)}`, { method: 'DELETE' })
export const invoicePeriod = (
  id: string,
  periodId: string,
  body: { kind: 'advance' | 'usage'; detail?: 'summary' | 'per_entry' },
) =>
  request<{ data: { invoice_id: string; period: Period } }>(
    `${path(id)}/periods/${encodeURIComponent(periodId)}/invoice`,
    { method: 'POST', json: body },
  )

/** Attaches an existing invoice to the period of the engagement its service (else issue) date falls in. */
export const linkInvoice = (id: string, invoiceId: string) =>
  request<{ data: { invoice_id: string; period: Period } }>(`${path(id)}/invoices`, {
    method: 'POST',
    json: { invoice_id: invoiceId },
  })
export const unlinkInvoice = (id: string, invoiceId: string) =>
  request<void>(`${path(id)}/invoices/${encodeURIComponent(invoiceId)}`, { method: 'DELETE' })

export type LinkedEngagement = { id: string; title: string }
/** The engagement an invoice belongs to, null when none. */
export function useInvoiceEngagement(invoiceId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.engagements, 'of-invoice', invoiceId],
    queryFn: async () =>
      (await request<{ data: LinkedEngagement | null }>(`/invoices/${invoiceId}/engagement`)).data,
    enabled: invoiceId !== null,
  })
}

/** The client's engagements that still run, to attach an invoice to. */
export function useClientEngagements(clientId: string) {
  return useQuery({
    queryKey: [...queryKeys.engagements, 'of-client', clientId],
    queryFn: async () => (await listEngagements({ client_id: clientId, page_size: 100 })).data,
    enabled: clientId !== '',
  })
}

/** The client's open or paid invoices that belong to no engagement yet, newest first. */
export function useUnlinkedInvoices(clientId: string) {
  return useQuery({
    queryKey: [...queryKeys.engagements, 'unlinked-invoices', clientId],
    queryFn: async () => {
      const query = new URLSearchParams({ client_id: clientId, unlinked: '1', kind: 'invoice' })
      for (const status of ['draft', 'open', 'paid', 'overdue']) query.append('status', status)
      query.set('page_size', '100')
      query.set('sort', '-issue_date')
      return (await invoicesApi.list(query)).data
    },
    enabled: clientId !== '',
  })
}

/** A decimal string as integer thousandths, so comparisons are exact. */
function milli(value: Decimal): number {
  const [whole = '0', frac = ''] = value.trim().split('.')
  const n = Number(whole + frac.padEnd(3, '0').slice(0, 3))
  return Number.isFinite(n) ? n : 0
}

const pct = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.min(100, Math.round((part / whole) * 10000) / 100)

type Progress = Pick<PeriodSummary, 'quantity' | 'used' | 'state'> &
  Partial<Pick<PeriodSummary, 'expected' | 'overage' | 'available'>>

/** Used and expected share of what is available (quantity + carried in; 0–100, two decimals) and how it is going. */
export function progressOf(p: Progress) {
  const quantity = milli(p.available ?? p.quantity)
  const used = milli(p.used)
  const expected =
    p.state === 'closed' ? quantity : p.state === 'upcoming' ? 0 : milli(p.expected ?? '0')
  const tone: 'ok' | 'warn' | 'over' | 'done' =
    used > quantity
      ? 'over'
      : used === quantity && quantity > 0
        ? 'done'
        : p.state === 'open' && used * 4 < expected * 3
          ? 'warn'
          : 'ok'
  return { usedPct: pct(used, quantity), expectedPct: pct(expected, quantity), tone }
}

const MONTHS = [
  translate('jan'),
  translate('feb'),
  translate('mar'),
  translate('apr'),
  translate('may'),
  translate('jun'),
  translate('jul'),
  translate('aug'),
  translate('sep'),
  translate('oct'),
  translate('nov'),
  translate('dec'),
]

const mon = (m: string) => MONTHS[Number(m) - 1] ?? m

/** "1.–30. Nov 2026", "28. Oct – 3. Nov 2026", "28. Dec 2026 – 3. Jan 2027". */
export function periodLabel(p: { starts_on: string; ends_on: string }) {
  const [y1 = '', m1 = '', d1 = ''] = p.starts_on.split('-')
  const [y2 = '', m2 = '', d2 = ''] = p.ends_on.split('-')
  const a = `${Number(d1)}.`
  const b = `${Number(d2)}.`
  if (p.starts_on === p.ends_on) return `${b} ${mon(m2)} ${y2}`
  if (y1 === y2 && m1 === m2) return `${a}–${b} ${mon(m2)} ${y2}`
  if (y1 === y2) return `${a} ${mon(m1)} – ${b} ${mon(m2)} ${y2}`
  return `${a} ${mon(m1)} ${y1} – ${b} ${mon(m2)} ${y2}`
}

export const engagementSettingsKey = [...queryKeys.engagements, 'settings'] as const
export const getEngagementSettings = () =>
  request<{ data: { digest: boolean } }>('/engagement-settings').then((r) => r.data)
export const putEngagementSettings = (body: { digest: boolean }) =>
  request<{ data: { digest: boolean } }>('/engagement-settings', {
    method: 'PUT',
    json: body,
  }).then((r) => r.data)

export const sendReport = (
  id: string,
  periodId: string,
  body: { to?: string[]; cc?: string[]; subject?: string; message?: string },
) =>
  request<{ data: { to: string[] } }>(
    `${path(id)}/periods/${encodeURIComponent(periodId)}/report/send`,
    { method: 'POST', json: body },
  ).then((r) => r.data)

// Downloads go through plain links so the browser sends the session cookie and saves the file.
export const reportUrl = (id: string, periodId: string, download = false) =>
  `/api/v1${path(id)}/periods/${encodeURIComponent(periodId)}/report${download ? '?download=1' : ''}`
export const exportUrl = ({ page: _page, page_size: _size, ...query }: EngagementQuery) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value))
  return `/api/v1/engagements/export?${params}`
}
export const exportIdsUrl = (ids: string[]) =>
  `/api/v1/engagements/export?${new URLSearchParams({ ids: ids.join(',') })}`
export const entriesExportUrl = (id: string, periodId?: string) =>
  `/api/v1${path(id)}/entries/export${periodId ? `?${new URLSearchParams({ period_id: periodId })}` : ''}`
