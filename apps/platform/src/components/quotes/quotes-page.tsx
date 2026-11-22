'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DataTable, listTable, type DataColumn } from '@helvetly/ui/components/data-table'
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
import { usePathname, useSearchParams } from 'next/navigation'
import { memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ApprovalInbox } from '@/components/approvals/approval-inbox'
import { useFeatureLock } from '@/components/billing/feature-lock'
import { activeFilters, ListFilters } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import {
  dropdownKit,
  PageContextMenu,
  RowContextMenu,
  RowMenuButton,
  type MenuKit,
  type RowMenuSpec,
} from '@/components/data/menus'
import { BulkBar, LoadingRows, State, type BulkAction } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { Initials } from '@/components/initials'
import { Money } from '@/components/invoices/invoice-bits'
import { useOpenHref } from '@/components/record-link'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatDay } from '@/lib/invoices'
import { among, amountParam, oneValue, shownElsewhere, type QueryField } from '@/lib/list-query'
import { parseSort, sortParam } from '@/lib/list-sort'
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
  filterQuotes,
  type QuoteFilters,
  sortQuotes,
  useQuotes,
  type Quote,
  type QuoteCommand,
  type QuoteSortField,
  type QuoteStatus,
} from '@/lib/quotes'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

import { QuoteRowStatus } from './quote-bits'
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

type QueryParams = QuoteFilters & { status: QuoteStatus | null; clientName: string }

/** The search's field terms: `status:` picks the view tab, `client:` narrows by the client's name. */
const QUERY_FIELDS: QueryField<QueryParams>[] = [
  {
    id: 'status',
    label: translate('status'),
    type: 'enum',
    values: QUOTE_STATUSES,
    ...shownElsewhere((value) => ({ status: among(STATUS_VALUES, [value])[0] ?? null })),
  },
  {
    id: 'client',
    label: translate('client'),
    type: 'text',
    ...oneValue(
      (params) => params.clientName,
      (clientName) => ({ clientName: clientName ?? '' }),
    ),
  },
  {
    id: 'from',
    label: translate('from'),
    type: 'date',
    placeholder: translate('anyDate'),
    until: 'to',
    ...oneValue(
      (params) => params.from,
      (from) => ({ from: from ?? '' }),
    ),
  },
  {
    id: 'to',
    label: translate('to3'),
    type: 'date',
    ...oneValue(
      (params) => params.to,
      (to) => ({ to: to ?? '' }),
    ),
  },
  {
    id: 'min',
    label: translate('minAmount'),
    type: 'number',
    placeholder: translate('minAmount'),
    until: 'max',
    ...oneValue(
      (params) => params.min,
      (min) => ({ min }),
    ),
  },
  {
    id: 'max',
    label: translate('maxAmount'),
    type: 'number',
    ...oneValue(
      (params) => params.max,
      (max) => ({ max }),
    ),
  },
]
const isDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '')
const STATUS_VALUES = QUOTE_STATUSES.map((entry) => entry.value)

