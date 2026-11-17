// The fake API of the Vitest suites (msw/node). Go serves every route; `next dev` never loads these.
import { delay, http, HttpResponse } from 'msw'

import type { AgreementInput, Period, SelfBillingAgreement } from '@/lib/books'
import type { Dunning, DunningAction } from '@/lib/dunning'
import type { Plan, PlanItem } from '@/lib/instalments'
import type { EinvoiceFormat, Interval, PlanInput } from '@/lib/invoices'

import { accountHandlers } from './account'
import {
  auditEvents,
  closedPeriods,
  sampleActivity,
  dashboard,
  instalmentPlans,
  instalmentSettings,
  sampleAgreement,
  scheduledInvoice,
} from './data'
import { emailTemplateHandlers } from './email-templates'
import { employeesHandlers } from './employees'
import { heidiHandlers } from './heidi'
import { ledgerHandlers } from './ledger'
import { notificationHandlers } from './notifications'
import { quoteHandlers } from './quotes'
import { templateHandlers } from './templates'

const fail = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
const invalid = (fields: Record<string, string>) =>
  fail(422, 'validation_failed', 'Check the fields.', { fields })
const notFound = () => fail(404, 'not_found', 'Not found.')
const wrongState = (message: string) => fail(409, 'invalid_state', message)
const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 12)}`
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const thisMonth = () => new Date().toISOString().slice(0, 7)

// Dunning: each invoice starts with three levels, the first due; sending one moves to the next.

const DUNNING_TITLES = ['Zahlungserinnerung', '2. Mahnung', 'Letzte Mahnung']
const dunnings = new Map<string, Dunning>()
const dunningOf = (id: string): Dunning => {
  const found = dunnings.get(id)
  if (found) return found
  const fresh: Dunning = {
    applies: true,
    enabled: true,
    client_enabled: true,
    paused: false,
    next: { level: 1, levels: 3, title: 'Zahlungserinnerung', due_on: '2026-12-15' },
    notices: [],
  }
  dunnings.set(id, fresh)
  return fresh
}
function dunningAction(id: string, action: DunningAction) {
  const current = dunningOf(id)
  if (action !== 'send') {
    const changed = { ...current, paused: action === 'pause' }
    dunnings.set(id, changed)
    return HttpResponse.json({ data: changed })
  }
  const { next } = current
  if (!next) return wrongState('No reminder is left to send for this invoice.')
  const fee = next.level === 1 ? '0.00' : '20.00'
  const level = next.level + 1
  const sent: Dunning = {
    ...current,
    next:
      level > next.levels
        ? null
        : { ...next, level, title: DUNNING_TITLES[level - 1] ?? '', due_on: '2026-12-29' },
    notices: [
      ...current.notices,
      {
        level: next.level,
        levels: next.levels,
        title: next.title,
        sent_at: new Date().toISOString(),
        sent_on: new Date().toISOString().slice(0, 10),
        open_amount: '1081.00',
        fee,
        interest: '0.00',
        total: (1081 + Number(fee)).toFixed(2),
        interest_rate: '0',
        interest_from: null,
        email: 'ap@kunde.ch',
        sent_by: 'Anna Muster',
      },
    ],
  }
  dunnings.set(id, sent)
  return HttpResponse.json({ data: sent })
}

// Instalment plans

const plans: Plan[] = structuredClone(instalmentPlans)
const STEPS: Record<Interval, { months: number; days: number }> = {
  weekly: { months: 0, days: 7 },
  biweekly: { months: 0, days: 14 },
  monthly: { months: 1, days: 0 },
  quarterly: { months: 3, days: 0 },
  yearly: { months: 12, days: 0 },
}

/** The contract's rule: steps from the first date, month steps clamp to the month end. */
function dueDates(first: string, interval: Interval, count: number) {
  const [year = 0, month = 1, day = 1] = first.split('-').map(Number)
  const step = STEPS[interval]
  return Array.from({ length: count }, (_, i) => {
    const target = new Date(Date.UTC(year, month - 1 + step.months * i, 1))
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate()
    target.setUTCDate(Math.min(day, lastDay) + step.days * i)
    return target.toISOString().slice(0, 10)
  })
}

const minusDays = (date: string, days: number) => {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - days)
  return day.toISOString().slice(0, 10)
}

function makePlan(sourceId: string, body: Partial<PlanInput>) {
  const fields: Record<string, string> = {}
  const count = Number(body.count)
  if (!Number.isInteger(count) || count < 2 || count > 12)
    fields.count = 'Choose 2 to 12 instalments.'
  const interval = body.interval
  if (!interval || !(interval in STEPS)) fields.interval = 'Choose an interval.'
  if (!isDate(body.first_due_date)) fields.first_due_date = 'Enter the first due date.'
  const leadDays = body.lead_days ?? instalmentSettings.plan_lead_days
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 60)
    fields.lead_days = 'Enter 0 to 60 days.'
  if (Object.keys(fields).length || !interval || !isDate(body.first_due_date)) return { fields }
  const plan: Plan = {
    id: newId('pln'),
    source_invoice_id: sourceId,
    client_id: 'cli_mock_1',
    count,
    interval,
    first_due_date: body.first_due_date,
    lead_days: leadDays,
    auto_send: body.auto_send ?? instalmentSettings.plan_auto_send,
    reminders_enabled: true,
    status: 'active',
    items: dueDates(body.first_due_date, interval, count).map((due_date, i): PlanItem => ({
      seq: i + 1,
      due_date,
      issue_on: minusDays(due_date, leadDays),
      invoice_id: null,
      number: null,
      status: 'scheduled',
    })),
  }
  return { plan }
}

const TRANSITIONS = {
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  cancel: { from: ['active', 'paused'], to: 'cancelled' },
} as const

function planAction(id: string, name: keyof typeof TRANSITIONS) {
  const plan = plans.find((entry) => entry.id === id)
  if (!plan) return notFound()
  const rule = TRANSITIONS[name]
  if (!rule.from.some((status) => status === plan.status))
    return wrongState(`A ${plan.status} plan cannot be changed this way.`)
  plan.status = rule.to
  if (name === 'cancel')
    plan.items = plan.items.map((item) =>
      item.status === 'scheduled' ? { ...item, status: 'cancelled' } : item,
    )
  return HttpResponse.json({ data: plan })
}

// Books

let periods: Period[] = structuredClone(closedPeriods)
const agreementsByClient = new Map<string, SelfBillingAgreement[]>()
const agreementsOf = (clientId: string) => {
  let list = agreementsByClient.get(clientId)
  if (!list) {
    list = [{ ...sampleAgreement, client_id: clientId }]
    agreementsByClient.set(clientId, list)
  }
  return list
}

const csvCell = (value: string) =>
  /^[=+\-@]|[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

function auditCsv() {
  const header = 'seq,at,kind,subject_type,subject_id,actor,payload,prev_hash,hash'
  const rows = auditEvents.map((event) =>
    [
      String(event.seq),
      event.at,
      event.kind,
      event.subject_type,
      event.subject_id,
      event.actor?.name ?? '',
      JSON.stringify(event.payload),
      event.prev_hash,
      event.hash,
    ]
      .map(csvCell)
      .join(','),
  )
  return `﻿${[header, ...rows].join('\n')}\n`
}

const EINVOICE_ROOTS: Record<EinvoiceFormat, string> = {
  'xrechnung-ubl': '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
  'xrechnung-cii':
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>',
  peppol: '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
  'ro-cius': '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
  'ksef-fa3': '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"/>',
}
const isFormat = (value: string | null): value is EinvoiceFormat =>
  value !== null && value in EINVOICE_ROOTS

// The Go API serves these routes now; they stay as the fake API the lib and screen tests run against.
const goServedFakes = [
  http.post('/api/v1/feedback', async ({ request }) => {
    await delay()
    const form = await request.formData()
    const description = String(form.get('description') ?? '').trim()
    if (!description) return fail(400, 'invalid_request', 'Describe what happened.')
    return HttpResponse.json({ id: 'feedback-1' }, { status: 201 })
  }),
  http.get('/api/v1/reports/key-figures', async () => {
    await delay()
    return HttpResponse.json(dashboard)
  }),
  // Instalments
  http.post<{ id: string }, Partial<PlanInput>>(
    '/api/v1/invoices/:id/plan',
    async ({ params, request }) => {
      if (plans.some((plan) => plan.source_invoice_id === params.id))
        return wrongState('This draft already has a plan.')
      const body = await request.json()
      const { plan, fields } = makePlan(params.id, body)
      if (!plan) return invalid(fields)
      plans.unshift(plan)
      return HttpResponse.json({ data: plan }, { status: 201 })
    },
  ),
  http.get('/api/v1/instalment-plans', ({ request }) => {
    const clientId = new URL(request.url).searchParams.get('client_id')
    return HttpResponse.json({
      data: clientId ? plans.filter((plan) => plan.client_id === clientId) : plans,
    })
  }),
  http.get<{ id: string }>('/api/v1/instalment-plans/:id', ({ params }) => {
    const plan = plans.find((entry) => entry.id === params.id)
    return plan ? HttpResponse.json({ data: plan }) : notFound()
  }),
  http.post<{ id: string }>('/api/v1/instalment-plans/:id/pause', ({ params }) =>
    planAction(params.id, 'pause'),
  ),
  http.post<{ id: string }>('/api/v1/instalment-plans/:id/resume', ({ params }) =>
    planAction(params.id, 'resume'),
  ),
  http.post<{ id: string }>('/api/v1/instalment-plans/:id/cancel', ({ params }) =>
    planAction(params.id, 'cancel'),
  ),
  // No transmissions by default; tests that need some override this handler.
  http.get('/api/v1/invoices/:id/transmissions', () => HttpResponse.json({ data: [] })),
  http.get<{ id: string }>('/api/v1/invoices/:id/dunning', ({ params }) =>
    HttpResponse.json({ data: dunningOf(params.id) }),
  ),
  http.post<{ id: string; action: string }>('/api/v1/invoices/:id/dunning/:action', ({ params }) =>
    params.action === 'send' || params.action === 'pause' || params.action === 'resume'
      ? dunningAction(params.id, params.action)
      : notFound(),
  ),
  http.get<{ id: string }>('/api/v1/invoices/:id/einvoice', ({ params, request }) => {
    const format = new URL(request.url).searchParams.get('format')
    if (!isFormat(format)) return fail(400, 'invalid_request', 'Choose an e-invoice format.')
    const number = params.id === scheduledInvoice.id ? scheduledInvoice.number : params.id
    return new HttpResponse(`<?xml version="1.0" encoding="UTF-8"?>\n${EINVOICE_ROOTS[format]}\n`, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${number}.xml"`,
        'X-Helvetly-Preview': 'true',
      },
    })
  }),
  http.get<{ id: string }>('/api/v1/invoices/:id', ({ params }) =>
    params.id === scheduledInvoice.id ? HttpResponse.json({ data: scheduledInvoice }) : notFound(),
  ),

  // Books
  http.get('/api/v1/periods', () => HttpResponse.json({ data: periods })),
  http.post<never, { month?: unknown }>('/api/v1/periods', async ({ request }) => {
    const { month } = await request.json()
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= thisMonth())
      return invalid({ month: 'Choose a month that has ended.' })
    if (periods.some((period) => period.month === month))
      return fail(409, 'conflict', 'This month is already closed.')
    const period: Period = {
      month,
      closed_at: new Date().toISOString(),
      closed_by: { id: 'usr_mock_1', name: 'Anna Muster' },
    }
    periods = [...periods, period].toSorted((a, b) => b.month.localeCompare(a.month))
    return HttpResponse.json({ data: period }, { status: 201 })
  }),
  http.get('/api/v1/periods/activity', ({ request }) => {
    const query = new URL(request.url).searchParams
    const from = query.get('from') ?? ''
    const to = query.get('to') ?? ''
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to)
      return fail(400, 'invalid_request', 'Bad range.')
    return HttpResponse.json({ data: sampleActivity(from, to) })
  }),
  http.post<{ month: string }>('/api/v1/periods/:month/reopen', ({ params }) => {
    if (!/^\d{4}-\d{2}$/.test(params.month)) return fail(400, 'invalid_request', 'Bad month.')
    if (!periods.some((period) => period.month === params.month)) return notFound()
    periods = periods.filter((period) => period.month !== params.month)
    return HttpResponse.json({ data: { month: params.month } })
  }),
  http.get('/api/v1/audit-log', ({ request }) => {
    const query = new URL(request.url).searchParams
    const cursor = Number(query.get('cursor') ?? '0')
    const limit = Number(query.get('limit') ?? '50')
    if (
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      return fail(400, 'invalid_request', 'Bad cursor or limit.')
    const data = auditEvents.filter((event) => event.seq > cursor).slice(0, limit)
    const last = data.at(-1)
    const more = last !== undefined && last.seq < (auditEvents.at(-1)?.seq ?? 0)
    return HttpResponse.json({ data, meta: { next_cursor: more ? String(last.seq) : null } })
  }),
  http.get('/api/v1/audit-log/export', () => {
    const date = new Date().toISOString().slice(0, 10)
    return new HttpResponse(auditCsv(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${date}.csv"`,
      },
    })
  }),
  http.get('/api/v1/audit-log/verify', () =>
    HttpResponse.json({ data: { ok: true, broken_at: null } }),
  ),
  http.get<{ id: string }>('/api/v1/clients/:id/self-billing-agreements', ({ params }) =>
    HttpResponse.json({
      data: agreementsOf(params.id).toSorted((a, b) => b.starts_on.localeCompare(a.starts_on)),
    }),
  ),
  http.post<{ id: string }, Partial<AgreementInput>>(
    '/api/v1/clients/:id/self-billing-agreements',
    async ({ params, request }) => {
      const body = await request.json()
      const fields: Record<string, string> = {}
      if (!isDate(body.starts_on)) fields.starts_on = 'Enter the start date.'
      if (body.ends_on != null && (!isDate(body.ends_on) || body.ends_on < (body.starts_on ?? '')))
        fields.ends_on = 'The end cannot be before the start.'
      if (!isDate(body.starts_on) || Object.keys(fields).length) return invalid(fields)
      const agreement: SelfBillingAgreement = {
        id: newId('sba'),
        client_id: params.id,
        starts_on: body.starts_on,
        ends_on: body.ends_on ?? null,
        accepted_at: body.accepted_at ?? null,
        accepted_by: body.accepted_by ?? null,
        note: body.note ?? null,
        first_used_at: null,
        created_at: new Date().toISOString(),
      }
      agreementsOf(params.id).push(agreement)
      return HttpResponse.json({ data: agreement }, { status: 201 })
    },
  ),
  http.delete<{ id: string; agreementId: string }>(
    '/api/v1/clients/:id/self-billing-agreements/:agreementId',
    ({ params }) => {
      const list = agreementsOf(params.id)
      const agreement = list.find((entry) => entry.id === params.agreementId)
      if (!agreement) return notFound()
      if (agreement.first_used_at) return wrongState('Invoices were issued under this agreement.')
      agreementsByClient.set(
        params.id,
        list.filter((entry) => entry !== agreement),
      )
      return new HttpResponse(null, { status: 204 })
    },
  ),
]

export const handlers = [
  ...(process.env.VITEST ? goServedFakes : []),
  ...(process.env.VITEST ? ledgerHandlers : []),
  ...(process.env.VITEST ? heidiHandlers : []),
  ...(process.env.VITEST ? templateHandlers : []),
  ...(process.env.VITEST ? accountHandlers : []),
  ...(process.env.VITEST ? notificationHandlers : []),
  ...(process.env.VITEST ? quoteHandlers : []),
  ...(process.env.VITEST ? employeesHandlers : []),
  ...(process.env.VITEST ? emailTemplateHandlers : []),
]
