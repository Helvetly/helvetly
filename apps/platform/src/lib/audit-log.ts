// The audit log made readable: a sentence per event, toggles and repeats folded into one row, days.
import { languageTag } from '@helvetly/i18n'
import { formatMoney } from '@helvetly/ui/lib/format'

import { recordPageHref, type RecordRef } from '@/components/record-link'
import type { AuditCategory, FinancialEvent } from '@/lib/books'
import { translate } from '@/lib/i18n'

export const AUDIT_CATEGORIES: { value: AuditCategory; label: string }[] = [
  { value: 'invoices', label: translate('auditTypeInvoices') },
  { value: 'payments', label: translate('auditTypePayments') },
  { value: 'expenses', label: translate('auditTypeExpenses') },
  { value: 'approvals', label: translate('auditTypeApprovals') },
  { value: 'books', label: translate('auditTypeBooks') },
  { value: 'portal', label: translate('auditTypePortal') },
  { value: 'employees', label: translate('auditTypeEmployees') },
  { value: 'settings', label: translate('auditTypeSettings') },
]

/**
 * Every kind the API writes (`store.AuditKinds`, held to this list by a Go test); each has its own sentence, which a
 * test checks, so "Entry recorded" is only ever seen for a kind newer than this app.
 */
export const AUDIT_KINDS = [
  'invoice.issued',
  'invoice.import_overwritten',
  'invoice.xml_archived',
  'invoice.voided',
  'invoice.replaced',
  'payment.added',
  'payment.deleted',
  'refund.added',
  'refund.deleted',
  'credit.issued',
  'plan.created',
  'plan.cancelled',
  'expense.booked',
  'expense.voided',
  'expense.payment_changed',
  'period.closed',
  'period.reopened',
  'approval.submitted',
  'approval.approved',
  'approval.rejected',
  'approval.withdrawn',
  'approval.reset',
  'approvals.group_saved',
  'approvals.group_deleted',
  'approvals.policy_saved',
  'workspace.portal_turned_off',
  'workspace.portal_turned_on',
  'workspace.portal_address_changed',
  'workspace.portal_domain_added',
  'workspace.portal_domain_removed',
  'workspace.reply_to_changed',
  'workspace.client_emails_changed',
  'portal.preview_started',
  'portal.preview_ended',
  'portal.participant_signed_in',
  'portal.participant_signed_out',
  'portal.participant_access_granted',
  'portal.participant_access_revoked',
  'client.merged_into_participant',
  'documents.exported',
  'imports.expired',
  'email_template.ai_written',
  'quote.contract_drafted',
  'quote.contract_written',
  'contract.signature_applied',
  'employee.created',
  'employee.archived',
  'employee.unarchived',
  'employee.deleted',
  'employee.erased',
  'employee.legal_hold_set',
  'employee.legal_hold_lifted',
  'employee.restricted',
  'employee.unrestricted',
  'employee.protected_viewed',
  'employee.document_added',
  'employee.document_deleted',
  'employee.document_hold_set',
  'employee.document_hold_lifted',
  'employee.pay_terms_added',
  'employee.pay_terms_removed',
  'payroll.booked',
  'payroll.exported',
  'payroll.corrected',
  'payroll.approved',
  'payroll.paid',
  'payroll.unpaid',
  'payroll.four_eyes_on',
  'payroll.four_eyes_off',
  'scheduling.cancelled',
  'scheduling.attendance_changed',
  'scheduling.waived',
  'scheduling.moved_from_calendar',
  'scheduling.request_decided',
  'scheduling.booking_link_created',
  'scheduling.booking_link_revoked',
  'scheduling.booking_link_used',
  'scheduling.settings_changed',
  'scheduling.holidays_changed',
  'scheduling.event_type_changed',
  'scheduling.calendar_connected',
  'scheduling.calendar_disconnected',
  'scheduling.feed_rotated',
] as const

