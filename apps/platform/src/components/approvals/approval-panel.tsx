'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Panel } from '@helvetly/ui/components/panel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, MessageSquareWarning, RotateCcw, Send, Undo2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { fieldErrors, FormDialog } from '@/components/invoices/invoice-dialogs'
import { TextareaBox } from '@/components/textarea-box'
import { UserAvatar } from '@/components/user-avatar'
import {
  useApprovalAction,
  type Approval,
  type ApprovalAction,
  type ApprovalDoc,
  type ApprovalTarget,
  type TrailEntry,
} from '@/lib/approvals'
import { translate } from '@/lib/i18n'

/** Whether issuing waits for an approval: required and not approved yet. */
export const awaitsApproval = (approval: Approval | undefined) =>
  Boolean(approval?.required && approval.state !== 'approved')

/** Whether the drawer shows the approval at all: it is required, or a request exists from before. */
export const showsApproval = (approval: Approval | undefined): approval is Approval =>
  Boolean(approval && (approval.required || approval.state !== 'none'))

const DONE: Record<ApprovalAction, string> = {
  submit: translate('approvalSubmitted'),
  withdraw: translate('approvalWithdrawn'),
  approve: translate('approvalYouApproved'),
  reject: translate('approvalYouRejected'),
}

/** What the panel and the gated button say, by what approval allows: issuing, sending or booking. */
export const APPROVAL_WORDS: Record<
  ApprovalDoc,
  { needed: string; neededNoSubmit: string; ready: string; waits: string; needs: string }
> = {
  invoices: {
    needed: translate('approvalNeededSubmit'),
    neededNoSubmit: translate('approvalNeededNoSubmit'),
    ready: translate('approvalReadyToIssue'),
    waits: translate('approvalIssueWaits'),
    needs: translate('approvalIssueNeedsApproval'),
  },
  quotes: {
    needed: translate('approvalNeededSubmitQuote'),
    neededNoSubmit: translate('approvalNeededNoSubmitQuote'),
    ready: translate('approvalReadyToSend'),
    waits: translate('approvalSendWaits'),
    needs: translate('approvalSendNeedsApproval'),
  },
  expenses: {
    needed: translate('approvalNeededSubmitExpense'),
    neededNoSubmit: translate('approvalNeededNoSubmitExpense'),
    ready: translate('approvalReadyToBook'),
    waits: translate('approvalBookWaits'),
    needs: translate('approvalBookNeedsApproval'),
  },
}

/** Runs one approval action with its toast; `onDone` after it succeeded. */
export function useRunApproval(target: ApprovalTarget) {
  const action = useApprovalAction()
  const run = (kind: ApprovalAction, comment?: string, onDone?: () => void) =>
    action.mutate(
      { target, action: kind, comment },
      {
        onSuccess: () => {
          toast.success(DONE[kind])
          onDone?.()
        },
        onError: toastError,
      },
    )
  return { run, pending: action.isPending }
}

/**
 * The drawer's main button while approval holds it back: "Submit for approval" for someone who may submit, else the
 * gated action (`children`), focusable but inert, its tooltip saying why.
 */
export function ApprovalGate({
  target,
  approval,
  children,
}: {
  target: ApprovalTarget
  approval: Approval | undefined
  children: ReactNode
}) {
  const submitting = useRunApproval(target)
  const words = APPROVAL_WORDS[target.doc]
  if (approval?.can_submit)
    return (
      <Button
        className="gap-1.5"
        disabled={submitting.pending}
        onClick={() => submitting.run('submit')}
      >
        <Send /> {translate('approvalSubmit')}
      </Button>
    )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Stays focusable while it cannot run, so its tooltip can say why. */}
        <Button aria-disabled className="cursor-not-allowed gap-1.5 opacity-50">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {approval?.state === 'pending' ? words.waits : words.needs}
      </TooltipContent>
    </Tooltip>
  )
}

