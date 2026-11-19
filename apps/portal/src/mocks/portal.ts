// MSW handlers with sample data for Vitest and Storybook only (not started in `next dev`).
import { http, HttpResponse } from 'msw'

import { civilToday } from '@/lib/dates'
import type {
  PortalDocument,
  PortalEngagement,
  PortalInvoice,
  PortalProfile,
  PortalScope,
  PortalSession,
} from '@/lib/portal'
import type { PortalQuote } from '@/lib/quotes'

const P = '/api/v1/public/portal'

/** A small gradient PNG, so a story's photo loads without a server. */
export const portalAvatarUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAA5UlEQVR42u3PhUECAAAAQea0u7u727d7BJDuThHGcgQX+NvgAj10e+n20emnM8DvIL9DtIdpj/Azys8YrXFaEzQnaU7RmKYxQ32W+hy1eWoLVBepLlFZprJCeZXyGqV1ShsUNyluUdimsEN+l/weuX1yB2QPyR6ROSZzQvqU9Bmpc1IXJC9JXpG4JnFD/JY4xO6I3RN9IPpI5InIM+EXwq98v/H9TuiD0CfBL4IBAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwMB/gT+jseGWU2gTOAAAAABJRU5ErkJggg=='

export const portalSession: PortalSession = {
  email: 'anna@example.ch',
  avatar_url: '',
  client: { id: 'cli_1', name: 'Keller AG' },
  workspace: { name: 'Muster GmbH' },
  csrf_token: 'portal-csrf',
  clients: [{ id: 'cli_1', name: 'Keller AG', workspace_name: 'Muster GmbH' }],
}

// Dates relative to today, so "Due in 5 days" reads the same whenever a story runs.
const now = new Date()
const year = now.getFullYear()
const day = (offset: number) => civilToday(new Date(year, now.getMonth(), now.getDate() + offset))
const monthStart = civilToday(new Date(year, now.getMonth(), 1))
const monthEnd = civilToday(new Date(year, now.getMonth() + 1, 0))
const sharedAt = (offset: number) => `${day(offset)}T09:00:00Z`

const invoice = (fields: Partial<PortalInvoice> & Pick<PortalInvoice, 'id' | 'number'>) => ({
  kind: 'invoice',
  status: 'open',
  is_overdue: false,
  currency: 'CHF',
  issue_date: day(-5),
  due_date: day(25),
  total: '0.00',
  amount_due: '0.00',
  amount_paid: '0.00',
  ...fields,
})

export const portalInvoices: PortalInvoice[] = [
  invoice({ id: 'inv_1', number: `${year}-014`, total: '3240.00', amount_due: '3240.00' }),
  invoice({
    id: 'inv_2',
    number: `${year}-012`,
    issue_date: day(-25),
    due_date: day(5),
    total: '1200.00',
    amount_due: '700.00',
  }),
  invoice({
    id: 'inv_3',
    number: `${year}-009`,
    is_overdue: true,
    issue_date: day(-42),
    due_date: day(-12),
    total: '860.00',
    amount_due: '860.00',
  }),
  invoice({
    id: 'inv_4',
    number: `${year}-003`,
    status: 'paid',
    issue_date: `${year}-01-02`,
    due_date: `${year}-02-01`,
    total: '1500.00',
  }),
  invoice({
    id: 'inv_5',
    number: `${year - 1}-041`,
    status: 'paid',
    issue_date: `${year - 1}-11-20`,
    due_date: `${year - 1}-12-20`,
    total: '980.00',
  }),
]

const period = { starts_on: monthStart, ends_on: monthEnd }

export const portalEngagements: PortalEngagement[] = [
  {
    id: 'eng_1',
    name: 'Support retainer',
    unit: 'hours',
    quantity: '10',
    recurrence: 'monthly',
    current_period: { ...period, used: '4', remaining: '6', overage: '0' },
  },
  {
    id: 'eng_2',
    name: 'Website maintenance',
    unit: 'hours',
    quantity: '6',
    recurrence: 'monthly',
    current_period: { ...period, used: '7.5', remaining: '0', overage: '1.5' },
  },
]

export const portalDocuments: PortalDocument[] = [
  {
    id: 'doc_1',
    name: 'Contract.pdf',
    size: 120000,
    content_type: 'application/pdf',
    shared_at: sharedAt(-2),
  },
  {
    id: 'doc_2',
    name: 'Timesheet October.xlsx',
    size: 48200,
    content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    shared_at: sharedAt(-9),
  },
  {
    id: 'doc_3',
    name: 'Office floor plan.png',
    size: 2400000,
    content_type: 'image/png',
    shared_at: sharedAt(-20),
  },
  {
    id: 'doc_4',
    name: 'Meeting notes.txt',
    size: 3100,
    content_type: 'text/plain',
    shared_at: sharedAt(-31),
  },
]

export const portalProfile: PortalProfile = {
  profile: {
    name: 'Keller AG',
    is_company: true,
    preferred_name: 'Anna Keller',
    email: 'anna@keller.ch',
    billing_email: null,
    phone: null,
    website: 'https://keller.ch',
    street: 'Bahnhofstrasse',
    street_number: '1',
    apt: null,
    zip: '3000',
    city: 'Bern',
    country: 'CH',
    vat_number: null,
    registration_number: null,
  },
  pending: null,
  last_decision: null,
}

const quote = (fields: Partial<PortalQuote> & Pick<PortalQuote, 'id' | 'number'>): PortalQuote => ({
  revision: 1,
  status: 'sent',
  issue_date: day(-3),
  valid_until: day(27),
  currency: 'CHF',
  total: '0.00',
  decided_at: null,
  decision_note: null,
  ...fields,
})

