'use client'

import { Button } from '@helvetly/ui/components/button'
import { formatDate } from '@helvetly/ui/lib/format'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import {
  retryable,
  STATUS_LABELS,
  useRetryTransmission,
  useTransmissions,
} from '@/lib/transmissions'

/**
 * Where the invoice's e-document went besides email: each channel, its status and the channel's id. Hidden while
 * there is none, or while they cannot be loaded (the rest of the invoice must not wait on it).
 */
export function TransmissionsCard({
  invoiceId,
  canManage,
}: {
  invoiceId: string
  canManage: boolean
}) {
  const transmissions = useTransmissions(invoiceId)
  const retry = useRetryTransmission(invoiceId)
  if (!transmissions.data?.length) return null
  return (
    <section
      aria-labelledby="transmissions-title"
      className="rounded-xl bg-card px-4 pt-3 pb-4 shadow-elevation-1"
    >
      <h3 id="transmissions-title" className="text-[13px] font-medium text-muted-foreground">
        E-invoice transmissions
      </h3>
      <ul className="mt-3 grid gap-2">
        {transmissions.data.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="grid min-w-0">
              <span className="font-medium">
                {t.channel} · {t.format}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {STATUS_LABELS[t.status]} · {formatDate(t.updated_at.slice(0, 10))}
                {t.external_id ? ` · ${t.external_id}` : ''}
              </span>
              {t.last_error && (
                <span className="truncate text-xs text-destructive">{t.last_error}</span>
              )}
            </span>
            {canManage && retryable(t) && (
              <Button
                variant="outline"
                size="sm"
                disabled={retry.isPending}
                onClick={() =>
                  retry.mutate(t.id, {
                    onSuccess: () => toast.success('Queued again.'),
                    onError: toastError,
                  })
                }
              >
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