/** The draft's approval in the drawer: its state, each rule's progress, the trail and what I may do. */
export function ApprovalPanel({
  target,
  approval,
}: {
  target: ApprovalTarget
  approval: Approval
}) {
  const { run, pending } = useRunApproval(target)
  const words = APPROVAL_WORDS[target.doc]
  const [rejecting, setRejecting] = useState(false)
  const rejection = approval.state === 'rejected' ? approval.trail.findLast(isRejection) : undefined
  return (
    // The state's badge is the drawer's, beside Draft.
    <Panel title={translate('approval')}>
      <section aria-label={translate('approval')} className="grid gap-3">
        {approval.state === 'none' && (
          <p className="text-body-sm text-pretty text-muted-foreground">
            {approval.can_submit ? words.needed : words.neededNoSubmit}
          </p>
        )}
        {approval.state === 'approved' && (
          <p className="text-body-sm text-pretty text-muted-foreground">{words.ready}</p>
        )}
        {approval.state === 'rejected' && (
          <Callout tone="danger" icon={MessageSquareWarning}>
            <span className="grid gap-0.5">
              <span className="font-medium">
                {rejection?.user
                  ? translate('approvalChangesRequestedBy', { name: rejection.user.name })
                  : translate('approvalChangesRequested')}
              </span>
              {approval.comment && (
                <span className="whitespace-pre-wrap" data-testid="approval-reason">
                  {approval.comment}
                </span>
              )}
              {approval.can_submit && (
                <span className="text-muted-foreground">
                  {translate('approvalEditAndResubmit')}
                </span>
              )}
            </span>
          </Callout>
        )}

        {approval.rules.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={translate('approvalRulesLabel')}>
            {approval.rules.map((rule) => {
              const done = rule.approved >= rule.min
              const name = rule.group_name ?? translate('approvalAnyoneShort')
              return (
                <li
                  // Each source appears once in a policy (see the settings' rule builder).
                  key={rule.group_id ?? 'anyone'}
                  data-testid="approval-progress"
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-body-sm ring-1 ring-inset',
                    done
                      ? 'bg-success-surface text-success ring-success/20'
                      : 'bg-muted/60 text-foreground ring-border',
                  )}
                >
                  {done ? <Check aria-hidden className="size-3.5" /> : null}
                  <span>{name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {translate('approvalProgress', {
                      approved: Math.min(rule.approved, rule.min),
                      min: rule.min,
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {approval.trail.length > 0 && (
          <ol
            className="grid gap-2 border-t border-border/60 pt-3"
            aria-label={translate('approvalTrail')}
          >
            {approval.trail.map((entry) => (
              <TrailRow key={`${entry.kind}-${entry.at}`} entry={entry} />
            ))}
          </ol>
        )}

        {(approval.can_decide || approval.can_withdraw) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {approval.can_decide && (
              <>
                <Button size="sm" disabled={pending} onClick={() => run('approve')}>
                  <Check />
                  {translate('approvalApprove')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setRejecting(true)}
                >
                  <X />
                  {translate('approvalReject')}
                </Button>
              </>
            )}
            {approval.can_withdraw && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                disabled={pending}
                onClick={() => run('withdraw')}
              >
                <Undo2 />
                {translate('approvalWithdraw')}
              </Button>
            )}
          </div>
        )}
      </section>
      {rejecting && <RejectDialog target={target} onClose={() => setRejecting(false)} />}
    </Panel>
  )
}

const isRejection = (entry: TrailEntry) => entry.kind === 'rejected'

const TRAIL: Record<TrailEntry['kind'], { icon: ReactNode; label: (name: string) => string }> = {
  submitted: {
    icon: <Send />,
    label: (name) => translate('approvalTrailSubmitted', { name }),
  },
  approved: {
    icon: <Check />,
    label: (name) => translate('approvalTrailApproved', { name }),
  },
  rejected: {
    icon: <X />,
    label: (name) => translate('approvalTrailRejected', { name }),
  },
  withdrawn: {
    icon: <Undo2 />,
    label: (name) => translate('approvalTrailWithdrawn', { name }),
  },
  reset: {
    icon: <RotateCcw />,
    label: () => translate('approvalTrailReset'),
  },
}

function TrailRow({ entry }: { entry: TrailEntry }) {
  const look = TRAIL[entry.kind]
  return (
    <li className="flex gap-2.5 text-body-sm">
      {entry.user ? (
        <UserAvatar name={entry.user.name} url={entry.user.avatar_url} className="mt-0.5 size-5" />
      ) : (
        <span
          aria-hidden
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3"
        >
          {look.icon}
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <span>
          {look.label(entry.user?.name ?? translate('approvalSomeone'))}
          <span className="text-muted-foreground"> · {formatDate(entry.at)}</span>
        </span>
        {entry.comment && (
          <span className="rounded-md bg-muted/60 px-2 py-1 whitespace-pre-wrap text-muted-foreground">
            {entry.comment}
          </span>
        )}
      </span>
    </li>
  )
}

/** Rejecting asks what needs to change: the author reads it on the draft. */
function RejectDialog({ target, onClose }: { target: ApprovalTarget; onClose: () => void }) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string>()
  const action = useApprovalAction()
  const submit = () => {
    if (!comment.trim()) return setError(translate('approvalSayWhatToChange'))
    action.mutate(
      { target, action: 'reject', comment: comment.trim() },
      {
        onSuccess: () => {
          toast.success(DONE.reject)
          onClose()
        },
        onError: (failure) => {
          const fields = fieldErrors(failure)
          if (fields.comment) setError(fields.comment)
          else toastError(failure)
        },
      },
    )
  }
  return (
    <FormDialog
      title={translate('approvalRejectTitle')}
      description={translate('approvalRejectDescription')}
      action={translate('approvalRejectConfirm')}
      pending={action.isPending}
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField
        id="approval-comment"
        label={translate('approvalWhatToChange')}
        required
        error={error}
      >
        <TextareaBox
          {...describedBy('approval-comment', error)}
          value={comment}
          max={1000}
          placeholder={translate('approvalWhatToChangePlaceholder')}
          onChange={(event) => {
            setComment(event.target.value)
            setError(undefined)
          }}
        />
      </FormField>
    </FormDialog>
  )
}
