// The fake of the email templates and drafts API (T3-T5); in memory, reset per test.
import { delay, http, HttpResponse } from 'msw'

import {
  EMAIL_KINDS,
  EMAIL_LANGUAGES,
  type EmailDraft,
  type EmailKind,
  type EmailTemplate,
} from '@/lib/email-templates'

import { sampleQuotes } from './quotes'

const NAMES: Record<EmailKind, string> = {
  invoice: 'invoice',
  credit_note: 'credit note',
  proforma: 'proforma invoice',
  quote: 'quote',
}
const COMMON = ['document', 'number', 'client', 'amount', 'company']

const defaultOf = (kind: EmailKind) => ({
  subject: '{document} {number} from {company}',
  body:
    kind === 'quote'
      ? 'Hello\n\nPlease find attached our quote {number} for {amount}, valid until {valid_until}.\n\nKind regards\n{company}'
      : kind === 'invoice'
        ? 'Hello\n\nPlease find attached our invoice {number} for {amount}, payable by {due_date}.\n\nKind regards\n{company}'
        : `Hello\n\nPlease find attached our ${NAMES[kind]} {number} for {amount}.\n\nKind regards\n{company}`,
})

const variablesOf = (kind: EmailKind) =>
  kind === 'invoice'
    ? [...COMMON, 'due_date']
    : kind === 'quote'
      ? [...COMMON, 'valid_until']
      : COMMON

const sampleTemplates = (): EmailTemplate[] =>
  EMAIL_KINDS.flatMap((kind) =>
    EMAIL_LANGUAGES.map((language): EmailTemplate => {
      const fallback = defaultOf(kind)
      return {
        kind,
        language,
        subject: fallback.subject,
        body: fallback.body,
        custom: false,
        default: fallback,
        variables: variablesOf(kind),
      }
    }),
  )

let templates = sampleTemplates()

/** Every test or story starts from the defaults. */
export const resetEmailTemplatesMock = () => {
  templates = sampleTemplates()
}

type Facts = Record<string, string> & { to: string }
const invoiceFacts: Record<string, Facts> = {
  inv_1: {
    to: 'billing@acme.ch',
    document: 'Invoice',
    number: '2026-001',
    client: 'Acme AG',
    amount: "CHF 1'234.50",
    due_date: '31.12.2026',
    company: 'Muster GmbH',
  },
  inv_mock_schedule: {
    to: 'hello@alpenglow.ch',
    document: 'Invoice',
    number: '2026-042',
    client: 'Alpenglow Studio GmbH',
    amount: "CHF 1'081.00",
    due_date: '01.02.2027',
    company: 'Muster GmbH',
  },
}

const quoteFacts = (id: string): Facts | undefined => {
  const quote = sampleQuotes().find((entry) => entry.id === id)
  if (!quote) return undefined
  const [year, month, day] = quote.valid_until.split('-')
  return {
    to: 'hello@alpenglow.ch',
    document: 'Quote',
    number: quote.number ?? 'Q-2026-005',
    client: quote.client.name,
    amount: `CHF ${quote.payable_total}`,
    valid_until: `${day}.${month}.${year}`,
    company: 'Muster GmbH',
  }
}

const draftOf = (kind: EmailKind, { to, ...facts }: Facts): EmailDraft => {
  const template = templates.find((entry) => entry.kind === kind && entry.language === 'en')
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (all, name) => facts[name] ?? all)
  return {
    to: [to],
    subject: fill(template?.subject ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    message: fill(template?.body ?? ''),
  }
}

const fail = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
const notFound = () => fail(404, 'not_found', 'Not found.')

const find = (kind: string, language: string) =>
  templates.find((entry) => entry.kind === kind && entry.language === language)

export const emailTemplateHandlers = [
  http.get('/api/v1/email-templates', async () => {
    await delay()
    return HttpResponse.json({ data: templates })
  }),
  http.put<{ kind: string; language: string }, { subject?: unknown; body?: unknown }>(
    '/api/v1/email-templates/:kind/:language',
    async ({ params, request }) => {
      const current = find(params.kind, params.language)
      if (!current) return notFound()
      const { subject, body } = await request.json()
      const fields: Record<string, string> = {}
      const line = typeof subject === 'string' ? subject.trim() : ''
      if (!line || [...line].length > 200 || /[\r\n]/.test(line))
        fields.subject = 'Enter a subject of at most 200 characters, on one line.'
      if (typeof body !== 'string' || !body.trim() || [...body].length > 2500)
        fields.body = 'Enter a message of at most 2500 characters.'
      if (Object.keys(fields).length)
        return fail(400, 'invalid_request', 'Check the fields.', { fields })
      Object.assign(current, { subject: line, body, custom: true })
      return HttpResponse.json({ data: current })
    },
  ),
  http.delete<{ kind: string; language: string }>(
    '/api/v1/email-templates/:kind/:language',
    ({ params }) => {
      const current = find(params.kind, params.language)
      if (!current) return notFound()
      Object.assign(current, { ...current.default, custom: false })
      return HttpResponse.json({ data: current })
    },
  ),
  http.get<{ id: string }>('/api/v1/invoices/:id/email', ({ params }) => {
    const facts = invoiceFacts[params.id]
    return facts ? HttpResponse.json({ data: draftOf('invoice', facts) }) : notFound()
  }),
  http.get<{ id: string }>('/api/v1/quotes/:id/email', ({ params }) => {
    const facts = quoteFacts(params.id)
    return facts ? HttpResponse.json({ data: draftOf('quote', facts) }) : notFound()
  }),
]
