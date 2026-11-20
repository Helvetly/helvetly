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
  SearchX,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { listTable } from '@/components/data/list-table'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { dropdownKit, PageContextMenu, type MenuKit } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
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
  searchQuotes,
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

/** The quotes list; the status view, the search (?q=), the open quote (?id=) and a new one (?new=1) live in the URL. */
export function QuotesPage() {
  const canWrite = useCan('write:invoices')
  const pathname = usePathname()
  const query = useSearchParams()
  const queryClient = useQueryClient()
  const raw = query.get('status')
  const status = isQuoteStatus(raw) ? raw : null
  const openId = query.get('id')
  const creating = query.get('new') === '1' && canWrite
  const term = query.get('q') ?? ''
  const [search, setSearch] = useState(term)
  const list = useQuotes({ status })
  const prefetch = usePrefetch(quoteQuery)
  // shortcut: the API returns every quote unpaged, so the search filters here; move it to the API with paging.
  const rows = searchQuotes(list.data ?? [], term)
  const active = VIEWS.findIndex((view) => view.status === status)
  const importDrawer = useImportDrawer()
  const aiLock = useFeatureLock('ai_import')
  const canImport = canWrite && !aiLock
  const dropping = useImportDrop('quotes', canImport && !creating && !openId)
  const items = ({ Item }: MenuKit) =>
    canWrite && (
      <ImportItem Item={Item} onSelect={importDrawer.open}>
        {translate('import')}
      </ImportItem>
    )

  const navigate = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(change))
      if (value === null) next.delete(key)
      else next.set(key, value)
    setUrlQuery(pathname, next)
  }
  const open = (id: string | null) => navigate({ id })
  const newQuote = () => navigate({ new: '1', client: null })

  // Search waits for a pause in typing, then goes to the URL.
  useEffect(() => {
    if (search === term) return
    const timer = setTimeout(() => navigate({ q: search || null }), 300)
    return () => clearTimeout(timer)
  })

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
        primaryMenu={
          canWrite && (
            <ImportItem Item={dropdownKit.Item} onSelect={importDrawer.open}>
              {translate('importQuotes')}
            </ImportItem>
          )
        }
      />
      {importDrawer.isOpen && <ImportDrawer kind="quotes" onClose={importDrawer.close} />}
      {dropping && <DropOverlay title={translate('dropToReadTheseFilesIntoQuotes')} />}
      <PageContextMenu
        title={translate('quotes')}
        primary={{ label: translate('newQuote2'), onSelect: newQuote }}
        items={items}
        views={{
          tabs: VIEWS.map((view) => view.label),
          active,
          onSelect: (index) => navigate({ status: VIEWS[index]?.status ?? null }),
        }}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['quotes'] })}
      >
        <div className="relative flex flex-1 flex-col">
          <ListToolbar>
            <ListSearch
              label={translate('searchQuotes')}
              placeholder={translate('searchNumberClientOrReference')}
              value={search}
              onChange={setSearch}
            />
          </ListToolbar>
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
            term ? (
              <State
                icon={<SearchX />}
                title={translate('nothingMatches', { search: term })}
                text={translate('tryAnotherSearchOrClearTheFilters')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      navigate({ q: null, status: null })
                    }}
                  >
                    {translate('clearSearchAndFilters')}
                  </Button>
                }
              />
            ) : status ? (
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
                    <EmptyImportActions
                      importLabel={translate('import')}
                      hint={translate('orDropFilesAnywhereOnThisPage')}
                      onImport={canImport ? importDrawer.open : undefined}
                    >
                      <Button size="sm" className="cursor-pointer" onClick={newQuote}>
                        {translate('newQuote2')}
                      </Button>
                    </EmptyImportActions>
                  )
                }
              />
            )
          ) : (
            <>
              <table className={cn(listTable.table, 'hidden @4xl:table')}>
                <thead>
                  <tr className={listTable.head}>
                    <th className={cn(listTable.th, 'w-[180px]')}>{translate('number')}</th>
                    <th className={listTable.th}>{translate('client')}</th>
                    <th className={cn(listTable.th, 'hidden w-[128px] @6xl:table-cell')}>
                      {translate('date')}
                    </th>
                    <th className={cn(listTable.th, 'w-[128px]')}>{translate('validUntil3')}</th>
                    <th className={cn(listTable.th, listTable.numeric, 'w-[17%]')}>
                      {translate('total')}
                    </th>
                    <th className={cn(listTable.th, 'w-[120px]')}>{translate('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((quote) => (
                    <tr
                      key={quote.id}
                      data-open={quote.id === openId || undefined}
                      onPointerEnter={() => prefetch(quote.id)}
                      onClick={() => open(quote.id)}
                      className={cn(listTable.row, 'cursor-pointer')}
                    >
                      <td className={cn(listTable.td, 'overflow-visible')}>
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
                            quote.number ? 'font-code' : 'text-muted-foreground',
                          )}
                        >
                          {quoteNumber(quote)}
                        </button>
                      </td>
                      <td className={listTable.td}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Initials name={quote.client.name} />
                          <span className="truncate">{quote.client.name}</span>
                        </span>
                      </td>
                      <td
                        className={cn(listTable.td, 'hidden text-muted-foreground @6xl:table-cell')}
                      >
                        {formatDay(quote.issue_date)}
                      </td>
                      <td
                        className={cn(
                          listTable.td,
                          quote.status !== 'sent' && 'text-muted-foreground',
                        )}
                      >
                        {formatDay(quote.valid_until)}
                      </td>
                      <td className={cn(listTable.td, listTable.numeric)}>
                        <Money value={quote.payable_total} currency={quote.currency} />
                      </td>
                      <td className={listTable.td}>
                        <QuoteStatusBadge status={quote.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className={cn(listTable.list, '@4xl:hidden')}>
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
            <span className={cn(quote.number && 'font-code')}>{quoteNumber(quote)}</span>
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
