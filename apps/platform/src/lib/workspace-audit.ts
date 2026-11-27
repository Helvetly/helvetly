import { locale } from '@helvetly/i18n'

import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'

export const auditLevels = {
  critical: translate('workspaceAuditCritical'),
  high: translate('workspaceAuditHigh'),
  medium: translate('workspaceAuditMedium'),
  low: translate('workspaceAuditLow'),
}
export const auditClasses = {
  error: translate('workspaceAuditClassError'),
  discrepancy: translate('workspaceAuditClassDiscrepancy'),
  missing: translate('workspaceAuditClassMissing'),
  review: translate('workspaceAuditClassReview'),
}
export const auditAreas = {
  clients: translate('workspaceAuditClients'),
  invoices: translate('workspaceAuditInvoices'),
  contracts: translate('workspaceAuditContracts'),
  payments: translate('workspaceAuditPayments'),
  tax: translate('workspaceAuditTax'),
  quotes: translate('workspaceAuditQuotes'),
  expenses: translate('workspaceAuditExpenses'),
  documents: translate('workspaceAuditDocuments'),
}
const routes = {
  client: '/clients?id=',
  invoice: '/invoices?id=',
  document: '/documents?file=',
  quote: '/quotes?id=',
  expense: '/expenses?id=',
}
type Evidence = { kind: keyof typeof routes; id: string; label: string }
export const evidenceHref = (e: Evidence) => routes[e.kind] + encodeURIComponent(e.id)
export type AuditFinding = {
  id: string
  class: keyof typeof auditClasses
  code: string
  severity: keyof typeof auditLevels
  category: keyof typeof auditAreas
  evidence: Evidence[]
  values?: string[]
  advice?: string
}
export type WorkspaceAudit = {
  findings: AuditFinding[]
  pending: string[]
  counts: Partial<Record<keyof typeof auditAreas, number>>
  read: number
  partial: number
}
const options = (signal: AbortSignal) => ({ method: 'POST' as const, signal })
export const fetchAudit = (signal: AbortSignal) =>
  request<WorkspaceAudit>(`/reports/workspace-audit?lang=${locale}`, options(signal))
export const inspectOriginal = (id: string, signal: AbortSignal) =>
  request<{ status: string }>(
    `/reports/workspace-audit/documents/${encodeURIComponent(id)}?lang=${locale}`,
    options(signal),
  )

