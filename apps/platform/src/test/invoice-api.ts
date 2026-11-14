// A small stand-in for the Go invoices API in component tests (msw/node), in its exact shapes.
// It answers what the tests drive; computation is the server's job and is canned here.
import { http, HttpResponse } from 'msw'

import type { Client } from '@/lib/clients'
import {
  kindInfo,
  type InstalmentSchedule,
  type Invoice,
  type InvoiceInput,
  type InvoiceListItem,
  type InvoiceSettings,
  type Summary,
} from '@/lib/invoices'

export const sampleSettings = (change: Partial<InvoiceSettings> = {}): InvoiceSettings => ({
  seller: {
    name: 'Muster Treuhand GmbH',
    street: 'Bahnhofstrasse',
    street_number: '21',
    apt: null,
    zip: '8001',
    city: 'Zürich',
    country: 'CH',
    vat_number: 'CHE-109.322.551 MWST',
    email: null,
    phone: null,
  },
  vat_registered: true,
  default_vat_mode: 'exclusive',
  default_vat_rate: '8.1',
  iban: 'CH93 0076 2011 6238 5295 7',
  bank_name: null,
  currency: 'CHF',
  language: 'de',
  default_terms_days: 30,
  number_format: 'YYYY-NNN',
  footer: null,
  logo_file_id: null,
  qr_bill_enabled: true,
  revolut_enabled: false,
  revolut_username: null,
  instalments: {
    count: 3,
    interval: 'monthly',
    mode: 'schedule',
    plan_lead_days: 10,
    plan_auto_send: true,
    reminders_enabled: true,
    remind_before_days: 5,
    remind_after_days: [3, 10],
  },
  dunning: {
    enabled: false,
    steps: [
      { name: null, timing: 'after_due', days: 10, fee: '0.00', text: null, qr_bill: true },
      { name: null, timing: 'after_previous', days: 14, fee: '0.00', text: null, qr_bill: true },
      { name: null, timing: 'after_previous', days: 14, fee: '0.00', text: null, qr_bill: true },
    ],
    interest_enabled: false,
    interest_rate: '5',
    interest_from: 'reminder',
  },
  logo_url: null,
  is_complete: true,
  missing_fields: [],
  ...change,
})

const totals = {
  subtotal: '2900.00',
  discount_amount: '0.00',
  net_total: '2900.00',
  vat_breakdown: [
    { category: 'S' as const, rate: '8.1', taxable_amount: '2900.00', vat_amount: '234.90' },
  ],
  vat_total: '234.90',
  total: '3134.90',
  rounding_amount: '0.00',
  payable_total: '3134.90',
}

export const sampleInvoice = (change: Partial<Invoice> = {}): Invoice => ({
  id: 'inv_1',
  kind: 'invoice',
  type_code: kindInfo(change.kind ?? 'invoice').code,
  number: null,
  status: 'draft',
  is_overdue: false,
  client_id: 'cli_1',
  client: { id: 'cli_1', number: 1, name: 'Alpenglow Studio GmbH' },
  credited_invoice: null,
  quote: null,
  issue_date: '2026-11-05',
  due_date: '2026-12-05',
  service_date: null,
  service_date_end: null,
  currency: 'CHF',
  language: 'de',
  vat_mode: 'exclusive',
  reference: null,
  tax_currency_rate: null,
  intro: null,
  footer: null,
  note: null,
  lines: [],
  discount_percent: '0',
  ...totals,
  amount_paid: '0.00',
  amount_credited: '0.00',
  amount_due: '3134.90',
  amount_refunded: '0.00',
  refund_due: '0.00',
  prepaid_total: '0.00',
  prepayments: [],
  deducted_on: null,
  payments: [],
  refunds: [],
  payment: {
    iban: 'CH93 0076 2011 6238 5295 7',
    reference_type: 'NON',
    reference: null,
    qr_bill: true,
    revolut_url: null,
  },
  payment_methods: { qr_bill: true, revolut: false },
  seller: null,
  buyer: null,
  issued_at: null,
  sent_at: null,
  created_at: '2026-11-05T09:00:00Z',
  updated_at: '2026-11-05T09:00:00Z',
  instalments: null,
  plan: null,
  reminders_enabled: true,
  ...change,
})

/** The contract's example: CHF 1'081.00 in three monthly parts, nothing paid yet. */
export const sampleSchedule = (
  rows = [
    ['2026-12-01', '360.35'],
    ['2027-01-01', '360.35'],
    ['2027-02-01', '360.30'],
  ],
): InstalmentSchedule => ({
  interval: 'monthly',
  items: rows.map(([due_date = '', amount = ''], i) => ({
    seq: i + 1,
    due_date,
    amount,
    effective: amount,
    paid: '0.00',
    open: amount,
    status: 'open' as const,
    reference: null,
  })),
})

