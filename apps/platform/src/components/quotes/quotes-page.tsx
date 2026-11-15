'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  CircleCheck,
  CircleSlash,
  CloudOff,
  FilePen,
  FilePlus2,
  Files,
  Hourglass,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'

import { PageContextMenu } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { Initials } from '@/components/initials'
import { Money } from '@/components/invoices/invoice-bits'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatDay } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { usePrefetch } from '@/lib/queries'
import {
  isQuoteStatus,
  QUOTE_STATUSES,
  quoteNumber,
  quoteQuery,
  useQuotes,
  type Quote,
  type QuoteStatus,
} from '@/lib/quotes'
import { setUrlQuery } from '@/lib/url-query'

import { QuoteStatusBadge } from './quote-bits'
import { QuoteDetail } from './quote-detail'
import { NewQuoteSheet } from './quote-editor'

const STATUS_ICONS: Record<QuoteStatus, LucideIcon> = {
  draft: FilePen,
  sent: Send,
  accepted: CircleCheck,
  declined: CircleSlash,
  expired: Hourglass,
}

const VIEWS: { status: QuoteStatus | null; label: string; icon: LucideIcon }[] = [
  { status: null, label: translate('allQuotes'), icon: Files },
  ...QUOTE_STATUSES.map((entry) => ({
    status: entry.value,
    label: entry.plural,
    icon: STATUS_ICONS[entry.value],
  })),
]

/** The quotes list; the status view, the open quote (?id=) and a new one (?new=1) live in the URL. */
export function QuotesPage() {
  const canWrite = useCan('write:invoices')
  const pathname = usePathname()
  const query = useSearchParams()
  const queryClient = useQueryClient()
  const raw = query.get('status')
  const status = isQuoteStatus(raw) ? raw : null
  const openId = query.get('id')
  const creating = query.get('new') === '1' && canWrite
  const list = useQuotes({ status })
  const prefetch = usePrefetch(quoteQuery)
  const rows = list.data ?? []
  const active = VIEWS.findIndex((view) => view.status === status)

  const navigate = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(change))
      if (value === null) next.delete(key)
      else next.set(key, value)
    setUrlQuery(pathname, next)
  }
  const open = (id: string | null) => navigate({ id })
  const newQuote = () => navigate({ new: '1', client: null })

  return (
    <>
      <PageHeader
        tabs={VIEWS.map((view) => view.label)}
        tabIcons={VIEWS.map((view) => view.icon)}
        savedViews={false}
        active={active}
        onSelect={(index) => navigate({ status: VIEWS[index]?.status ?? null })}
        primary={translate('newQuote2')}
        onPrimary={newQuote}
      />
      <PageContextMenu
        title={translate('quotes')}
        primary={{ label: translate('newQuote2'), onSelect: newQuote }}
        views={{
          tabs: VIEWS.map((view) => view.label),
          active,
          onSelect: (index) => navigate({ status: VIEWS[index]?.status ?? null }),
        }}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['quotes'] })}
      >
        <div className="relative flex flex-1 flex-col">
          {list.error ? (
            <State
              icon={<CloudOff />}
              title={translate('couldnTLoadQuotes')}
              text={errorMessage(list.error)}
              action={
                <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                  {translate('tryAgain')}
                </Button>
              }
            />
          ) : !list.data ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            status ? (
              <State
                icon={<Files />}
                title={translate('nothingInThisView')}
                text={translate('quotesShowUpHereAsTheirStatusChanges')}
                action={
                  <Button variant="outline" size="sm" onClick={() => navigate({ status: null })}>
                    {translate('showAllQuotes')}
                  </Button>
                }
              />
            ) : (
              <State
                icon={<FilePlus2 />}
                title={translate('noQuotesYet')}
                text={translate('offerYourWorkBeforeYouInvoiceItTheClient')}
                action={
                  canWrite && (
                    <Button size="sm" onClick={newQuote}>
                      {translate('newQuote2')}
                    </Button>
                  )
                }
              />
            )
          ) : (
            <>
              <table className="hidden w-full table-fixed text-title-sm @4xl:table">
                <thead>
                  <tr className="h-11 border-b bg-muted/50 text-left text-xs tracking-[0.04em] text-muted-foreground uppercase">
                    <th className="w-[180px] pl-5 font-medium">{translate('number')}</th>
                    <th className="px-3 font-medium">{translate('client')}</th>
                    <th className="hidden w-[128px] px-3 font-medium @6xl:table-cell">
                      {translate('date')}
                    </th>
                    <th className="w-[128px] px-3 font-medium">{translate('validUntil3')}</th>
                    <th className="w-[17%] px-3 text-right font-medium">{translate('total')}</th>
                    <th className="w-[120px] px-3 pr-5 font-medium">{translate('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((quote) => (
                    <tr
                      key={quote.id}
                      data-open={quote.id === openId || undefined}
                      onPointerEnter={() => prefetch(quote.id)}
                      onClick={() => open(quote.id)}
                      className="h-[58px] cursor-pointer border-b border-border/50 transition-colors duration-150 last:border-0 hover:bg-muted/40 data-open:bg-muted/50"
                    >
                      <td className="pl-5">
                        {/* The row opens on click; the button makes it reachable by keyboard. It truncates
                            itself, so the cell does not clip its focus ring. */}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            open(quote.id)
                          }}
                          className={cn(
                            'max-w-full truncate rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                            !quote.number && 'text-muted-foreground',
                          )}
                        >
                          {quoteNumber(quote)}
                        </button>
                      </td>
                      <td className="truncate px-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Initials name={quote.client.name} />
                          <span className="truncate">{quote.client.name}</span>
                        </span>
                      </td>
                      <td className="hidden px-3 text-muted-foreground @6xl:table-cell">
                        {formatDay(quote.issue_date)}
                      </td>
                      <td
                        className={cn('px-3', quote.status !== 'sent' && 'text-muted-foreground')}
                      >
                        {formatDay(quote.valid_until)}
                      </td>
                      <td className="px-3 text-right">
                        <Money value={quote.payable_total} currency={quote.currency} />
                      </td>
                      <td className="px-3 pr-5">
                        <QuoteStatusBadge status={quote.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-border/70 @4xl:hidden">
                {rows.map((quote) => (
                  <QuoteItem key={quote.id} quote={quote} onOpen={open} />
                ))}
              </ul>
            </>
          )}
        </div>
      </PageContextMenu>

      {openId && <QuoteDetail key={openId} id={openId} onClose={() => open(null)} />}
      {creating && (
        <NewQuoteSheet
          clientId={query.get('client')}
          onClose={() => navigate({ new: null, client: null })}
          onSaved={(quote) => navigate({ new: null, client: null, id: quote.id })}
        />
      )}
    </>
  )
}

function QuoteItem({ quote, onOpen }: { quote: Quote; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(quote.id)}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="grid min-w-0 flex-1 leading-snug">
          <span className="truncate text-title-sm">{quote.client.name}</span>
          <span className="truncate text-body-sm text-muted-foreground">
            {quoteNumber(quote)}
            {translate('validUntil')}
            {formatDay(quote.valid_until)}
          </span>
        </span>
        <span className="grid justify-items-end gap-1">
          <Money value={quote.payable_total} currency={quote.currency} className="text-body" />
          <QuoteStatusBadge status={quote.status} />
        </span>
      </button>
    </li>
  )
}
