'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
import { Textarea } from '@helvetly/ui/components/textarea'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { ApiError, errorMessage } from '@helvetly/ui/lib/http'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FilePenLine, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { getPortalSession, portalKeys } from '@/lib/portal'
import {
  decidePortalQuote,
  isAwaiting,
  listPortalQuotes,
  NOTE_MAX,
  portalQuotePdfUrl,
  quoteName,
  type PortalQuote,
  type QuoteDecision,
} from '@/lib/quotes'

import { cardClass, DownloadLink, EmptyState, PageHeader, RetryAlert } from './portal-bits'

const STATUS: Record<PortalQuote['status'], [Tone, string]> = {
  sent: ['blue', 'Awaiting your answer'],
  accepted: ['green', 'Accepted'],
  declined: ['red', 'Declined'],
  expired: ['gray', 'Expired'],
}

export function QuoteStatus({ quote }: { quote: PortalQuote }) {
  const [tone, label] = STATUS[quote.status]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

/** What the quote's state means for the client, in one line. */
function stateText(quote: PortalQuote) {
  if (quote.status === 'sent') return `Valid until ${formatDate(quote.valid_until)}`
  if (quote.status === 'expired') return 'Expired – ask for a new quote'
  const verb = quote.status === 'accepted' ? 'Accepted' : 'Declined'
  return quote.decided_at ? `${verb} on ${formatDate(quote.decided_at)}` : verb
}

export const QuotePdfLink = ({ quote }: { quote: PortalQuote }) => (
  <DownloadLink
    href={portalQuotePdfUrl(quote.id)}
    label={`Download PDF of quote ${quoteName(quote)}`}
    text="PDF"
  />
)

type Asking = { quote: PortalQuote; decision: QuoteDecision }

function DecisionDialog({ quote, decision, onClose }: Asking & { onClose: () => void }) {
  const queryClient = useQueryClient()
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const supplier = session.data?.workspace.name ?? 'Your supplier'
  const accept = decision === 'accept'
  const name = quoteName(quote)

  const decide = useMutation({
    mutationFn: () => decidePortalQuote(quote.id, decision, note),
    onSuccess: (answered) => {
      queryClient.setQueryData<PortalQuote[]>(portalKeys.quotes, (list) =>
        list?.map((q) => (q.id === answered.id ? answered : q)),
      )
      toast.success(`Quote ${name} ${accept ? 'accepted' : 'declined'}. ${supplier} has been told.`)
      onClose()
    },
    onError: (failure) => {
      setError(errorMessage(failure))
      // Expired or answered elsewhere: show the quote as it is now.
      if (failure instanceof ApiError && failure.status === 409)
        void queryClient.invalidateQueries({ queryKey: portalKeys.quotes })
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && !decide.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            decide.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {accept
                ? `Accept quote ${name} for ${formatMoney(quote.total, quote.currency)}?`
                : `Decline quote ${name}?`}
            </DialogTitle>
            <DialogDescription>
              {accept
                ? `${supplier} is told right away and can start the work. You can’t change your answer here afterwards.`
                : `${supplier} is told right away. A short note on why helps them send a better quote.`}
            </DialogDescription>
          </DialogHeader>
          <FormField id="quote-note" label="Note (optional)" hint={`Up to ${NOTE_MAX} characters.`}>
            <Textarea
              id="quote-note"
              value={note}
              maxLength={NOTE_MAX}
              disabled={decide.isPending}
              placeholder={accept ? 'e.g. Please start on 1 December.' : 'e.g. The budget changed.'}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={accept ? 'default' : 'destructive'}
              disabled={decide.isPending}
            >
              {decide.isPending ? (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : accept ? (
                <Check aria-hidden />
              ) : (
                <X aria-hidden />
              )}
              {decide.isPending
                ? accept
                  ? 'Accepting…'
                  : 'Declining…'
                : accept
                  ? 'Accept quote'
                  : 'Decline quote'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QuoteRow({ quote, onAsk }: { quote: PortalQuote; onAsk: (asking: Asking) => void }) {
  return (
    <li className="grid gap-2.5 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground max-sm:hidden">
          <FilePenLine className="size-[18px]" aria-hidden />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body font-medium">{quoteName(quote)}</span>
            <span className="max-sm:hidden">
              <QuoteStatus quote={quote} />
            </span>
          </span>
          <span className="truncate text-body-sm text-muted-foreground">{stateText(quote)}</span>
        </span>
        <span className="shrink-0 text-right text-body font-medium tabular-nums">
          {formatMoney(quote.total, quote.currency)}
        </span>
        <QuotePdfLink quote={quote} />
      </div>
      {quote.decision_note && (
        <p className="text-body-sm break-words text-muted-foreground sm:pl-12">
          Your note: “{quote.decision_note}”
        </p>
      )}
      {isAwaiting(quote) && (
        <div className="flex gap-2 sm:pl-12">
          <Button
            aria-label={`Accept quote ${quoteName(quote)}`}
            onClick={() => onAsk({ quote, decision: 'accept' })}
          >
            <Check aria-hidden /> Accept
          </Button>
          <Button
            variant="outline"
            aria-label={`Decline quote ${quoteName(quote)}`}
            onClick={() => onAsk({ quote, decision: 'decline' })}
          >
            <X aria-hidden /> Decline
          </Button>
        </div>
      )}
    </li>
  )
}

export function PortalQuotes() {
  const [asking, setAsking] = useState<Asking | null>(null)
  const query = useQuery({ queryKey: portalKeys.quotes, queryFn: listPortalQuotes })

  const body = () => {
    if (query.isPending) return <Loader label="Loading quotes" className="min-h-72" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-5')}>
          <RetryAlert what="Your quotes" onRetry={() => void query.refetch()} />
        </div>
      )
    if (query.data.length === 0)
      return (
        <div className={cardClass}>
          <EmptyState icon={FilePenLine} title="No quotes yet">
            Quotes appear here as soon as they are sent to you.
          </EmptyState>
        </div>
      )
    return (
      <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
        {query.data.map((quote) => (
          <QuoteRow key={quote.id} quote={quote} onAsk={setAsking} />
        ))}
      </ul>
    )
  }

  return (
    <div className="grid gap-5 sm:gap-6">
      <PageHeader title="Quotes">
        Every quote sent to you, each with its PDF. Accept or decline it here.
      </PageHeader>
      {body()}
      {asking && (
        <DecisionDialog key={asking.quote.id} {...asking} onClose={() => setAsking(null)} />
      )}
    </div>
  )
}