/** A sentence's parts: plain text, and the record's number as a link where the record still exists. */
export type SentencePart = string | { label: string; href: string | null }
export type Sentence = { parts: SentencePart[]; amount: string | null }

// Marks where the record's number goes, so the translated sentence can carry a link there.
const MARK = '⁣'
const RECORD = `${MARK}record${MARK}`

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

const RECORD_KINDS: Record<string, RecordRef['kind']> = {
  invoice: 'invoice',
  quote: 'quote',
  expense: 'expense',
}

/** The event's record: its number now (or as recorded) and a link to its drawer while it exists. */
function recordOf(event: FinancialEvent) {
  const label =
    event.subject?.number ?? (text(event.payload.number) || translate('auditDraftLabel'))
  const kind = RECORD_KINDS[event.subject_type]
  const href = kind && event.subject ? recordPageHref({ kind, id: event.subject_id }) : null
  return { label, href }
}

function money(event: FinancialEvent, key: string) {
  const value = text(event.payload[key])
  // An expense's base amounts are in the workspace's currency, the rest in the record's.
  const currency =
    (BASE.has(key) && text(event.payload.base_currency)) ||
    text(event.payload.currency) ||
    event.subject?.currency
  if (!value) return ''
  return currency ? formatMoney(value, currency) : value
}

const BASE = new Set(['base_total', 'deductible_vat'])
const MONEY = new Set(['amount', 'payable_total', 'total', 'min_total', ...BASE])

