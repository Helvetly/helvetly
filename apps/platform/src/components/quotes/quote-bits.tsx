'use client'

import { Badge } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'

import { statusLabel, type QuoteStatus } from '@/lib/quotes'

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={STATUS_TONES.quote[status]}>{statusLabel(status)}</Badge>
}