export const portalQuotes: PortalQuote[] = [
  quote({ id: 'quo_1', number: `Q-${year}-001`, total: '1234.50' }),
  quote({
    id: 'quo_2',
    number: `Q-${year}-002`,
    revision: 2,
    total: '8600.00',
    valid_until: day(9),
  }),
  quote({
    id: 'quo_3',
    number: `Q-${year}-003`,
    status: 'accepted',
    issue_date: day(-30),
    valid_until: day(0),
    total: '2400.00',
    decided_at: `${day(-20)}T10:15:00Z`,
    decision_note: 'Please start in the first week of the month.',
  }),
  quote({
    id: 'quo_4',
    number: `Q-${year}-004`,
    status: 'expired',
    issue_date: day(-60),
    valid_until: day(-30),
    total: '540.00',
  }),
]

const unauthenticated = () =>
  HttpResponse.json(
    { error: { code: 'unauthenticated', message: 'Sign in again.' } },
    { status: 401 },
  )

/** Writes need the session's CSRF token, as the real API does. */
const csrfOk = (request: Request) =>
  request.headers.get('X-CSRF-Token') === portalSession.csrf_token

/** A workspace's own portal address (/w/acme/), as GET /scope answers it. */
export const portalScope: PortalScope = {
  name: 'Müller Treuhand AG',
  slug: 'mueller-treuhand',
  logo_url: null,
  url: 'https://portal.helvetly.com/w/mueller-treuhand/',
}

/** The shared portal (no /w/<slug>/): GET /scope is 404. */
const unscopedPortal = http.get(`${P}/scope`, () =>
  HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }),
)

/** A page under a workspace's own address. */
export const scopedPortal = (scope: PortalScope = portalScope) =>
  http.get(`${P}/scope`, () => HttpResponse.json(scope))

export const portalHandlers = [
  unscopedPortal,
  http.post(`${P}/auth/start`, () =>
    HttpResponse.json({ resend_in: 30, expires_in: 600 }, { status: 202 }),
  ),
  http.post(`${P}/auth/verify`, () =>
    HttpResponse.json({ csrf_token: portalSession.csrf_token }, { status: 201 }),
  ),
  http.get(`${P}/session`, () => HttpResponse.json(portalSession)),
  http.post(`${P}/session/client`, () =>
    HttpResponse.json({ csrf_token: portalSession.csrf_token }, { status: 201 }),
  ),
  http.delete(`${P}/session`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${P}/invoices`, () => HttpResponse.json({ data: portalInvoices })),
  http.get(`${P}/engagements`, () => HttpResponse.json({ data: portalEngagements })),
  http.get(`${P}/documents`, () => HttpResponse.json({ data: portalDocuments })),
  http.get(`${P}/profile`, () => HttpResponse.json(portalProfile)),
  http.get(`${P}/quotes`, () => HttpResponse.json({ data: portalQuotes })),
  http.post<{ id: string; decision: string }>(
    `${P}/quotes/:id/:decision`,
    async ({ request, params }) => {
      if (!csrfOk(request))
        return HttpResponse.json(
          { error: { code: 'csrf_failed', message: 'Reload the page.' } },
          { status: 403 },
        )
      const found = portalQuotes.find((q) => q.id === params.id)
      if (!found)
        return HttpResponse.json(
          { error: { code: 'not_found', message: 'Not found.' } },
          { status: 404 },
        )
      if (found.status !== 'sent')
        return HttpResponse.json(
          {
            error: {
              code: 'invalid_state',
              message: 'This quote has expired or was already answered.',
            },
          },
          { status: 409 },
        )
      const body: unknown = await request.json()
      const note =
        typeof body === 'object' && body !== null && 'note' in body && typeof body.note === 'string'
          ? body.note
          : null
      return HttpResponse.json({
        data: {
          ...found,
          status: params.decision === 'accept' ? 'accepted' : 'declined',
          decided_at: new Date().toISOString(),
          decision_note: note,
        },
      })
    },
  ),
  http.put(`${P}/avatar`, async ({ request }) => {
    if (!csrfOk(request))
      return HttpResponse.json(
        { error: { code: 'csrf_failed', message: 'Reload the page.' } },
        { status: 403 },
      )
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob) || !['image/png', 'image/jpeg'].includes(file.type))
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Upload the photo as a PNG or JPEG image.',
            details: { fields: { file: 'Upload the photo as a PNG or JPEG image.' } },
          },
        },
        { status: 422 },
      )
    return HttpResponse.json({ avatar_url: portalAvatarUrl })
  }),
  http.delete(`${P}/avatar`, ({ request }) =>
    csrfOk(request)
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json(
          { error: { code: 'csrf_failed', message: 'Reload the page.' } },
          { status: 403 },
        ),
  ),
  http.post(`${P}/profile/requests`, async ({ request }) => {
    if (!csrfOk(request))
      return HttpResponse.json(
        { error: { code: 'csrf_failed', message: 'Reload the page.' } },
        { status: 403 },
      )
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries((await request.json()) ?? {}),
    )
    if (fields.zip === 'bad')
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the fields.',
            details: { fields: { zip: 'invalid' } },
          },
        },
        { status: 422 },
      )
    return HttpResponse.json(
      { id: 'ccr_1', fields, created_at: '2026-11-10T10:00:00Z' },
      { status: 201 },
    )
  }),
]

export { unauthenticated }