const month = (value: string) =>
  /^\d{4}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat(languageTag, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}-01T00:00:00Z`))
    : value

const docType = (event: FinancialEvent) =>
  event.subject_type === 'quote' || event.subject_type === 'expense'
    ? event.subject_type
    : 'invoice'

/** The words of one event (no actor: the row shows who), with the record left as a mark. */
function words(event: FinancialEvent): { line: string; amount: string | null } {
  const [area = '', action = ''] = event.kind.split('.')
  const party = event.subject?.party || 'none'
  const doc = docType(event)
  switch (event.kind) {
    case 'invoice.issued':
      return {
        line: translate('auditSentenceInvoiceIssued', {
          doc: text(event.payload.kind),
          record: RECORD,
          party,
        }),
        amount: money(event, 'payable_total') || null,
      }
    case 'invoice.import_overwritten':
      return {
        line: translate('auditSentenceImportOverwritten', { record: RECORD }),
        amount: money(event, 'payable_total') || null,
      }
    case 'imports.expired':
      return { line: translate('auditSentenceImportExpired'), amount: null }
    case 'email_template.ai_written':
      return { line: translate('auditSentenceEmailTemplateAI'), amount: null }
    case 'quote.contract_drafted':
      return {
        line: translate('auditSentenceContractDrafted', {
          record: RECORD,
          template: text(event.payload.template),
        }),
        amount: null,
      }
    case 'quote.contract_written':
      return {
        line: translate('auditSentenceContractWritten', {
          record: RECORD,
          mode: text(event.payload.mode),
        }),
        amount: null,
      }
    case 'contract.signature_applied':
      return { line: translate('auditSentenceSignatureApplied', { record: RECORD }), amount: null }
    case 'invoice.xml_archived':
      return { line: translate('auditSentenceXmlArchived', { record: RECORD }), amount: null }
    case 'invoice.voided':
      return { line: translate('auditSentenceInvoiceVoided', { record: RECORD }), amount: null }
    case 'invoice.replaced':
      return {
        line: translate('auditSentenceInvoiceReplaced', {
          record: RECORD,
          replacement: text(event.payload.replaced_by_number),
        }),
        amount: null,
      }
    case 'payment.added':
    case 'payment.deleted':
      return {
        line: translate('auditSentencePayment', {
          action,
          amount: money(event, 'amount'),
          record: RECORD,
        }),
        amount: null,
      }
    case 'refund.added':
    case 'refund.deleted':
      return {
        line: translate('auditSentenceRefund', {
          action,
          amount: money(event, 'amount'),
          record: RECORD,
        }),
        amount: null,
      }
    case 'credit.issued':
      return {
        line: translate('auditSentenceCreditIssued', {
          credit: text(event.payload.credit_note_number),
          amount: money(event, 'amount'),
          record: RECORD,
        }),
        amount: null,
      }
    case 'expense.booked':
      return {
        line: translate('auditSentenceExpenseBooked', { record: RECORD, party }),
        amount: money(event, 'total') || null,
      }
    case 'expense.voided':
      return { line: translate('auditSentenceExpenseVoided', { record: RECORD }), amount: null }
    case 'expense.payment_changed':
      return {
        line: translate('auditSentenceExpensePaymentChanged', { record: RECORD }),
        amount: null,
      }
    case 'period.closed':
    case 'period.reopened':
      return {
        line: translate('auditSentencePeriod', {
          action,
          month: month(text(event.payload.month) || event.subject_id),
        }),
        amount: null,
      }
    case 'plan.created':
    case 'plan.cancelled':
      return {
        line: translate('auditSentencePlan', { action, count: Number(event.payload.count) || 0 }),
        amount: null,
      }
    case 'approvals.group_saved':
      return {
        line: translate('auditSentenceGroupSaved', { name: text(event.payload.name) }),
        amount: null,
      }
    case 'documents.exported':
      return {
        line: translate('auditSentenceDocumentsExported', {
          count: Number(event.payload.files) || 0,
        }),
        amount: null,
      }
    case 'approvals.group_deleted':
      return { line: translate('auditSentenceGroupDeleted'), amount: null }
    case 'approvals.policy_saved':
      return {
        line: translate('auditSentencePolicySaved', { doc: text(event.payload.doc_type) }),
        amount: null,
      }
  }
  if (area === 'approval')
    return {
      line: translate('auditSentenceApproval', { action, doc, record: RECORD }),
      amount: null,
    }
  if (area === 'workspace')
    return {
      line: translate('auditSentencePortal', {
        action,
        to: text(event.payload.to),
        hostname: text(event.payload.hostname),
      }),
      amount: null,
    }
  if (area === 'portal' && action.startsWith('participant_'))
    return {
      line: translate('auditSentencePortalParticipant', {
        action,
        participant: text(event.payload.participant_name),
        client: text(event.payload.client_name),
      }),
      amount: null,
    }
  if (event.kind === 'client.merged_into_participant')
    return {
      line: translate('auditSentenceMergedIntoParticipant', {
        client: text(event.payload.client_name),
        company: text(event.payload.company_name),
      }),
      amount: null,
    }
  if (area === 'portal')
    return {
      line: translate('auditSentencePortalPreview', {
        action,
        client: text(event.payload.client_name),
      }),
      amount: null,
    }
  if (area === 'employee')
    return { line: translate('auditSentenceEmployee', { action }), amount: null }
  if (area === 'payroll')
    return { line: translate('auditSentencePayroll', { action }), amount: null }
  if (area === 'scheduling')
    return {
      line: translate('auditSentenceScheduling', {
        action,
        as: text(event.payload.as),
        by: text(event.payload.by),
        to: text(event.payload.to),
        kind: text(event.payload.kind),
        decision: text(event.payload.decision),
        change: text(event.payload.change),
        provider: text(event.payload.provider),
      }),
      amount: null,
    }
  return { line: translate('auditSentenceOther'), amount: null }
}

/** Where an entry without a person came from: an import, a client, a calendar, a job, or a removed account. */
export type AuditSource = 'import' | 'client' | 'calendar' | 'system' | 'former'

export function eventSource(event: FinancialEvent): AuditSource | null {
  if (event.actor) return null
  if (event.origin === 'imported' || event.kind.startsWith('imports.')) return 'import'
  if (event.kind === 'scheduling.booking_link_used' || event.payload.by === 'client')
    return 'client'
  if (event.kind === 'scheduling.moved_from_calendar') return 'calendar'
  // Jobs write these without a person; any other entry without one was a member whose account is gone.
  return /^(invoice|credit|payment|refund|plan|workspace\.portal_domain|scheduling)\./.test(
    event.kind,
  )
    ? 'system'
    : 'former'
}

export const SOURCE_LABELS: Record<AuditSource, string> = {
  import: translate('auditSourceImport'),
  client: translate('auditSourceClient'),
  calendar: translate('auditSourceCalendar'),
  system: translate('system'),
  former: translate('auditSourceFormerMember'),
}

/** One event as a sentence, e.g. "Invoice 2026-031 issued to Acme AG" with CHF 1’200.00 beside it. */
export function eventSentence(event: FinancialEvent): Sentence {
  const { line, amount } = words(event)
  const record = recordOf(event)
  const parts = line
    .split(MARK)
    .map((part, index): SentencePart => (index % 2 === 1 ? record : part))
    .filter((part) => part !== '')
  return { parts, amount }
}

/** The sentence as plain text (search, labels, tests). */
export const sentenceText = (sentence: Sentence) =>
  sentence.parts.map((part) => (typeof part === 'string' ? part : part.label)).join('')

/** Consecutive events of one person that fold into one row: repeats, or a switch turned off and on. */
export type AuditRow = { key: string; events: FinancialEvent[] }

const TOGGLE = /_(turned_on|turned_off|on|off|set|lifted)$/
const foldKey = (event: FinancialEvent) =>
  [
    event.actor?.id ?? '',
    event.kind.replace(TOGGLE, '_toggle'),
    event.subject_id,
    JSON.stringify(event.payload),
  ].join('|')

/** Folds runs of the same change by the same person, each within `gap` of the one before. */
export function foldEvents(events: FinancialEvent[], gap = 30 * 60_000): AuditRow[] {
  const rows: AuditRow[] = []
  for (const event of events) {
    const row = rows.at(-1)
    const last = row?.events.at(-1)
    if (
      row &&
      last &&
      foldKey(last) === foldKey(event) &&
      Math.abs(Date.parse(last.at) - Date.parse(event.at)) <= gap
    )
      row.events.push(event)
    else rows.push({ key: String(event.seq), events: [event] })
  }
  return rows
}

/** A folded row's sentence: "Client portal turned off and on 6 times", else the latest event's. */
export function rowSentence(row: AuditRow): Sentence & { times: number } {
  const [first] = row.events
  const times = row.events.length
  const kinds = new Set(row.events.map((event) => event.kind))
  if (first && times > 1 && kinds.size > 1 && first.kind.startsWith('workspace.portal_turned'))
    return {
      parts: [translate('auditSentencePortalToggled', { count: times })],
      amount: null,
      times: 1,
    }
  // Newest first or oldest first, the row reads as its most recent change.
  const latest = row.events.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a))
  return { ...eventSentence(latest), times }
}

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Events by the local day they happened on, in the order given. */
export const byDay = (events: FinancialEvent[]) =>
  Map.groupBy(events, (event) => dayKey(new Date(event.at)))

const dayFormat = new Intl.DateTimeFormat(languageTag, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/** "Today", "Yesterday", else "Friday, 20 November 2026". */
export function dayLabel(key: string, now = new Date()) {
  if (key === dayKey(now)) return translate('today')
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKey(yesterday)) return translate('yesterday')
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number)
  return dayFormat.format(new Date(y, m - 1, d))
}

// Payload keys that are internal references, never shown.
const HIDDEN = /(^|_)(id|ids)$/

/** The payload's facts for the details drawer, with internal ids left out; from/to become before and after. */
export function payloadFacts(event: FinancialEvent): { key: string; value: string }[] {
  return Object.entries(event.payload)
    .filter(([key, value]) => !HIDDEN.test(key) && value !== null && value !== '')
    .map(([key, value]) => ({
      key,
      value:
        typeof value === 'object'
          ? JSON.stringify(value)
          : MONEY.has(key)
            ? money(event, key) || String(value)
            : String(value),
    }))
}
