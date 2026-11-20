'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Ellipsis, X, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { loadProblemText } from '@/components/data/load-problem'
import { RecordLink } from '@/components/record-link'
import { RecordPageButton } from '@/components/record-link'
import { ApiError, errorMessage } from '@/lib/api'
import {
  cancelEngagement,
  deleteEngagement,
  engagementQuery,
  listEntries,
  listPeriods,
  periodLabel,
  renewEngagement,
  resumeEngagement,
  type Engagement,
} from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { canManage } from '@/lib/members'
import { useCan } from '@/lib/permissions'
import { queryKeys, useSession } from '@/lib/queries'

import { approx, AttentionBadges, plain, ProgressBar, withUnit } from './engagement-bits'
import { EngagementForm } from './engagement-form'
import { EntriesPanel, friendlyError, QuickLog, today, useRefreshEngagement } from './entry-log'
import { PeriodsPanel } from './periods-panel'

const STATUS = {
  scheduled: ['blue', translate('scheduled')],
  active: ['green', translate('active')],
  ended: ['gray', translate('ended')],
  cancelled: ['amber', translate('cancelled')],
} as const

const daysLeft = (endsOn: string) =>
  Math.max(0, Math.round((Date.parse(endsOn) - Date.parse(today())) / 86_400_000) + 1)

