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
import { InlineError } from '@helvetly/ui/components/inline-error'
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

import { translate } from '@/lib/i18n'
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
  sent: ['blue', translate('awaitingYourAnswer')],
  accepted: ['green', translate('accepted2')],
  declined: ['red', translate('declined2')],
  expired: ['gray', translate('expired')],
}

export function QuoteStatus({ quote }: { quote: PortalQuote }) {
  const [tone, label] = STATUS[quote.status]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

/** What the quote's state means for the client, in one line. */
function stateText(quote: PortalQuote) {
  if (quote.status === 'sent')
    return translate('validUntil2', { value1: formatDate(quote.valid_until) })
  if (quote.status === 'expired') return translate('expiredAskForANewQuote')
  const verb = quote.status === 'accepted' ? translate('accepted2') : translate('declined2')
  return quote.decided_at
    ? translate('dynamicOn2', { verb: verb, value2: formatDate(quote.decided_at) })
    : verb
}

export const QuotePdfLink = ({ quote }: { quote: PortalQuote }) => (
  <DownloadLink
    href={portalQuotePdfUrl(quote.id)}
    label={translate('downloadPDFOfQuote', { value1: quoteName(quote) })}
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
  const supplier = session.data?.workspace.name ?? translate('yourSupplier')
  const accept = decision === 'accept'
  const name = quoteName(quote)

  const decide = useMutation({
    mutationFn: () => decidePortalQuote(quote.id, decision, note),
    onSuccess: (answered) => {
      queryClient.setQueryData<PortalQuote[]>(portalKeys.quotes, (list) =>
        list?.map((q) => (q.id === answered.id ? answered : q)),
      )
      toast.success(
        translate('quoteHasBeenTold', {
          name: name,
          value2: accept ? translate('accepted') : translate('declined'),
          supplier: supplier,
        }),
      )
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
                ? translate('acceptQuoteFor', {
                    name: name,
                    value2: formatMoney(quote.total, quote.currency),
                  })
                : translate('declineQuote3', { name: name })}
            </DialogTitle>
            <DialogDescription>
              {accept
                ? translate('isToldRightAwayAndCanStartTheWork', { supplier: supplier })
                : translate('isToldRightAwayAShortNoteOnWhy', { supplier: supplier })}
            </DialogDescription>
          </DialogHeader>
          <FormField
            id="quote-note"
            label={translate('noteOptional')}
            hint={translate('upToCharacters', { NOTE_MAX: NOTE_MAX })}
          >
            <Textarea
              id="quote-note"
              value={note}
              maxLength={NOTE_MAX}
              disabled={decide.isPending}
              placeholder={
                accept ? translate('eGPleaseStartOn1December') : translate('eGTheBudgetChanged')
              }
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={decide.isPending}>
              {translate('cancel')}
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
                  ? translate('accepting')
                  : translate('declining')
                : accept
                  ? translate('acceptQuote2')
                  : translate('declineQuote2')}
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
          {translate('yourNote')}
          {quote.decision_note}”
        </p>
      )}
      {isAwaiting(quote) && (
        <div className="flex gap-2 sm:pl-12">
          <Button
            aria-label={translate('acceptQuote', { value1: quoteName(quote) })}
            onClick={() => onAsk({ quote, decision: 'accept' })}
          >
            <Check aria-hidden />
            {translate('accept')}
          </Button>
          <Button
            variant="outline"
            aria-label={translate('declineQuote', { value1: quoteName(quote) })}
            onClick={() => onAsk({ quote, decision: 'decline' })}
          >
            <X aria-hidden />
            {translate('decline')}
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
    if (query.isPending) return <Loader label={translate('loadingQuotes')} className="min-h-72" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-5')}>
          <RetryAlert what={translate('yourQuotes')} onRetry={() => void query.refetch()} />
        </div>
      )
    if (query.data.length === 0)
      return (
        <div className={cardClass}>
          <EmptyState icon={FilePenLine} title={translate('noQuotesYet')}>
            {translate('quotesAppearHereAsSoonAsTheyAreSent')}
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
      <PageHeader title={translate('quotes')}>
        {translate('everyQuoteSentToYouEachWithItsPDF')}
      </PageHeader>
      {body()}
      {asking && (
        <DecisionDialog key={asking.quote.id} {...asking} onClose={() => setAsking(null)} />
      )}
    </div>
  )
}
