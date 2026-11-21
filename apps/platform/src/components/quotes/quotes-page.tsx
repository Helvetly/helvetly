'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  CircleCheck,
  CircleSlash,
  CloudOff,
  Copy,
  FileDown,
  FilePen,
  FilePlus2,
  Files,
  Hourglass,
  SearchX,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { listTable } from '@/components/data/list-table'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import {
  dropdownKit,
  PageContextMenu,
  RowContextMenu,
  RowMenuButton,
  type MenuKit,
  type RowMenuSpec,
} from '@/components/data/menus'
import {
  ColumnResizer,
  ResizableTable,
  useResizableColumns,
} from '@/components/data/resizable-columns'
import { ariaSort, SortButton } from '@/components/data/sort-header'
import { BulkBar, LoadingRows, State, type BulkAction } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { Initials } from '@/components/initials'
import { Money } from '@/components/invoices/invoice-bits'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatDay } from '@/lib/invoices'
import { nextSort, parseSort, sortParam } from '@/lib/list-sort'
import { useCan } from '@/lib/permissions'
import { usePrefetch } from '@/lib/queries'
import {
  bulkTargets,
  DEFAULT_QUOTE_SORT,
  isQuoteStatus,
  QUOTE_SORT_FIELDS,
  QUOTE_STATUSES,
  quoteErrorMessage,
  quoteNumber,
  quotePdfUrl,
  quoteQuery,
  quotesApi,
  searchQuotes,
  sortQuotes,
  useQuotes,
  type Quote,
  type QuoteCommand,
  type QuoteSortField,
  type QuoteStatus,
} from '@/lib/quotes'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

import { QuoteStatusBadge } from './quote-bits'
import { QuoteMenuItems, useQuoteCommands } from './quote-commands'
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

type ColumnDef = {
  id: QuoteSortField
  label: string
  /** Leave it off the client column: that one takes the spare width (see `listTable`). */
  width?: string
  align?: 'right'
  /** Only from a wide panel (≥72rem), where there is room. */
  wide?: boolean
  cell: (quote: Quote, open: (id: string) => void) => ReactNode
  /** The cell shows what overflows it (a focus ring). */
  overflow?: boolean
}

const COLUMNS: ColumnDef[] = [
  {
    id: 'number',
    label: translate('number'),
    width: 'w-[180px]',
    // The row opens on click; the button makes it reachable by keyboard. It truncates itself, so
    // the cell does not clip its focus ring.
    cell: (quote, open) => (
      <button
        type="button"
        onClick={() => open(quote.id)}
        className={cn(
          'max-w-full truncate rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          quote.number ? 'font-code' : 'text-muted-foreground',
        )}
      >
        {quoteNumber(quote)}
      </button>
    ),
    overflow: true,
  },
  {
    id: 'client',
    label: translate('client'),
    cell: (quote) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <Initials name={quote.client.name} />
        <span className="truncate">{quote.client.name}</span>
      </span>
    ),
  },
  {
    id: 'date',
    label: translate('date'),
    width: 'w-[128px]',
    wide: true,
    cell: (quote) => <span className="text-muted-foreground">{formatDay(quote.issue_date)}</span>,
  },
  {
    id: 'valid',
    label: translate('validUntil3'),
    width: 'w-[128px]',
    cell: (quote) => (
      <span className={cn(quote.status !== 'sent' && 'text-muted-foreground')}>
        {formatDay(quote.valid_until)}
      </span>
    ),
  },
  {
    id: 'total',
    label: translate('total'),
    width: 'w-[17%]',
    align: 'right',
    cell: (quote) => <Money value={quote.payable_total} currency={quote.currency} />,
  },
  {
    id: 'status',
    label: translate('status'),
    width: 'w-[120px]',
    cell: (quote) => <QuoteStatusBadge status={quote.status} />,
  },
]

/** Status keeps its width: badges are short and the same everywhere. */
const RESIZABLE = ['number', 'client', 'date', 'valid', 'total']
/** Dates and amounts start with the latest or largest; text from A. */
const DESC_FIRST = new Set<QuoteSortField>(['date', 'valid', 'total'])

/** What a bulk action does to one quote; `confirm` ones ask first. */
type BulkKind = 'markSent' | 'accept' | 'decline' | 'remove'