const copy: Record<string, [string, string]> = {
  ledger_total: [translate('workspaceAuditLedgerTotal'), translate('workspaceAuditCheckPayments')],
  schedule_total: [
    translate('workspaceAuditScheduleTotal'),
    translate('workspaceAuditCheckAmounts'),
  ],
  missing_original: [
    translate('workspaceAuditMissingOriginal'),
    translate('workspaceAuditCheckFile'),
  ],
  broken_contract: [
    translate('workspaceAuditBrokenContract'),
    translate('workspaceAuditCheckContract'),
  ],
  contract_owner: [
    translate('workspaceAuditContractOwner'),
    translate('workspaceAuditCheckParties'),
  ],
  contract_versions: [
    translate('workspaceAuditVersions'),
    translate('workspaceAuditCheckContract'),
  ],
  contract_link: [
    translate('workspaceAuditContractLink'),
    translate('workspaceAuditCheckContract'),
  ],
  same_name: [translate('workspaceAuditSameName'), translate('workspaceAuditCheckParties')],
  client_no_invoice: [
    translate('workspaceAuditClientNoInvoice'),
    translate('workspaceAuditCheckBilling'),
  ],
  folder_owner: [translate('workspaceAuditFolderOwner'), translate('workspaceAuditCheckParties')],
  record_owner: [translate('workspaceAuditRecordOwner'), translate('workspaceAuditCheckParties')],
  file_missing: [translate('workspaceAuditFileMissing'), translate('workspaceAuditCheckFile')],
  file_integrity: [translate('workspaceAuditFileIntegrity'), translate('workspaceAuditCheckFile')],
  file_oversize: [translate('workspaceAuditFileOversize'), translate('workspaceAuditCheckFile')],
  file_unsupported: [
    translate('workspaceAuditFileUnsupported'),
    translate('workspaceAuditCheckFile'),
  ],
  partial_read: [translate('workspaceAuditPartialRead'), translate('workspaceAuditCheckFile')],
  source_observation: [
    translate('workspaceAuditSourceObservation'),
    translate('workspaceAuditCheckFile'),
  ],
  tax_year: [translate('workspaceAuditTaxYear'), translate('workspaceAuditCheckPeriod')],
  invoice_copy: [translate('workspaceAuditInvoiceCopy'), translate('workspaceAuditCheckFile')],
  original_kind: [translate('workspaceAuditOriginalKind'), translate('workspaceAuditCheckFile')],
  printed_owner: [translate('workspaceAuditPrintedOwner'), translate('workspaceAuditCheckParties')],
  original_total: [
    translate('workspaceAuditOriginalTotal'),
    translate('workspaceAuditCheckAmounts'),
  ],
  original_number: [
    translate('workspaceAuditOriginalNumber'),
    translate('workspaceAuditCheckFile'),
  ],
  contract_reference: [
    translate('workspaceAuditContractReference'),
    translate('workspaceAuditCheckContract'),
  ],
  original_schedule: [
    translate('workspaceAuditOriginalSchedule'),
    translate('workspaceAuditCheckAmounts'),
  ],
  contract_amount: [
    translate('workspaceAuditContractAmount'),
    translate('workspaceAuditCheckTerms'),
  ],
  receipt_total: [translate('workspaceAuditReceiptTotal'), translate('workspaceAuditCheckAmounts')],
  unknown_invoice: [
    translate('workspaceAuditUnknownInvoice'),
    translate('workspaceAuditCheckPayments'),
  ],
  payment_owner: [
    translate('workspaceAuditPaymentOwner'),
    translate('workspaceAuditCheckPayments'),
  ],
  payment_unmatched: [
    translate('workspaceAuditPaymentUnmatched'),
    translate('workspaceAuditCheckPayments'),
  ],
  booking_without_proof: [
    translate('workspaceAuditBookingWithoutProof'),
    translate('workspaceAuditCheckPayments'),
  ],
  payment_link: [translate('workspaceAuditPaymentLink'), translate('workspaceAuditCheckPayments')],
  unreferenced_transfer: [
    translate('workspaceAuditUnreferencedTransfer'),
    translate('workspaceAuditCheckPayments'),
  ],
  filename_reference: [
    translate('workspaceAuditFilenameReference'),
    translate('workspaceAuditCheckPayments'),
  ],
  missing_client: [
    translate('workspaceAuditMissingClient'),
    translate('workspaceAuditCheckParties'),
  ],
}
export const findingCopy = (code: string) => copy[code] ?? [translate('workspaceAuditFallback'), '']
const rank = { critical: 0, high: 1, medium: 2, low: 3 }
export function findingGroups(findings: AuditFinding[], area: string, level: string) {
  const groups = new Map<string, [AuditFinding, ...AuditFinding[]]>()
  for (const finding of findings) {
    if ((area && finding.category !== area) || (level && finding.severity !== level)) continue
    const key = [finding.severity, finding.category, finding.code].join('/')
    const group = groups.get(key)
    if (group) group.push(finding)
    else groups.set(key, [finding])
  }
  return [...groups.entries()].toSorted(
    ([, a], [, b]) =>
      rank[a[0].severity] - rank[b[0].severity] ||
      b.length - a.length ||
      findingCopy(a[0].code)[0].localeCompare(findingCopy(b[0].code)[0]),
  )
}

const original = translate('workspaceAuditOriginal')
const record = translate('workspaceAuditRecord')
const comparisonLabels: Record<string, [string, string]> = {
  original_total: [original, record],
  original_number: [original, record],
  contract_reference: [original, record],
  ledger_total: [record, translate('workspaceAuditPayments')],
  schedule_total: [translate('workspaceAuditInstalments'), record],
  contract_amount: [translate('workspaceAuditContracts'), translate('workspaceAuditInvoices')],
  receipt_total: [original, record],
  tax_year: [original, translate('workspaceAuditFolder')],
  filename_reference: [translate('workspaceAuditFilename'), translate('workspaceAuditTransfer')],
}
export function findingValues(finding: AuditFinding) {
  const labels = comparisonLabels[finding.code]
  return finding.values
    ?.map((value, index) => (labels?.[index] ? labels[index] + ' · ' + value : value))
    .join('  /  ')
}
