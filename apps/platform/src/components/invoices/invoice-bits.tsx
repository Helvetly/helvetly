'use client'
import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
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
  type DisplayStatus,
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

export const STATUS_TONES: Record<DisplayStatus, Tone> = {
  draft: 'gray',
  open: 'blue',
  overdue: 'red',
  paid: 'green',
  void: 'gray',
  replaced: 'gray',
  credit_draft: 'gray',
  credit_applied: 'amber',
}

export function InvoiceStatusBadge({
  invoice,
}: {
  invoice: Pick<Invoice, 'kind' | 'status' | 'is_overdue'>
}) {
  const status = displayStatus(invoice)
  return <StatusBadge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</StatusBadge>
}

/** A row's status, or "Refund due" while the customer is owed money back. */
export function RowStatus({
  invoice,
}: {
  invoice: Pick<Invoice, 'kind' | 'status' | 'is_overdue' | 'refund_due'>
}) {
  return isPositive(invoice.refund_due) ? (
    <StatusBadge tone="amber">{translate('refundDue')}</StatusBadge>
  ) : (
    <InvoiceStatusBadge invoice={invoice} />
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