const BULK_RUN: Record<BulkKind | 'duplicate', (id: string) => Promise<unknown>> = {
  markSent: (id) => quotesApi.send(id, { email: false }),
  accept: (id) => quotesApi.accept(id),
  decline: (id) => quotesApi.decline(id),
  remove: (id) => quotesApi.remove(id),
  duplicate: (id) => quotesApi.duplicate(id),
}

/** The question before a bulk change of `count` quotes. */
const CONFIRM: Record<
  BulkKind,
  (count: number) => { title: string; body: string; confirm: string }
> = {
  markSent: (count) => ({
    title: translate('quotesConfirmMarkSent', { count }),
    body: translate('quotesConfirmMarkSentBody'),
    confirm: translate('markAsSent'),
  }),
  accept: (count) => ({
    title: translate('quotesConfirmAccept', { count }),
    body: translate('quotesConfirmAcceptBody'),
    confirm: translate('markAccepted'),
  }),
  decline: (count) => ({
    title: translate('quotesConfirmDecline', { count }),
    body: translate('quotesConfirmDeclineBody'),
    confirm: translate('markDeclined'),
  }),
  remove: (count) => ({
    title: translate('quotesConfirmDelete', { count }),
    body: translate('quotesConfirmDeleteBody'),
    confirm: translate('quotesBulkDelete', { count }),
  }),
}

/**
 * The bulk bar's buttons for the selected quotes: the PDFs and copies of all of them, and each status
 * change only when some of them allow it, its count in the label.
 */
export function bulkActions(
  selected: Quote[],
  run: { downloadPdfs: () => void; duplicate: () => void; ask: (kind: BulkKind) => void },
): BulkAction[] {
  const targets = bulkTargets(selected)
  const change = (kind: BulkKind, label: string, icon: ReactNode): BulkAction[] =>
    targets[kind].length > 0
      ? [
          {
            label,
            icon,
            onClick: () => run.ask(kind),
            write: true,
            destructive: kind === 'remove',
          },
        ]
      : []
  return [
    { label: translate('downloadPDFs'), icon: <FileDown />, onClick: run.downloadPdfs },
    ...change(
      'markSent',
      translate('quotesBulkMarkSent', { count: targets.markSent.length }),
      <Send />,
    ),
    ...change(
      'accept',
      translate('quotesBulkAccept', { count: targets.accept.length }),
      <CircleCheck />,
    ),
    ...change(
      'decline',
      translate('quotesBulkDecline', { count: targets.decline.length }),
      <CircleSlash />,
    ),
    { label: translate('duplicateQuote'), icon: <Copy />, onClick: run.duplicate, write: true },
    ...change(
      'remove',
      translate('quotesBulkDelete', { count: targets.remove.length }),
      <Trash2 />,
    ),
  ]
}