/** One engagement in a sheet from the right: progress, quick log, entries, periods. */
export function EngagementDetail({
  id,
  onOpenChange,
}: {
  id: string | null
  onOpenChange: (open: boolean) => void
}) {
  const query = useQuery({ ...engagementQuery(id ?? ''), enabled: id !== null })
  const engagement = query.data
  return (
    <Sheet open={id !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto bg-panel p-0 sm:w-[min(680px,100vw)]! dark:bg-background"
      >
        <SheetTitle className="sr-only">{engagement?.title ?? translate('engagement2')}</SheetTitle>
        <SheetDescription className="sr-only">
          {translate('engagementDetailsAndDeliveryLog')}
        </SheetDescription>
        {engagement ? (
          <Detail engagement={engagement} onClose={() => onOpenChange(false)} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-title-sm">{translate('thisEngagementCouldnTBeLoaded')}</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, translate('thisEngagement'))}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {translate('tryAgain')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                {translate('close')}
              </Button>
            </div>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({ engagement, onClose }: { engagement: Engagement; onClose: () => void }) {
  const session = useSession()
  const privileged = canManage(session.data?.role ?? '')
  const writable = useCan('write:engagements')
  const refresh = useRefreshEngagement()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const periods = useQuery({
    queryKey: [...queryKeys.engagements, engagement.id, 'periods'],
    queryFn: async () => (await listPeriods(engagement.id)).data,
  })
  const entries = useQuery({
    queryKey: [...queryKeys.engagements, engagement.id, 'entries'],
    queryFn: async () => (await listEntries(engagement.id)).data,
  })

  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => refresh(),
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })
  const remove = useMutation({
    mutationFn: () => deleteEngagement(engagement.id),
    onSuccess: () => {
      refresh()
      toast.success(translate('engagementDeleted'))
      onClose()
    },
    onError: (error: unknown) => {
      setDeleting(false)
      toast.error(
        error instanceof ApiError && error.code === 'engagement_invoiced'
          ? translate('thisEngagementHasInvoicesVoidOrDeleteThemFirst')
          : errorMessage(error),
      )
    },
  })

  const [tone, label] = STATUS[engagement.status]
  const unit = engagement.unit
  const period = engagement.current_period
  const current = periods.data?.find((entry) => entry.id === period?.id) ?? null
  const cancellable = engagement.status === 'active' || engagement.status === 'scheduled'

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 px-3">
          <span className="text-body-sm text-muted-foreground">
            {translate('engagement')}
            <span className="font-code">{engagement.number}</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            {writable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={translate('moreActions')}>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    {translate('edit')}
                  </DropdownMenuItem>
                  {engagement.recurrence === 'none' && (
                    <DropdownMenuItem
                      // A second renew while the first runs would renew twice.
                      disabled={act.isPending}
                      onSelect={() =>
                        act.mutate(async () => {
                          await renewEngagement(engagement.id)
                          toast.success(translate('renewedForTheNextPeriod'))
                        })
                      }
                    >
                      {translate('renew')}
                    </DropdownMenuItem>
                  )}
                  {privileged && (cancellable || engagement.status === 'cancelled') && (
                    <DropdownMenuItem
                      disabled={act.isPending}
                      onSelect={() =>
                        act.mutate(() =>
                          cancellable
                            ? cancelEngagement(engagement.id)
                            : resumeEngagement(engagement.id),
                        )
                      }
                    >
                      {cancellable ? translate('cancelEngagement') : translate('resume')}
                    </DropdownMenuItem>
                  )}
                  {privileged && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                        <Trash2 />
                        {translate('delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <RecordPageButton />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={translate('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        <div className="grid gap-1.5 px-5 pb-4">
          <h2 className="text-xl font-semibold tracking-tight">{engagement.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-body-sm">
            <RecordLink
              href={`/clients?id=${encodeURIComponent(engagement.client.id)}`}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground hover:no-underline"
            >
              {engagement.client.name}
            </RecordLink>
            <StatusBadge tone={tone}>{label}</StatusBadge>
            {engagement.auto_invoice && (
              <StatusBadge tone="gray">{translate('draftsAutomatic')}</StatusBadge>
            )}
            <AttentionBadges attention={engagement.attention} />
          </div>
        </div>
      </header>

      <div className="grid content-start gap-3 p-4 sm:p-5">
        {period && (
          <Panel
            title={translate('currentPeriod')}
            action={
              <span className="text-caption text-muted-foreground tabular-nums">
                {periodLabel(period)}
              </span>
            }
          >
            <div className="grid gap-3">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tabular-nums">{plain(period.used)}</span>
                <span className="text-title text-muted-foreground tabular-nums">
                  / {withUnit(period.available, unit)}
                </span>
              </div>
              {(Number(period.carried_in) > 0 || period.full_quantity !== period.quantity) && (
                <p className="-mt-1.5 text-body-sm text-muted-foreground">
                  {Number(period.carried_in) > 0 &&
                    translate('carriedOver', { value1: withUnit(period.carried_in, unit) })}
                  {Number(period.carried_in) > 0 &&
                    period.full_quantity !== period.quantity &&
                    ' · '}
                  {period.full_quantity !== period.quantity &&
                    translate('proratedFrom', { value1: withUnit(period.full_quantity, unit) })}
                </p>
              )}
              <ProgressBar period={period} unit={unit} size="lg" caption={false} />
              <dl className="grid grid-cols-3 gap-3">
                {Number(period.overage) > 0 ? (
                  <Stat label={translate('over2')} value={withUnit(period.overage, unit)} danger />
                ) : (
                  <Stat label={translate('left2')} value={withUnit(period.remaining, unit)} />
                )}
                <Stat label={translate('daysLeft')} value={String(daysLeft(period.ends_on))} />
                <Stat
                  label={translate('expectedByNow')}
                  value={withUnit(approx(period.expected), unit)}
                />
              </dl>
            </div>
          </Panel>
        )}

        {writable && (
          <Panel title={translate('logDelivery')}>
            <QuickLog engagement={engagement} current={current} />
          </Panel>
        )}

        <EntriesPanel
          engagementId={engagement.id}
          entries={entries.data ?? []}
          periods={periods.data ?? []}
          unit={unit}
          writable={writable}
          perEntry={engagement.invoice_detail === 'per_entry'}
        />

        <Panel title={translate('periods')}>
          <PeriodsPanel engagement={engagement} periods={periods.data ?? []} />
        </Panel>

        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {translate('added2')}
          {formatDate(engagement.created_at)}
          {translate('updated')}
          {formatDate(engagement.updated_at)}
        </p>
      </div>

      {editing && <EngagementForm open onOpenChange={setEditing} engagement={engagement} />}
      {deleting && (
        <ConfirmDialog
          title={translate('deleteThisEngagement')}
          body={translate('itsLogAndPeriodsAreRemovedThisCanT')}
          confirmLabel={translate('delete3')}
          tone="destructive"
          onDecide={(approved) => (approved ? remove.mutate() : setDeleting(false))}
        />
      )}
    </div>
  )
}

/** One figure under the current period's bar: a quiet label over the value. */
function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={cn('text-body font-medium tabular-nums', danger && 'text-destructive')}>
        {value}
      </dd>
    </div>
  )
}
