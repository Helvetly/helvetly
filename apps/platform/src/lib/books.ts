// Closed periods, the audit log and self-billing agreements, typed by hand from
// docs/books-contract.md.
import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'

export type Person = { id: string; name: string; avatar_url?: string | null }
export type Period = { month: string; closed_at: string; closed_by: Person | null }
export type ActivityTotal = { currency: string; amount: string }
export type ActivitySource = {
  /** invoices issued (any status but draft) or expenses booked */
  recorded: number
  /** drafts dated in the month: issuing or booking them is refused once it is closed */
  drafts: number
  totals: ActivityTotal[]
}
export type MonthActivity = {
  month: string
  /** null when the session may not read that kind of record */
  invoices: ActivitySource | null
  expenses: ActivitySource | null
}
export type AuditCategory =
  | 'payments'
  | 'invoices'
  | 'expenses'
  | 'approvals'
  | 'books'
  | 'portal'
  | 'employees'
  | 'settings'
export type FinancialEvent = {
  seq: number
  kind: string
  category: AuditCategory
  subject_type: string
  subject_id: string
  /** the invoice, quote or expense as it is now; null for other records or one that is gone */
  subject: { number: string | null; party: string | null; currency: string | null } | null
  /** null for the hourly job or a deleted account */
  actor: Person | null
  /** 'imported' for what an import wrote */
  origin: 'imported' | null
  at: string
  payload: Record<string, unknown>
  prev_hash: string
  hash: string
}
/** The list's filters as the API takes them; since/before are RFC 3339 instants. */
export type AuditFilter = Partial<{
  order: 'oldest' | 'newest'
  category: AuditCategory
  actor: string
  since: string
  before: string
  q: string
  origin: 'imported'
}>
export type EventPage = { data: FinancialEvent[]; meta: { next_cursor: string | null } }
export type ChainCheck = { ok: boolean; broken_at: number | null; entries: number }
export type SelfBillingAgreement = {
  id: string
  client_id: string
  starts_on: string
  ends_on: string | null
  accepted_at: string | null
  accepted_by: string | null
  note: string | null
  /** set by the first self-billed invoice issued under it; then it can no longer be deleted */
  first_used_at: string | null
  created_at: string
}
export type AgreementInput = Pick<SelfBillingAgreement, 'starts_on'> &
  Partial<Pick<SelfBillingAgreement, 'ends_on' | 'accepted_at' | 'accepted_by' | 'note'>>

type One<T> = { data: T }
const agreements = (clientId: string) =>
  `/clients/${encodeURIComponent(clientId)}/self-billing-agreements`

export const booksApi = {
  periods: () => request<One<Period[]>>('/periods'),
  close: (month: string) => request<One<Period>>('/periods', { method: 'POST', json: { month } }),
  reopen: (month: string, reason = '') =>
    request<One<{ month: string }>>(`/periods/${encodeURIComponent(month)}/reopen`, {
      method: 'POST',
      json: { reason },
    }),
  /** Every month from..to (YYYY-MM, at most 36), oldest first. */
  activity: (from: string, to: string) =>
    request<One<MonthActivity[]>>(
      `/periods/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  events: (cursor?: string | null, limit?: number, filter: AuditFilter = {}) => {
    const query = new URLSearchParams()
    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', String(limit))
    for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value)
    return request<EventPage>(`/audit-log${query.size ? `?${query}` : ''}`)
  },
  people: () => request<One<Person[]>>('/audit-log/people'),
  verify: () => request<One<ChainCheck>>('/audit-log/verify'),
  agreements: (clientId: string) => request<One<SelfBillingAgreement[]>>(agreements(clientId)),
  createAgreement: (clientId: string, input: AgreementInput) =>
    request<One<SelfBillingAgreement>>(agreements(clientId), { method: 'POST', json: input }),
  deleteAgreement: (clientId: string, agreementId: string) =>
    request<void>(`${agreements(clientId)}/${encodeURIComponent(agreementId)}`, {
      method: 'DELETE',
    }),
}

// A plain link so the browser sends the session cookie and saves the file.
export const exportUrl = () => '/api/v1/audit-log/export'

export const EVENT_LABELS: Record<string, string> = {
  'invoice.issued': translate('invoiceIssued'),
  'invoice.xml_archived': translate('eInvoiceXMLArchived'),
  'invoice.voided': translate('invoiceVoided'),
  'invoice.replaced': translate('invoiceReplaced'),
  'payment.added': translate('paymentAdded'),
  'payment.deleted': translate('paymentDeleted2'),
  'refund.added': translate('refundAdded'),
  'credit.issued': translate('creditNoteIssued'),
  'expense.booked': translate('expenseBooked2'),
  'expense.voided': translate('expenseVoided2'),
  'expense.payment_changed': translate('expensePaymentChanged'),
  'period.closed': translate('periodClosed'),
  'period.reopened': translate('periodReopened'),
  'plan.created': translate('instalmentPlanCreated'),
  'plan.cancelled': translate('instalmentPlanCancelled'),
  'workspace.portal_address_changed': translate('auditPortalAddressChanged'),
  'workspace.portal_turned_off': translate('auditPortalTurnedOff'),
  'workspace.portal_turned_on': translate('auditPortalTurnedOn'),
  'workspace.reply_to_changed': translate('auditReplyToChanged'),
  'workspace.client_emails_changed': translate('auditClientEmailsChanged'),
  'portal.preview_started': translate('auditPortalPreviewStarted'),
  'portal.preview_ended': translate('auditPortalPreviewEnded'),
  'documents.exported': translate('auditDocumentsExported'),
  'documents.folder_repaired': translate('auditDocumentsFolderRepaired'),
  'imports.expired': translate('auditImportExpired'),
  'approval.submitted': translate('auditApprovalSubmitted'),
  'approval.approved': translate('auditApprovalApproved'),
  'approval.rejected': translate('auditApprovalRejected'),
  'approval.withdrawn': translate('auditApprovalWithdrawn'),
  'approval.reset': translate('auditApprovalReset'),
  'approvals.group_saved': translate('auditApprovalGroupSaved'),
  'approvals.group_deleted': translate('auditApprovalGroupDeleted'),
  'approvals.policy_saved': translate('auditApprovalPolicySaved'),
}
