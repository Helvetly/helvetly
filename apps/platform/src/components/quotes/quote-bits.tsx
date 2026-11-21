'use client'

import { Badge } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'

import { ApprovalBadge } from '@/components/invoices/invoice-bits'
import { statusLabel, type Quote, type QuoteStatus } from '@/lib/quotes'

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={STATUS_TONES.quote[status]}>{statusLabel(status)}</Badge>
}

/** A list row's status, and a draft's approval beside it. */
export function QuoteRowStatus({ quote }: { quote: Pick<Quote, 'status' | 'approval_state'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <QuoteStatusBadge status={quote.status} />
      {quote.status === 'draft' && <ApprovalBadge state={quote.approval_state} />}
    </span>
  )
}
