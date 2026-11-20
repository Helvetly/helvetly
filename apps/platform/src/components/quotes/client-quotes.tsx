'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Plus, ScrollText } from 'lucide-react'
import { useState } from 'react'

import { Money } from '@/components/invoices/invoice-bits'
import { RecordLink, useOpenHref } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatDay } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { quoteNumber, useQuotes } from '@/lib/quotes'

import { QuoteStatusBadge } from './quote-bits'
import { NewQuoteSheet } from './quote-editor'

const quoteHref = (id: string) => `/quotes?id=${encodeURIComponent(id)}`

/** The client's quotes (GET /quotes?client_id=…), newest first; "New quote" opens the editor in place. */
export function ClientQuotes({ clientId }: { clientId: string }) {
  const list = useQuotes({ clientId })
  const canWrite = useCan('write:invoices')
  const [creating, setCreating] = useState(false)
  const openHref = useOpenHref()
  const rows = list.data ?? []

  const newButton = canWrite && (
    <Button size="sm" onClick={() => setCreating(true)}>
      <Plus />
      {translate('newQuote')}
    </Button>
  )
  const sheet = creating && (
    <NewQuoteSheet
      clientId={clientId}
      onClose={() => setCreating(false)}
      onSaved={(quote) => {
        setCreating(false)
        openHref(quoteHref(quote.id))
      }}
    />
  )

  if (list.error)
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        {errorMessage(list.error)}
      </p>
    )
  if (!list.data) return <Loader className="min-h-72" />
  if (rows.length === 0)
    return (
      <div className="grid justify-items-center gap-2 rounded-xl bg-card px-6 py-12 text-center shadow-elevation-1">
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ScrollText className="size-5 stroke-[1.5]" />
        </span>
        <p className="text-title-sm font-medium">{translate('noQuotesYet')}</p>
        <p className="max-w-xs text-body-sm text-pretty text-muted-foreground">
          {translate('quotesYouOfferThisClientShowUpHereWith')}
        </p>
        {newButton && <div className="mt-2">{newButton}</div>}
        {sheet}
      </div>
    )

  return (
    <div className="grid gap-3">
      {newButton && <div className="flex justify-end">{newButton}</div>}
      <section aria-label={translate('quotes')} className="rounded-xl bg-card shadow-elevation-1">
        <ul className="divide-y divide-border/60">
          {rows.map((quote) => (
            <li key={quote.id}>
              <RecordLink
                href={quoteHref(quote.id)}
                className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40"
              >
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className={quote.number ? 'font-code' : 'text-body'}>
                    {quoteNumber(quote)}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {formatDay(quote.issue_date)}
                    {translate('validUntil')}
                    {formatDay(quote.valid_until)}
                  </span>
                </span>
                <Money
                  value={quote.payable_total}
                  currency={quote.currency}
                  className="text-body"
                />
                <span className="w-[84px] text-right">
                  <QuoteStatusBadge status={quote.status} />
                </span>
              </RecordLink>
            </li>
          ))}
        </ul>
      </section>
      {sheet}
    </div>
  )
}
