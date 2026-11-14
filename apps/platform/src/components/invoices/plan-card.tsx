'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { RecordLink } from '@/components/record-link'
import { errorMessage, type ApiError } from '@/lib/api'
import { instalmentsApi, issuedCount, PLAN_STATUS_LABELS, type Plan } from '@/lib/instalments'
import { formatDay, INTERVALS, invoiceKeys } from '@/lib/invoices'

export const planKeys = {
  all: ['instalment-plans'] as const,
  list: (clientId?: string) => ['instalment-plans', 'list', clientId ?? ''] as const,
  detail: (id: string) => ['instalment-plans', 'detail', id] as const,
}

export const usePlan = (id: string) =>
  useQuery<Plan, ApiError>({
    queryKey: planKeys.detail(id),
    queryFn: async () => (await instalmentsApi.get(id)).data,
  })

export const usePlans = (clientId?: string) =>
  useQuery<Plan[], ApiError>({
    queryKey: planKeys.list(clientId),
    queryFn: async () => (await instalmentsApi.list(clientId)).data,
  })

type Action = 'pause' | 'resume' | 'cancel'

function usePlanAction() {
  const queryClient = useQueryClient()
  return useMutation<Plan, ApiError, { id: string; action: Action }>({
    mutationFn: async ({ id, action }) => (await instalmentsApi[action](id)).data,
    onSuccess: (plan) => {
      queryClient.setQueryData(planKeys.detail(plan.id), plan)
      void queryClient.invalidateQueries({ queryKey: planKeys.all })
      // Cancelling ends the source draft's lock badge and the partials' "next" hints.
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all })
    },
  })
}

const DONE: Record<Action, string> = {
  pause: 'Plan paused: nothing is issued until you resume it.',
  resume: 'Plan resumed.',
  cancel: 'Plan cancelled. Issued invoices stay as they are.',
}

/** A plan's progress (2 of 6 issued), its items, and pause / resume / cancel. */
export function PlanCard({ planId, canManage }: { planId: string; canManage: boolean }) {
  const query = usePlan(planId)
  const act = usePlanAction()
  const [cancelling, setCancelling] = useState(false)
  const plan = query.data

  const run = (action: Action) =>
    act.mutate(
      { id: planId, action },
      {
        onSuccess: () => toast.success(DONE[action]),
        onError: (e) => toast.error(errorMessage(e)),
      },
    )

  if (!plan)
    return (
      <section className="rounded-xl bg-card px-4 py-4 text-[13.5px] text-muted-foreground shadow-elevation-1">
        {query.error ? errorMessage(query.error) : 'Loading the instalment plan…'}
      </section>
    )

  const issued = issuedCount(plan)
  const interval = INTERVALS.find((entry) => entry.value === plan.interval)?.label ?? plan.interval
  return (
    <section
      aria-label="Instalment plan"
      className="grid gap-3 rounded-xl bg-card px-4 pt-3 pb-4 shadow-elevation-1"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-medium text-muted-foreground">Instalment plan</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[12px]">
          {PLAN_STATUS_LABELS[plan.status]}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {issued} of {plan.count} issued · {interval}
        </span>
        {canManage && (
          <span className="ml-auto flex gap-1">
            {plan.status === 'active' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={act.isPending}
                onClick={() => run('pause')}
              >
                <Pause className="size-3.5" /> Pause
              </Button>
            )}
            {plan.status === 'paused' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={act.isPending}
                onClick={() => run('resume')}
              >
                <Play className="size-3.5" /> Resume
              </Button>
            )}
            {(plan.status === 'active' || plan.status === 'paused') && (
              <Button
                variant="destructive-ghost"
                size="sm"
                disabled={act.isPending}
                onClick={() => setCancelling(true)}
              >
                <Ban className="size-3.5" /> Cancel plan
              </Button>
            )}
          </span>
        )}
      </div>
      {/* The "n of m issued" text above says it; the bar is for the eye. */}
      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[#5ba26a]"
          style={{ width: `${(issued / plan.count) * 100}%` }}
        />
      </div>
      <ol className="divide-y divide-border/60 text-[13.5px]">
        {plan.items.map((item) => (
          <li key={item.seq} className="flex items-center gap-3 py-2">
            <span className="w-12 text-muted-foreground tabular-nums">
              {item.seq}/{plan.count}
            </span>
            <span className="flex-1 tabular-nums">due {formatDay(item.due_date)}</span>
            {item.invoice_id ? (
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(item.invoice_id)}`}
                className="underline-offset-4 hover:underline"
              >
                {item.number ?? 'Issued'}
              </RecordLink>
            ) : (
              <span
                className={cn(
                  'text-muted-foreground',
                  item.status === 'cancelled' && 'line-through',
                )}
              >
                {item.status === 'cancelled' ? 'Cancelled' : `issued ${formatDay(item.issue_on)}`}
              </span>
            )}
          </li>
        ))}
      </ol>
      {cancelling && (
        <ConfirmDialog
          title="Cancel this plan?"
          body="The invoices it issued stay as they are; the rest are never issued. This can’t be undone."
          confirmLabel="Cancel plan"
          tone="destructive"
          confirmIcon={<Ban />}
          onDecide={(approved) => {
            setCancelling(false)
            if (approved) run('cancel')
          }}
        />
      )}
    </section>
  )
}
