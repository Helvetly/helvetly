'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Label } from '@helvetly/ui/components/label'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Textarea } from '@helvetly/ui/components/textarea'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, CircleCheck, LoaderCircle, UserPen, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Initials } from '@/components/initials'
import {
  ADDRESS_FIELDS,
  approveChangeRequest,
  clientKeys,
  rejectChangeRequest,
  useChangeRequest,
  type ChangeRequest,
  type Client,
} from '@/lib/clients'

import { addressLines } from './client-bits'
import { countryName } from './client-form-model'

const LABELS: Record<string, string> = {
  name: 'Name',
  billing_email: 'Billing email',
  phone: 'Phone',
  vat_number: 'VAT number',
  registration_number: 'Registration no.',
}
const ADDRESS = new Set<string>(ADDRESS_FIELDS)
const MAX_REASON = 500

/** `key` is what approve takes: the field, or `address` for the whole address. */
type Row = { key: string; label: string; current: string[]; requested: string[] }
type Decision = { approve: true; fields: string[] } | { approve: false; reason: string }

const addressBlock = (client: Client) => [
  ...addressLines(client),
  ...(client.country ? [countryName(client.country)] : []),
]

/** One row per changed field; any address field becomes one "Address" row with the full block. */
export function changeRows(client: Client, request: ChangeRequest): Row[] {
  const fields = Object.entries(request.fields)
  const rows: Row[] = fields
    .filter(([field]) => !ADDRESS.has(field))
    .map(([field, value]) => {
      const current = request.current[field]
      return {
        key: field,
        label: LABELS[field] ?? field.replaceAll('_', ' '),
        current: current ? [current] : [],
        requested: value ? [value] : [],
      }
    })
  if (fields.some(([field]) => ADDRESS.has(field))) {
    rows.push({
      key: 'address',
      label: 'Address',
      current: addressBlock(client),
      requested: addressBlock({ ...client, ...request.fields }),
    })
  }
  return rows
}

type Decided = 'approved' | 'partly' | 'rejected'

/**
 * A one-line notice under the client drawer's tabs, on every tab, that the client asked for changes
 * in the portal; "Review" opens the review drawer over it.
 */
export function ChangeRequestBanner({
  client,
  canDecide,
  reviewing,
  onReviewingChange,
}: {
  client: Client
  canDecide: boolean
  reviewing: boolean
  onReviewingChange: (reviewing: boolean) => void
}) {
  const { data: request } = useChangeRequest(client.id)
  const [decided, setDecided] = useState<Decided | null>(null)

  if (decided) {
    return (
      <output className="block px-4 pt-4 sm:px-5 sm:pt-5">
        <Callout
          tone={decided === 'rejected' ? 'neutral' : 'success'}
          icon={decided === 'rejected' ? X : CircleCheck}
          title={decided === 'rejected' ? 'Request rejected' : 'Changes applied'}
          actions={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Dismiss"
              onClick={() => setDecided(null)}
            >
              <X />
            </Button>
          }
        >
          {
            {
              approved: 'The client’s details now show the requested values.',
              partly:
                'The client’s details now show the chosen values; the other changes were discarded.',
              rejected: 'The client’s details stay as they were.',
            }[decided]
          }
        </Callout>
      </output>
    )
  }
  if (!request) return null

  const count = changeRows(client, request).length
  return (
    <section aria-label="Change request" className="px-4 pt-4 sm:px-5 sm:pt-5">
      <Callout
        tone="info"
        icon={UserPen}
        actions={
          <Button size="sm" variant="outline" onClick={() => onReviewingChange(true)}>
            Review
          </Button>
        }
      >
        <span className="font-medium">{requesterOf(client, request)}</span> asked to change {count}{' '}
        {count === 1 ? 'field' : 'fields'}{' '}
        <span className="whitespace-nowrap text-muted-foreground">
          · <time dateTime={request.created_at}>{formatRelative(request.created_at)}</time>
        </span>
      </Callout>
      {reviewing && (
        <ChangeRequestReview
          client={client}
          request={request}
          canDecide={canDecide}
          onClose={() => onReviewingChange(false)}
          onDecided={(result) => {
            onReviewingChange(false)
            setDecided(result)
          }}
        />
      )}
    </section>
  )
}

const requesterOf = (client: Client, request: ChangeRequest) => request.contact.name || client.name

