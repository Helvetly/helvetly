import { http, HttpResponse } from 'msw'

import { billingFixture } from '@/components/billing/billing-fixture'
import publicOffer from '@/components/billing/public-offer.fixture.json'
import type { Dashboard, Session } from '@/lib/api'
import type { Usage } from '@/lib/documents'
import type { Summary } from '@/lib/invoices'
import { NOT_REQUIRED } from '@/mocks/approvals'
import { portalAddressHandlers } from '@/mocks/portal-address'
import { portalDomainHandlers } from '@/mocks/portal-domain'
import { legalFormsHandler, sampleSettings } from '@/test/invoice-api'

export const storySession: Session = {
  user: { id: 'usr_story', name: 'Anna Muster', email: 'anna@example.com', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
}
export const emptyPage = { data: [], meta: { page: 1, page_size: 50, total: 0, total_pages: 0 } }
export const emptySummary: Summary = {
  currency: 'CHF',
  outstanding: { amount: '0.00', count: 0 },
  overdue: { amount: '0.00', count: 0 },
  paid_this_month: { amount: '0.00', count: 0 },
  paid_last_month: { amount: '0.00' },
  drafts: { amount: '0.00', count: 0 },
  refund_due: { amount: '0.00', count: 0 },
  avg_days_to_pay: null,
  collection_rate: null,
  monthly: [],
}
export const emptyUsage: Usage = { files: 0, size: 0, by_kind: [], trash: { files: 0, size: 0 } }
export const emptyDashboard: Dashboard = {
  currency: 'CHF',
  currencies: ['CHF'],
  outstanding: 0,
  open_count: 0,
  paid_this_month: 0,
  paid_change: 0,
  overdue_count: 0,
  invoice_count: 0,
  avg_days_to_pay: 0,
  collection_rate: 0,
  spent_this_month: 0,
  vat_to_reclaim: 0,
  pending_count: 0,
  expense_count: 0,
  receipts_matched: 0,
  trends: { outstanding: [], paid: [], spent: [], vat: [] },
  cash_flow: { '30d': [], '90d': [], '12m': [] },
  unread: { notifications: 0, inbox: 0 },
}
export const sessionHandler = (over: Partial<Session> = {}) =>
  http.get('/api/v1/session', () => HttpResponse.json({ ...storySession, ...over }))
export const unavailable = () =>
  HttpResponse.json(
    {
      error: { code: 'unavailable', message: 'The service is temporarily unavailable.' },
    },
    { status: 503 },
  )
export const screenHandlers = [
  sessionHandler(),
  ...portalAddressHandlers,
  ...portalDomainHandlers,
  legalFormsHandler,
  http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/documents/doc_story/content', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billingFixture() })),
  http.get('/api/v1/public/offers/current', () => HttpResponse.json({ data: publicOffer })),
  http.get('/api/v1/documents/folders', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/documents/trash', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/documents/usage', () => HttpResponse.json({ data: emptyUsage })),
  http.get('/api/v1/documents', () => HttpResponse.json(emptyPage)),
  http.get('/api/v1/engagements/summary', () =>
    HttpResponse.json({
      data: {
        active: 0,
        ending_soon: 0,
        under_pace: 0,
        overage: 0,
        to_invoice: 0,
      },
    }),
  ),
  http.get('/api/v1/engagement-settings', () => HttpResponse.json({ data: { digest: false } })),
  http.get('/api/v1/engagements', () => HttpResponse.json(emptyPage)),
  http.get('/api/v1/invoices/summary', () => HttpResponse.json({ data: emptySummary })),
  http.get('/api/v1/invoices', () => HttpResponse.json(emptyPage)),
  http.get('/api/v1/reports/key-figures', () => HttpResponse.json(emptyDashboard)),
  // Nothing recorded, so nothing to close on the dashboard's to-do list.
  http.get('/api/v1/periods', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/periods/activity', () => HttpResponse.json({ data: [] })),
]

const nothing = <T>(data: T) => HttpResponse.json({ data })

/**
 * What every story gets after its own handlers (`.storybook/preview.tsx`): the shell's reads with neutral answers, so
 * a screen never runs into the dev server's 404 because a story left out a request it does not care about.
 */
export const storyDefaults = [
  ...screenHandlers,
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: false, email: true, passkey: true, dev_codes: false }),
  ),
  http.get('/api/v1/invoice-settings', () => nothing(sampleSettings({ vat_registered: false }))),
  http.get('/api/v1/vat-return/settings', () =>
    nothing({ method: 'effective', period: 'quarterly', basis: 'agreed', net_rates: [] }),
  ),
  http.get('/api/v1/workspaces/deleted', () => nothing([])),
  http.get('/api/v1/templates', () => nothing([])),
  http.get('/api/v1/instalment-plans', () => nothing([])),
  http.get('/api/v1/invoices/:id/deliveries', () => nothing([])),
  http.get('/api/v1/invoices/:id/transmissions', () => nothing([])),
  http.get('/api/v1/invoices/:id/engagement', () => nothing(null)),
  http.get('/api/v1/invoices/:id/approval', () => nothing(NOT_REQUIRED)),
  http.get('/api/v1/quotes/:id/approval', () => nothing(NOT_REQUIRED)),
  http.get('/api/v1/expenses/:id/approval', () => nothing(NOT_REQUIRED)),
  http.get('/api/v1/approvals/inbox', () => nothing([])),
  http.get('/api/v1/approvals/settings', () => nothing({ groups: [], policies: [] })),
  http.get('/api/v1/invoices/:id/dunning', () =>
    nothing({
      applies: false,
      enabled: false,
      client_enabled: false,
      paused: false,
      next: null,
      notices: [],
    }),
  ),
  http.get('/api/v1/documents/:id/content', () => new HttpResponse(null, { status: 204 })),
  http.get(
    '/api/v1/imports/:id/files/:file/content',
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get('/api/v1/email-templates', () => nothing([])),
]