export const listItem = (invoice: Invoice): InvoiceListItem => ({
  id: invoice.id,
  kind: invoice.kind,
  type_code: invoice.type_code,
  number: invoice.number,
  status: invoice.status,
  is_overdue: invoice.is_overdue,
  client: invoice.client,
  issue_date: invoice.issue_date,
  due_date: invoice.due_date,
  currency: invoice.currency,
  total: invoice.total,
  rounding_amount: invoice.rounding_amount,
  payable_total: invoice.payable_total,
  amount_due: invoice.amount_due,
  refund_due: invoice.refund_due,
  payment_methods: invoice.payment_methods,
  deducted_on: invoice.deducted_on,
  sent_at: invoice.sent_at,
  created_at: invoice.created_at,
})

export const sampleSummary: Summary = {
  currency: 'CHF',
  outstanding: { amount: '8000.00', count: 2 },
  overdue: { amount: '3000.00', count: 1 },
  paid_this_month: { amount: '1200.00', count: 1 },
  paid_last_month: { amount: '900.00' },
  drafts: { amount: '500.00', count: 1 },
  refund_due: { amount: '0.00', count: 0 },
  avg_days_to_pay: 18,
  collection_rate: 0.82,
  monthly: [{ month: '2026-11', invoiced: '9000.00', paid: '1200.00' }],
}

/** Lines as the server answers them, each with the canned amount; `input` is the parsed body. */
const lines = (input: Partial<InvoiceInput>) =>
  (input.lines ?? []).map((line, i) =>
    Object.assign(line, { id: `lin_${i}`, position: i + 1, amount: totals.subtotal }),
  )

/** The preview's canned schedule: 3'134.90 in three monthly parts. */
export const previewRows = [
  ['2026-12-05', '1044.95'],
  ['2027-01-05', '1044.95'],
  ['2027-02-05', '1045.00'],
]

/** Drafts the editor creates and patches, kept in memory; issuing refuses draft clients. */
export function editorApi(clients: Client[]) {
  const drafts = new Map<string, Invoice>()
  return [
    http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
    http.post<never, Partial<InvoiceInput>>('/api/v1/invoices/preview', async ({ request }) => {
      const input = await request.json()
      // Whatever the schedule, the rows the server makes of the canned 3'134.90.
      const instalments = input.instalments ? sampleSchedule(previewRows) : null
      return HttpResponse.json({
        data: sampleInvoice({ id: '', lines: lines(input), instalments }),
      })
    }),
    http.post<never, Partial<InvoiceInput>>('/api/v1/invoices', async ({ request }) => {
      const input = await request.json()
      const client = clients.find((entry) => entry.id === input.client_id)
      const invoice = sampleInvoice({
        id: `inv_${drafts.size + 1}`,
        client_id: input.client_id ?? '',
        client: { id: client?.id ?? '', number: client?.number ?? 0, name: client?.name ?? '' },
        lines: lines(input),
      })
      drafts.set(invoice.id, invoice)
      return HttpResponse.json({ data: invoice }, { status: 201 })
    }),
    http.get<{ id: string }>('/api/v1/invoices/:id', ({ params }) => {
      const invoice = drafts.get(params.id)
      return invoice
        ? HttpResponse.json({ data: invoice })
        : new HttpResponse(null, { status: 404 })
    }),
    http.patch<{ id: string }, Partial<InvoiceInput>>(
      '/api/v1/invoices/:id',
      async ({ params, request }) => {
        const input = await request.json()
        const invoice = drafts.get(params.id)
        if (!invoice) return new HttpResponse(null, { status: 404 })
        const next = { ...invoice, ...(input.lines ? { lines: lines(input) } : {}) }
        drafts.set(next.id, next)
        return HttpResponse.json({ data: next })
      },
    ),
    http.post<{ id: string }>('/api/v1/invoices/:id/issue', ({ params }) => {
      const invoice = drafts.get(params.id)
      const client = clients.find((entry) => entry.id === invoice?.client_id)
      if (!invoice) return new HttpResponse(null, { status: 404 })
      if (client?.is_draft)
        return HttpResponse.json(
          {
            error: {
              code: 'cannot_issue',
              message: 'This document cannot be issued yet.',
              details: {
                reasons: [
                  {
                    code: 'client_draft',
                    field: 'client.address',
                    message: "Complete the client's address: street, zip.",
                  },
                  {
                    code: 'settings_incomplete',
                    field: 'settings.seller.zip',
                    message: 'Add the ZIP of your company.',
                  },
                  {
                    code: 'settings_incomplete',
                    field: 'settings.seller.city',
                    message: 'Add the city of your company.',
                  },
                ],
              },
            },
          },
          { status: 422 },
        )
      const issued = { ...invoice, status: 'open' as const, number: '2026-001' }
      drafts.set(issued.id, issued)
      return HttpResponse.json({ data: issued })
    }),
  ]
}
