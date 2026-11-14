'use client'

import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'

import { statusLabel, type QuoteStatus } from '@/lib/quotes'

// Answered "no" or run out: muted, like a void invoice.
const TONES: Record<QuoteStatus, Tone> = {
  draft: 'gray',
  sent: 'blue',
  accepted: 'green',
  declined: 'gray',
  expired: 'gray',
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <StatusBadge tone={TONES[status]}>{statusLabel(status)}</StatusBadge>
}