/** The quotes list; the status view, the search (?q=), the sort (?sort=), the open quote (?id=) and a new one (?new=1) live in the URL. */
export function QuotesPage() {
  const widths = useResizableColumns('quotes', RESIZABLE, { flex: 'client' })
  const canWrite = useCan('write:invoices')
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams()
  const queryClient = useQueryClient()
  const raw = query.get('status')
  const status = isQuoteStatus(raw) ? raw : null
  const openId = query.get('id')
  const creating = query.get('new') === '1' && canWrite
  const term = query.get('q') ?? ''
  const sort = parseSort(query.get('sort'), QUOTE_SORT_FIELDS, DEFAULT_QUOTE_SORT)
  const [search, setSearch] = useState(term)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<{ kind: BulkKind; quotes: Quote[] } | null>(null)
  /** The quote whose drawer opens in the editor (Edit, a revised quote). */
  const [editId, setEditId] = useState<string | null>(null)
  const list = useQuotes({ status })
  const prefetch = usePrefetch(quoteQuery)
  // shortcut: the API returns every quote unpaged, so search and sort happen here; move them to the API with paging.
  const rows = sortQuotes(searchQuotes(list.data ?? [], term), sort)
  const selectedRows = rows.filter((row) => selected.has(row.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
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
  const openQuote = (id: string | null) => navigate({ id })
  const newQuote = () => navigate({ new: '1', client: null })
  const sortBy = (field: QuoteSortField) =>
    navigate({
      sort: sortParam(nextSort(sort, field, DESC_FIRST.has(field)), DEFAULT_QUOTE_SORT),
    })
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const commands = useQuoteCommands({
    onEdit: (quote) => {
      setEditId(quote.id)
      openQuote(quote.id)
    },
    onOpen: openQuote,
    onDeleted: (quote) => quote.id === openId && openQuote(null),
    onInvoice: (invoice) => router.push(`/invoices?id=${encodeURIComponent(invoice)}`),
  })

  // Search waits for a pause in typing, then goes to the URL.
  useEffect(() => {
    if (search === term) return
    const timer = setTimeout(() => navigate({ q: search || null }), 300)
    return () => clearTimeout(timer)
  })

  const downloadPdfs = () => {
    // Each PDF is its own download; browsers ask once before allowing several.
    selectedRows.forEach((row, i) =>
      setTimeout(() => {
        const link = document.createElement('a')
        link.href = quotePdfUrl(row.id, true)
        link.download = ''
        link.click()
      }, i * 250),
    )
  }

  /** Runs one action on each quote; what failed is said with the first reason, the rest stays done. */
  const runBulk = async (kind: BulkKind | 'duplicate', targets: Quote[]) => {
    const results = await Promise.allSettled(targets.map((quote) => BULK_RUN[kind](quote.id)))
    void queryClient.invalidateQueries({ queryKey: ['quotes'] })
    setSelected(new Set())
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length)
      return toast.error(
        translate('quotesBulkFailed', {
          failed: failures.length,
          count: targets.length,
          reason: quoteErrorMessage(failures[0]),
        }),
      )
    toast.success(
      kind === 'remove'
        ? translate('draftsDeleted', { length: targets.length })
        : kind === 'duplicate'
          ? translate('quotesBulkDuplicated', { count: targets.length })
          : translate('quotesBulkDone', { count: targets.length }),
    )
  }

  const selection = {
    count: selectedRows.length,
    actions: bulkActions(selectedRows, {
      downloadPdfs,
      duplicate: () => void runBulk('duplicate', selectedRows),
      ask: (kind) => setConfirming({ kind, quotes: bulkTargets(selectedRows)[kind] }),
    }),
  }
  const confirm = confirming?.quotes.length
    ? CONFIRM[confirming.kind](confirming.quotes.length)
    : null
  const open = useStableCallback(openQuote)
  const toggle = useStableCallback(toggleRow)
  const run = useStableCallback(commands.run)
  const act = useMemo<RowActions>(
    () => ({ open, toggle, prefetch, command: run }),
    [open, toggle, prefetch, run],
  )

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
        selectAll={
          rows.length && !allSelected
            ? { onSelect: () => setSelected(new Set(rows.map((row) => row.id))) }
            : undefined
        }
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
              <ResizableTable columns={widths} className={cn(listTable.table, 'hidden @4xl:table')}>
                <thead>
                  <tr className={listTable.head}>
                    <th className={listTable.select}>
                      <Checkbox
                        aria-label={translate('selectAllQuotes')}
                        className="bg-card"
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelected(new Set(checked ? rows.map((row) => row.id) : []))
                        }
                      />
                    </th>
                    {COLUMNS.map((column) => {
                      const sorted = column.id === sort.field
                      return (
                        <th
                          key={column.id}
                          {...widths.head(column.id)}
                          aria-sort={ariaSort(sorted, sort.desc)}
                          className={cn(
                            listTable.th,
                            column.width,
                            column.align === 'right' && 'text-right',
                            column.wide && 'hidden @6xl:table-cell',
                          )}
                        >
                          <SortButton
                            label={column.label}
                            sorted={sorted}
                            desc={sort.desc}
                            onClick={() => sortBy(column.id)}
                          />
                          {RESIZABLE.includes(column.id) && (
                            <ColumnResizer
                              columns={widths}
                              column={column.id}
                              label={column.label}
                            />
                          )}
                        </th>
                      )
                    })}
                    <th className={listTable.menu}>
                      <span className="sr-only">{translate('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((quote) => (
                    <QuoteRow
                      key={quote.id}
                      quote={quote}
                      selected={selected.has(quote.id)}
                      bulk={selected.has(quote.id) ? selection : undefined}
                      isOpen={quote.id === openId}
                      writable={canWrite}
                      act={act}
                    />
                  ))}
                </tbody>
              </ResizableTable>

              <ul className={cn(listTable.list, '@4xl:hidden')}>
                {rows.map((quote) => (
                  <QuoteItem
                    key={quote.id}
                    quote={quote}
                    selected={selected.has(quote.id)}
                    bulk={selected.has(quote.id) ? selection : undefined}
                    isOpen={quote.id === openId}
                    writable={canWrite}
                    act={act}
                  />
                ))}
              </ul>
            </>
          )}

          {selectedRows.length > 0 && (
            <BulkBar
              count={selectedRows.length}
              onClear={() => setSelected(new Set())}
              actions={selection.actions}
            />
          )}
        </div>
      </PageContextMenu>

      {openId && (
        <QuoteDetail
          key={openId}
          id={openId}
          edit={openId === editId}
          onClose={() => {
            setEditId(null)
            openQuote(null)
          }}
        />
      )}
      {creating && (
        <NewQuoteSheet
          clientId={query.get('client')}
          onClose={() => navigate({ new: null, client: null })}
          onSaved={(quote) => navigate({ new: null, client: null, id: quote.id })}
        />
      )}
      {commands.dialogs}
      {confirm && confirming && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirm}
          tone={confirming.kind === 'remove' ? 'destructive' : 'default'}
          onDecide={(approved) => {
            setConfirming(null)
            if (approved) void runBulk(confirming.kind, confirming.quotes)
          }}
        />
      )}
    </>
  )
}

