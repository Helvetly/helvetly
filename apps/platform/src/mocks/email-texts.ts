// The fake of the built-in email texts and the drafts built from them.
import { delay, http, HttpResponse } from 'msw'

import {
  EMAIL_KINDS,
  EMAIL_LANGUAGES,
  type EmailDraft,
  type EmailKind,
  type EmailText,
} from '@/lib/email-texts'

import { sampleQuotes } from './quotes'

const NAMES: Record<EmailKind, string> = {
  invoice: 'invoice',
  credit_note: 'credit note',
  proforma: 'proforma invoice',
  quote: 'quote',
  payment_confirmation: 'payment confirmation',
  document: 'document',
  signature_request: 'signature request',
  signature_reminder: 'signature reminder',
}
/** The built-in English texts of the emails that send a file or ask for a signature (emailtemplate.go). */
const FILE_DEFAULTS: Partial<Record<EmailKind, { subject: string; body: string }>> = {
  document: {
    subject: '{document} from {company}',
    body: 'Hello\n\nPlease find “{document}” attached. If you have any questions, simply reply to this email.\n\nKind regards\n{sender}\n{company}',
  },
  signature_request: {
    subject: '{company} asks you to sign “{document}”',
    body: 'Hello\n\nPlease review and sign “{document}” using the link below. If you have any questions, simply reply to this email.\n\nKind regards\n{sender}\n{company}',
  },
  payment_confirmation: {
    subject: 'Payment received: {document} {number}',
    body: 'Hello\n\nThank you for your payment. We received {amount} on {paid_on} for {document} {number}.\n\nIf you have a question, reply to this email.\n\nKind regards\n{company}',
  },
  signature_reminder: {
    subject: 'Reminder: {company} asks you to sign “{document}”',
    body: 'Hello\n\nThis is a friendly reminder that “{document}” is still waiting for your signature. The link below takes you straight to it.\n\nKind regards\n{sender}\n{company}',
  },
}

const defaultOf = (kind: EmailKind) =>
  FILE_DEFAULTS[kind] ?? {
    subject: '{document} {number} from {company}',
    body:
      kind === 'quote'
        ? 'Hello\n\nPlease find attached our quote {number} for {amount}, valid until {valid_until}.\n\nKind regards\n{company}'
        : kind === 'invoice'
          ? 'Hello\n\nPlease find attached our invoice {number} for {amount}, payable by {due_date}.\n\nKind regards\n{company}'
          : `Hello\n\nPlease find attached our ${NAMES[kind]} {number} for {amount}.\n\nKind regards\n{company}`,
  }

const texts: EmailText[] = EMAIL_KINDS.flatMap((kind) =>
  EMAIL_LANGUAGES.map((language): EmailText => ({ kind, language, ...defaultOf(kind) })),
)

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
  const text = texts.find((entry) => entry.kind === kind && entry.language === 'en')
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (all, name) => facts[name] ?? all)
  return {
    to: [to],
    subject: fill(text?.subject ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    message: fill(text?.body ?? ''),
    reply_to: 'billing@muster.ch',
  }
}

const notFound = () =>
  HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 })

/** The preview routes' answer: the message as paragraphs in a plain letter, like the branded email. */
const previewOf = (subject: string, message: string, extra = '') => ({
  subject,
  html: `<!doctype html><html lang="en"><body><p><strong>Muster GmbH</strong></p>${message
    .split(/\n\n+/)
    .map(
      (part) =>
        `<p>${part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`,
    )
    .join('')}${extra}</body></html>`,
})

export const emailTextHandlers = [
  http.post<never, { title?: string; message?: string; language?: string }>(
    '/api/v1/signatures/email-preview',
    async ({ request }) => {
      const { title = '', message = '' } = await request.json()
      return HttpResponse.json({
        data: previewOf(
          `Muster AG asks you to sign “${title}”`,
          message,
          '<p><strong><a href="#">Review and sign →</a></strong></p>',
        ),
      })
    },
  ),
  http.post<never, { title?: string; subject?: string; message?: string }>(
    '/api/v1/templates/email-preview',
    async ({ request }) => {
      const { title = '', subject, message = '' } = await request.json()
      return HttpResponse.json({
        data: previewOf(subject || `${title} from Muster GmbH`, message),
      })
    },
  ),
  http.get('/api/v1/email-texts', async () => {
    await delay()
    return HttpResponse.json({ data: texts })
  }),
  http.get<{ id: string }>('/api/v1/invoices/:id/email', ({ params }) => {
    const facts = invoiceFacts[params.id]
    return facts ? HttpResponse.json({ data: draftOf('invoice', facts) }) : notFound()
  }),
  http.get<{ id: string }>('/api/v1/quotes/:id/email', ({ params }) => {
    const facts = quoteFacts(params.id)
    return facts ? HttpResponse.json({ data: draftOf('quote', facts) }) : notFound()
  }),
]