/** The quotes list; the status view, the search (?q=), the sort (?sort=), the open quote (?id=) and a new one (?new=1) live in the URL. */
export function QuotesPage() {
  const canWrite = useCan('write:invoices')
  const openHref = useOpenHref()
  const pathname = usePathname()
  const query = useSearchParams()
  const queryClient = useQueryClient()
  const raw = query.get('status')
  const status = isQuoteStatus(raw) ? raw : null
  const openId = query.get('id')
  const creating = query.get('new') === '1' && canWrite
  const term = query.get('q') ?? ''
  const clientName = query.get('client_name') ?? ''
  const filters: QuoteFilters = {
    from: isDay(query.get('from')),
    to: isDay(query.get('to')),
    min: amountParam(query.get('min')),
    max: amountParam(query.get('max')),
  }
  const sort = parseSort(query.get('sort'), QUOTE_SORT_FIELDS, DEFAULT_QUOTE_SORT)
  const [search, setSearch] = useState(term)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<{ kind: BulkKind; quotes: Quote[] } | null>(null)
  /** The quote whose drawer opens in the editor (Edit, a revised quote). */
  const [editId, setEditId] = useState<string | null>(null)
  const list = useQuotes({ status })
  const prefetch = usePrefetch(quoteQuery)
  // shortcut: the API returns every quote unpaged, so search and sort happen here; move them to the API with paging.
  const rows = sortQuotes(
    filterQuotes(searchQuotes(list.data ?? [], term), filters).filter((quote) =>
      quote.client.name.toLowerCase().includes(clientName.toLowerCase()),
    ),
    sort,
  )
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
  const queryParams: QueryParams = { status, clientName, ...filters }
  const onQuery = (change: Partial<QueryParams>) =>
    navigate({
      ...(change.status !== undefined && { status: change.status }),
      ...(change.clientName !== undefined && { client_name: change.clientName || null }),
      ...(change.from !== undefined && { from: change.from || null }),
      ...(change.to !== undefined && { to: change.to || null }),
      ...(change.min !== undefined && { min: change.min }),
      ...(change.max !== undefined && { max: change.max }),
    })
  const openQuote = (id: string | null) => navigate({ id })
  const newQuote = () => navigate({ new: '1', client: null })
  const sortBy = (field: QuoteSortField, desc: boolean) =>
    navigate({
      sort: sortParam({ field, desc }, DEFAULT_QUOTE_SORT),
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
    onInvoice: (invoice) => openHref(`/invoices?id=${encodeURIComponent(invoice)}`),
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
  const columns = useMemo(() => quoteColumns(canWrite, act), [canWrite, act])

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
          <ApprovalInbox doc="quotes" onOpen={open} />
          <ListToolbar>
            <ListFilters fields={QUERY_FIELDS} params={queryParams} onChange={onQuery} />
            <ListSearch
              label={translate('searchQuotes')}
              placeholder={translate('searchNumberClientOrReference')}
              value={search}
              onChange={setSearch}
              query={{ fields: QUERY_FIELDS, params: queryParams, onChange: onQuery }}
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
            term || clientName || activeFilters(QUERY_FIELDS, queryParams) > 0 ? (
              <State
                icon={<SearchX />}
                title={
                  term || clientName
                    ? translate('nothingMatches', { search: term || clientName })
                    : translate('nothingMatches4')
                }
                text={translate('tryAnotherSearchOrClearTheFilters')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      navigate({
                        q: null,
                        status: null,
                        client_name: null,
                        from: null,
                        to: null,
                        min: null,
                        max: null,
                      })
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
              <DataTable
                id="quotes"
                className="hidden @4xl:table"
                columns={columns}
                data={rows}
                getRowId={(quote) => quote.id}
                sorting={{
                  column: sort.field,
                  desc: sort.desc,
                  onSort: (column, desc) => {
                    const field = QUOTE_SORT_FIELDS.find((entry) => entry === column)
                    if (field) sortBy(field, desc)
                  },
                }}
                selection={{
                  selected,
                  onChange: setSelected,
                  allLabel: translate('selectAllQuotes'),
                  rowLabel: (quote) => translate('select', { name: rowName(quote) }),
                }}
                onRowClick={(quote) => act.open(quote.id)}
                rowProps={(quote) => ({
                  'data-open': quote.id === openId || undefined,
                  onPointerEnter: () => act.prefetch(quote.id),
                })}
                renderRow={(quote, tr) => (
                  <RowContextMenu
                    menu={quoteMenu(quote, canWrite, act)}
                    bulk={selected.has(quote.id) ? selection : undefined}
                  >
                    {tr}
                  </RowContextMenu>
                )}
              />

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

function quoteColumns(writable: boolean, act: RowActions): DataColumn<Quote>[] {
  return [
    {
      id: 'number',
      header: translate('number'),
      size: 180,
      minSize: 112,
      sortable: true,
      // The cell shows the button's focus ring; the button truncates itself.
      className: 'overflow-visible',
      // The row opens on click; the button makes it reachable by keyboard.
      cell: (quote) => (
        <button
          type="button"
          onClick={() => act.open(quote.id)}
          className={cn(
            'max-w-full truncate rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            quote.number ? 'font-code' : 'text-muted-foreground',
          )}
        >
          {quoteNumber(quote)}
        </button>
      ),
    },
    {
      id: 'client',
      header: translate('client'),
      flex: true,
      sortable: true,
      cell: (quote) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Initials name={quote.client.name} />
          <span className="truncate">{quote.client.name}</span>
        </span>
      ),
    },
    {
      id: 'date',
      header: translate('date'),
      size: 128,
      minSize: 100,
      sortable: true,
      sortDescFirst: true,
      showFrom: 1100,
      cell: (quote) => <span className="text-muted-foreground">{formatDay(quote.issue_date)}</span>,
    },
    {
      id: 'valid',
      header: translate('validUntil3'),
      size: 128,
      minSize: 112,
      sortable: true,
      sortDescFirst: true,
      cell: (quote) => (
        <span className={cn(quote.status !== 'sent' && 'text-muted-foreground')}>
          {formatDay(quote.valid_until)}
        </span>
      ),
    },
    {
      id: 'total',
      header: translate('total'),
      size: 180,
      minSize: 112,
      sortable: true,
      sortDescFirst: true,
      align: 'right',
      cell: (quote) => <Money value={quote.payable_total} currency={quote.currency} />,
    },
    {
      id: 'status',
      header: translate('status'),
      size: 132,
      resizable: false,
      sortable: true,
      cell: (quote) => <QuoteRowStatus quote={quote} />,
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      size: 48,
      resizable: false,
      cell: (quote) => (
        <RowMenuButton
          label={translate('actionsFor', { name: rowName(quote) })}
          menu={quoteMenu(quote, writable, act)}
        />
      ),
    },
  ]
}

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
            <QuoteRowStatus quote={quote} />
          </span>
        </button>
      </li>
    </RowContextMenu>
  )
})