/** The full request in a drawer stacked over the client's: each change with its own checkbox, approve or reject. */
function ChangeRequestReview({
  client,
  request,
  canDecide,
  onClose,
  onDecided,
}: {
  client: Client
  request: ChangeRequest
  canDecide: boolean
  onClose: () => void
  onDecided: (decided: Decided) => void
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const decide = useMutation({
    mutationFn: async (decision: Decision) => {
      if (decision.approve) await approveChangeRequest(client.id, decision.fields)
      else await rejectChangeRequest(client.id, decision.reason.trim())
    },
    onSuccess: (_, decision) => {
      toast.success(decision.approve ? 'Changes applied.' : 'Request rejected.')
      queryClient.setQueryData(clientKeys.changeRequest(client.id), null)
      void queryClient.invalidateQueries({ queryKey: clientKeys.detail(client.id) })
      void queryClient.invalidateQueries({ queryKey: ['clients', 'list'] })
      onDecided(!decision.approve ? 'rejected' : skipped.size > 0 ? 'partly' : 'approved')
    },
    onError: toastError,
  })

  const requester = requesterOf(client, request)
  const rows = changeRows(client, request)
  const chosen = rows.filter((row) => !skipped.has(row.key)).map((row) => row.key)
  const pending = decide.isPending ? decide.variables.approve : undefined
  const toggle = (key: string, apply: boolean) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (apply) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Sheet open onOpenChange={(open) => !open && !decide.isPending && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 bg-card p-0 sm:w-[min(560px,100vw)]!"
      >
        <header className="flex items-center gap-3 border-b border-border/60 bg-info-surface px-4 py-3 sm:px-5">
          <Initials name={requester} className="size-9 text-caption" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <SheetTitle className="text-body font-medium">
              Profile change requested by the client
            </SheetTitle>
            <SheetDescription className="text-body-sm text-pretty text-muted-foreground">
              {requester} via client portal{' '}
              <span className="whitespace-nowrap">
                · <time dateTime={request.created_at}>{formatRelative(request.created_at)}</time>
              </span>
            </SheetDescription>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close"
            disabled={decide.isPending}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <dl className="divide-y divide-border/60 px-4 sm:px-5">
            {rows.map((row) => (
              <div
                key={row.key}
                className="grid gap-1 py-3 text-body @xl:grid-cols-[8.5rem_minmax(0,1fr)] @xl:gap-4"
              >
                <dt className="flex items-center gap-2.5 self-start text-body-sm text-muted-foreground @xl:pt-0.5">
                  {canDecide && (
                    <Checkbox
                      aria-label={`Apply ${row.label.toLowerCase()}`}
                      checked={!skipped.has(row.key)}
                      disabled={decide.isPending}
                      onCheckedChange={(checked) => toggle(row.key, checked === true)}
                    />
                  )}
                  {row.label}
                </dt>
                <dd className="grid items-start gap-1 @md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @md:gap-2">
                  <Lines
                    lines={row.current}
                    empty="Not set"
                    as="del"
                    className="text-muted-foreground decoration-muted-foreground/60"
                  />
                  <ArrowRight
                    aria-hidden
                    className="mt-0.5 hidden size-4 text-muted-foreground @md:block"
                  />
                  <Lines
                    lines={row.requested}
                    empty="Removed"
                    as="ins"
                    className={cn(
                      'max-w-full justify-self-start rounded-md px-1.5 no-underline',
                      skipped.has(row.key)
                        ? 'text-muted-foreground'
                        : 'bg-info-surface font-medium text-foreground',
                    )}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
          {canDecide ? (
            <>
              <Button
                disabled={decide.isPending || chosen.length === 0}
                onClick={() => decide.mutate({ approve: true, fields: chosen })}
              >
                {pending === true ? <LoaderCircle className="animate-spin" /> : <Check />}
                Approve {chosen.length} {chosen.length === 1 ? 'change' : 'changes'}
              </Button>
              <Button
                variant="destructive-ghost"
                disabled={decide.isPending}
                onClick={() => setConfirming(true)}
              >
                {pending === false ? <LoaderCircle className="animate-spin" /> : <X />}
                Reject
              </Button>
              <p className="text-caption text-muted-foreground sm:ml-auto">
                {rows.length > 1 ? 'Unchecked changes are discarded.' : 'Applied as shown.'}
              </p>
            </>
          ) : (
            <p className="text-body-sm text-muted-foreground">
              An owner or admin can approve or reject this request.
            </p>
          )}
        </footer>
        {confirming && (
          <ConfirmDialog
            title="Reject the requested changes?"
            body={`${client.name}’s details stay as they are. The client sees the rejection in the portal and can send a new request.`}
            confirmLabel="Reject"
            confirmIcon={<X />}
            tone="destructive"
            onDecide={(approved) => {
              setConfirming(false)
              if (approved) decide.mutate({ approve: false, reason })
            }}
          >
            <div className="mt-4 grid gap-1.5 text-left">
              <Label htmlFor="change-request-reason">Reason for the client (optional)</Label>
              <Textarea
                id="change-request-reason"
                value={reason}
                maxLength={MAX_REASON}
                placeholder="For example: the VAT number belongs to another company."
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </ConfirmDialog>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** The current or requested value, one line per address line; an empty value is said in words. */
function Lines({
  lines,
  empty,
  as: Tag,
  className,
}: {
  lines: string[]
  empty: string
  as: 'del' | 'ins'
  className: string
}) {
  const label = Tag === 'del' ? 'Current: ' : 'Requested: '
  if (!lines.length)
    return (
      <span className="text-muted-foreground">
        <span className="sr-only">{label}</span>
        {empty}
      </span>
    )
  return (
    <Tag className={cn('block min-w-0', className)}>
      <span className="sr-only">{label}</span>
      {lines.map((line) => (
        <span key={line} className="block break-words">
          {line}
        </span>
      ))}
    </Tag>
  )
}
