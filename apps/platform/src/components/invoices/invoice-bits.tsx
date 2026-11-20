'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowLeftRight,
  ChartPie,
  FileClock,
  FilePen,
  FilePlus2,
  FileText,
  HandCoins,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

import { translate } from '@/lib/i18n'
import {
  displayStatus,
  formatAmount,
  isPositive,
  STATUS_LABELS,
  type Invoice,
  type InvoiceKind,
} from '@/lib/invoices'

/** One icon per kind: the Invoices tabs, the create menu and the editor's tab. */
export const KIND_ICONS: Record<InvoiceKind, LucideIcon> = {
  invoice: FileText,
  partial: ChartPie,
  prepayment: HandCoins,
  debit_note: FilePlus2,
  corrected: FilePen,
  credit_note: Undo2,
  proforma: FileClock,
  self_billed: ArrowLeftRight,
}

export function InvoiceStatusBadge({
  invoice,
}: {
  invoice: Pick<Invoice, 'kind' | 'status' | 'is_overdue' | 'amount_paid'>
}) {
  const status = displayStatus(invoice)
  return <Badge tone={STATUS_TONES.invoice[status]}>{STATUS_LABELS[status]}</Badge>
}

const APPROVAL_LABELS: Record<NonNullable<Invoice['approval_state']>, string> = {
  pending: translate('approvalPending'),
  approved: translate('approvalApproved'),
  rejected: translate('approvalChangesRequested'),
}

/** A draft's approval: "Pending approval", "Approved", "Changes requested"; nothing without a request. */
export function ApprovalBadge({ state }: { state: Invoice['approval_state'] }) {
  if (!state) return null
  return <Badge tone={STATUS_TONES.approval[state]}>{APPROVAL_LABELS[state]}</Badge>
}

/** A row's status, or "Refund due" while the customer is owed money back; a draft's approval beside it. */
export function RowStatus({
  invoice,
}: {
  invoice: Pick<
    Invoice,
    'kind' | 'status' | 'is_overdue' | 'refund_due' | 'amount_paid' | 'approval_state'
  >
}) {
  return isPositive(invoice.refund_due) ? (
    <Badge tone={STATUS_TONES.invoice.refund_due}>{translate('refundDue')}</Badge>
  ) : (
    <>
      <InvoiceStatusBadge invoice={invoice} />
      {invoice.status === 'draft' && <ApprovalBadge state={invoice.approval_state} />}
    </>
  )
}

/** An amount with its currency set small and muted before it; credit notes read as negative. */
export function Money({
  value,
  currency,
  negative = false,
  className,
}: {
  value: string
  currency: string
  negative?: boolean
  className?: string
}) {
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      <span className="mr-1 text-[0.82em] text-muted-foreground">{currency}</span>
      {negative && '−'}
      {formatAmount(value)}
    </span>
  )
}

/** The number, or a muted dash while it has none (the status already says Draft). */
export function InvoiceNumber({ invoice }: { invoice: Pick<Invoice, 'number'> }) {
  return invoice.number ? (
    <span className="tabular-nums">{invoice.number}</span>
  ) : (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">{translate('noNumberYet')}</span>
    </span>
  )
}