/** A quote's actions, for its "…" button and its right-click menu. */
function quoteMenu(quote: Quote, writable: boolean, act: RowActions): RowMenuSpec {
  return {
    title: `${quoteNumber(quote)} · ${quote.client.name}`,
    items: (kit) => (
      <QuoteMenuItems
        kit={kit}
        quote={quote}
        writable={writable}
        run={act.command}
        onOpen={() => act.open(quote.id)}
      />
    ),
  }
}

type RowProps = {
  quote: Quote
  selected: boolean
  bulk: ComponentProps<typeof RowContextMenu>['bulk']
  isOpen: boolean
  writable: boolean
  act: RowActions
}

/** Stable across the page's renders, so opening a drawer re-renders no row. */
type RowActions = {
  open: (id: string) => void
  toggle: (id: string) => void
  prefetch: (id: string) => void
  command: (name: QuoteCommand, quote: Quote) => void
}

const rowName = (quote: Quote) => `${quoteNumber(quote)} · ${quote.client.name}`

const QuoteRow = memo(function QuoteRow({
  quote,
  selected,
  bulk,
  isOpen,
  writable,
  act,
}: RowProps) {
  const menu = quoteMenu(quote, writable, act)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <tr
        data-selected={selected || undefined}
        data-open={isOpen || undefined}
        onPointerEnter={() => act.prefetch(quote.id)}
        onClick={(event) => {
          // Clicks on the row's own controls, and in portalled menus and dialogs, do their own thing.
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, a, [role=checkbox], input')
          )
            return
          act.open(quote.id)
        }}
        className={cn(listTable.row, 'cursor-pointer')}
      >
        <td className={listTable.select}>
          <Checkbox
            aria-label={translate('select', { name: rowName(quote) })}
            className="bg-card"
            checked={selected}
            onCheckedChange={() => act.toggle(quote.id)}
          />
        </td>
        {COLUMNS.map((column) => (
          <td
            key={column.id}
            className={cn(
              listTable.td,
              column.align === 'right' && listTable.numeric,
              column.wide && 'hidden @6xl:table-cell',
              column.overflow && 'overflow-visible',
            )}
          >
            {column.cell(quote, act.open)}
          </td>
        ))}
        <td className={listTable.menu}>
          <RowMenuButton label={translate('actionsFor', { name: rowName(quote) })} menu={menu} />
        </td>
      </tr>
    </RowContextMenu>
  )
})

const QuoteItem = memo(function QuoteItem({
  quote,
  selected,
  bulk,
  isOpen,
  writable,
  act,
}: RowProps) {
  const menu = quoteMenu(quote, writable, act)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        data-open={isOpen || undefined}
        onPointerEnter={() => act.prefetch(quote.id)}
        className={listTable.item}
      >
        <Checkbox
          aria-label={translate('select', { name: rowName(quote) })}
          className="bg-card"
          checked={selected}
          onCheckedChange={() => act.toggle(quote.id)}
        />
        <button
          type="button"
          onClick={() => act.open(quote.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
    </RowContextMenu>
  )
})
