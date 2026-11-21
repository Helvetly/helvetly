'use client'

import { locale, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@helvetly/ui/components/dropdown-menu'
import { inputClass } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  CloudOff,
  Download,
  FileDown,
  FilePlus2,
  ListFilter,
  ReceiptText,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  type ComponentProps,
  memo,
  type ReactNode,
  useEffect,
  useContext,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { toast } from 'sonner'

import { ApprovalInbox } from '@/components/approvals/approval-inbox'
import {
  ExportItem,
  PlanTag,
  unlessLocked,
  useFeatureLock,
} from '@/components/billing/feature-lock'
import { listTable, Pager } from '@/components/data/list-table'
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
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { Initials } from '@/components/initials'
import {
  RecordDrawersContext,
  RecordReplaceContext,
  type RecordRef,
} from '@/components/record-link'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import {
  displayStatus,
  addDays,
  canManageInvoices,
  daysBetween,
  DEFAULT_PARAMS,
  exportIdsUrl,
  exportUrl,
  formatAmount,
  isPositive,
  formatDay,
  INVOICE_KINDS,
  invoicesApi,
  isNegativeKind,
  isReceivable,
  kindInfo,
  listParamsToQuery,
  parseListParams,
  pdfUrl,
  today,
  useInvoice,
  useInvoiceList,
  type InvoiceKind,
  type InvoiceListItem,
  type ListParams,
  type ListStatus,
  type SortField,
  invoiceQuery,
} from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

import { ClientSearch } from './client-search'
import { composeQuery, isLegacyEditorPath, parseCompose } from './compose'
import { DERIVED, DerivePicker, type DeriveFrom } from './derive-picker'
import { InvoiceNumber, KIND_ICONS, Money, RowStatus } from './invoice-bits'
import { CommandItems, useInvoiceCommands, type InvoiceCommand } from './invoice-commands'
import { InvoiceDetail } from './invoice-detail'
import { InvoiceEditorDrawer } from './invoice-editor'
import { InvoiceKpis } from './invoice-kpis'
import { PaymentMarks } from './payment-methods'

/** Kinds made from scratch; the others come from an issued invoice. */
const CREATABLE_KINDS: InvoiceKind[] = [
  'invoice',
  'partial',
  'prepayment',
  'proforma',
  'self_billed',
]

const STATUS_OPTIONS: { value: ListStatus; label: string }[] = [
  { value: 'draft', label: translate('draft') },
  { value: 'open', label: translate('open') },
  { value: 'overdue', label: translate('overdue3') },
  { value: 'paid', label: translate('paid') },
  { value: 'void', label: translate('void2') },
  { value: 'replaced', label: translate('replaced') },
  { value: 'refund_due', label: translate('refundDue') },
]

/** Date presets for the issue date filter, relative to today in the workspace time zone. */
export function datePresets(day = today()) {
  const month = day.slice(0, 7)
  const startOfMonth = `${month}-01`
  const lastMonthEnd = addDays(startOfMonth, -1)
  const quarter = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1
  return [
    { label: translate('thisMonth2'), from: startOfMonth, to: day },
    { label: translate('lastMonth'), from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    {
      label: translate('thisQuarter'),
      from: `${day.slice(0, 4)}-${String(quarter).padStart(2, '0')}-01`,
      to: day,
    },
    { label: translate('last90Days2'), from: addDays(day, -89), to: day },
    { label: translate('thisYear'), from: `${day.slice(0, 4)}-01-01`, to: day },
  ]
}

const toggleIn = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

type ColumnDef = {
  id: string
  label: string
  /** Leave it off the main text column: that one takes the spare width (see `listTable`). */
  width?: string
  sort?: SortField
  align?: 'right'
  wide?: boolean
  cell: (invoice: InvoiceListItem) => ReactNode
}

function DueCell({ invoice }: { invoice: InvoiceListItem }) {
  if (invoice.status !== 'open' || invoice.kind === 'credit_note' || invoice.kind === 'proforma')
    return <span className="text-muted-foreground">{formatDay(invoice.due_date)}</span>
  const days = daysBetween(today(), invoice.due_date)
  return (
    <span className="grid leading-tight">
      <span>{formatDay(invoice.due_date)}</span>
      <span
        className={cn(
          'text-caption',
          days < 0 ? 'text-[#b5544f] dark:text-rose-300' : 'text-muted-foreground',
        )}
      >
        {days < 0
          ? translate('dynamicLate', {
              value1: -days,
              value2: days === -1 ? translate('dynamicDay') : translate('days'),
            })
          : days === 0
            ? 'today'
            : translate('dynamicIn', {
                days: days,
                value2: days === 1 ? translate('dynamicDay') : translate('days'),
              })}
      </span>
    </span>
  )
}

const COLUMNS: ColumnDef[] = [
  {
    id: 'number',
    label: translate('number'),
    width: 'w-[128px]',
    sort: 'number',
    cell: (invoice) => (
      <span className="grid leading-tight">
        <span className="flex items-center gap-1.5">
          <InvoiceNumber invoice={invoice} />
          <PaymentMarks methods={invoice.payment_methods} />
        </span>
        {invoice.kind === 'credit_note' && (
          <span className="text-caption text-muted-foreground">{translate('creditNote2')}</span>
        )}
      </span>
    ),
  },
  {
    id: 'client',
    label: translate('client'),
    sort: 'client',
    cell: (invoice) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <Initials name={invoice.client.name} />
        <span className="truncate">{invoice.client.name}</span>
      </span>
    ),
  },
  {
    id: 'issued',
    label: translate('issued4'),
    width: 'w-[128px]',
    sort: 'issue_date',
    wide: true,
    cell: (invoice) => (
      <span className="text-muted-foreground">{formatDay(invoice.issue_date)}</span>
    ),
  },
  {
    id: 'due',
    label: translate('due'),
    width: 'w-[128px]',
    sort: 'due_date',
    cell: (invoice) => <DueCell invoice={invoice} />,
  },
  {
    id: 'total',
    label: translate('amount'),
    width: 'w-[17%]',
    sort: 'total',
    align: 'right',
    cell: (invoice) => (
      <span className="grid justify-items-end leading-tight">
        <Money
          value={invoice.payable_total}
          currency={invoice.currency}
          negative={isNegativeKind(invoice.kind)}
        />
        {/* Less due than the amount: partly paid or credited. */}
        {invoice.status === 'open' && invoice.amount_due !== invoice.payable_total && (
          <span className="text-caption text-muted-foreground tabular-nums">
            {formatAmount(invoice.amount_due)}
            {translate('due6')}
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'status',
    label: translate('status'),
    width: 'w-[112px]',
    cell: (invoice) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <RowStatus invoice={invoice} />
      </span>
    ),
  },
]

/** Status keeps its width: badges are short and the same everywhere. */
const RESIZABLE = ['number', 'client', 'issued', 'due', 'total']

/** The invoices list: server-side search, filters, sort and paging, all kept in the URL. */
export function InvoicesPage() {
  const widths = useResizableColumns('invoices', RESIZABLE, { flex: 'client' })
  const canWrite = useCan('write:invoices')
  const importDrawer = useImportDrawer()
  const pathname = usePathname()
  const urlQuery = useSearchParams()
  // On the older /invoices/new and /invoices/edit URLs the query belongs to the editor, not the list.
  const legacy = isLegacyEditorPath(pathname)
  const query = legacy ? new URLSearchParams() : urlQuery
  const listPath = legacy ? '/invoices' : pathname
  const compose = canWrite ? parseCompose(pathname, urlQuery) : null
  const params = parseListParams(query)
  const openId = query.get('id')
  const canManage = canManageInvoices(useSession().data?.role)
  const queryClient = useQueryClient()

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [deleting, setDeleting] = useState<InvoiceListItem[] | null>(null)
  const [deriving, setDeriving] = useState<DeriveFrom | null>(null)
  const list = useInvoiceList(params)
  const prefetch = usePrefetch(invoiceQuery)

  const navigate = (next: URLSearchParams) => {
    setUrlQuery(listPath, next)
  }
  const openEditor = (kind: InvoiceKind) =>
    navigate(composeQuery(query, { id: null, kind, client: null }))
  const update = (change: Partial<ListParams>) =>
    navigate(listParamsToQuery({ ...params, page: 1, ...change }, query))
  const openInvoice = (id: string | null) => {
    const next = new URLSearchParams(query)
    if (id) next.set('id', id)
    else next.delete('id')
    navigate(next)
  }
  const commands = useInvoiceCommands(openInvoice)
  const openStacked = useContext(RecordDrawersContext)
  // A record linked from the page's drawer (a plan's partial) takes its place; Back returns to the one before.
  const showInPlace = useStableCallback((record: RecordRef) => {
    if (record.kind !== 'invoice') return openStacked?.(record)
    const next = composeQuery(query, null)
    next.set('id', record.id)
    setUrlQuery(listPath, next, true)
  })

  // ?refund=1 (from "Issue and record refund now") opens the refund dialog once, then goes away.
  const refundFor = query.get('refund') === '1' ? openId : null
  const refundQuery = useInvoice(refundFor)
  // Only fresh data: the cached copy predates the credit note that made the refund due.
  const refundTarget = refundQuery.isFetching ? undefined : refundQuery.data
  const startRefund = useEffectEvent((invoice: InvoiceListItem) => {
    const next = new URLSearchParams(query)
    next.delete('refund')
    navigate(next)
    if (isPositive(invoice.refund_due)) commands.run('refund', invoice)
  })
  useEffect(() => {
    if (refundTarget) startRefund(refundTarget)
  }, [refundTarget])

  // Search waits for a pause in typing, then goes to the URL (and so to the server).
  useEffect(() => {
    if (search === params.search) return
    const timer = setTimeout(() => update({ search }), 300)
    return () => clearTimeout(timer)
  })

  const rows = list.data?.data ?? []
  const meta = list.data?.meta
  const filtered =
    Boolean(params.search) ||
    params.status.length > 0 ||
    params.client !== null ||
    params.credited !== null ||
    params.from !== null ||
    params.to !== null
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const selectedRows = rows.filter((row) => selected.has(row.id))
  const selectedDrafts = selectedRows.filter((row) => row.status === 'draft')
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const sortBy = (field: SortField) =>
    update({
      sort: field,
      desc: params.sort === field ? !params.desc : field !== 'client' && field !== 'number',
    })

  const downloadPdfs = () => {
    // Each PDF is its own download; browsers ask once before allowing several.
    selectedRows.forEach((row, i) =>
      setTimeout(() => {
        const link = document.createElement('a')
        link.href = pdfUrl(row.id, true)
        link.download = `${row.number ?? 'draft'}.pdf`
        link.click()
      }, i * 250),
    )
  }

  const confirmDelete = async (approved: boolean) => {
    const targets = deleting ?? []
    setDeleting(null)
    if (!approved) return
    const results = await Promise.allSettled(targets.map((row) => invoicesApi.remove(row.id)))
    const failed = results.filter((result) => result.status === 'rejected').length
    void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    setSelected(new Set())
    if (failed)
      toast.error(translate('ofDraftsCouldnTBeDeleted', { failed: failed, length: targets.length }))
    else
      toast.success(
        targets.length === 1
          ? translate('draftDeleted2')
          : translate('draftsDeleted', { length: targets.length }),
      )
  }

  const kind = kindInfo(params.kind)
  const newInvoice = () => openEditor('invoice')
  const tabs = INVOICE_KINDS.map((info) => info.plural)
  const active = INVOICE_KINDS.indexOf(kind)
  const selectTab = (index: number) => update({ kind: INVOICE_KINDS[index]?.kind })
  const exportLock = useFeatureLock('data_export')
  const aiLock = useFeatureLock('ai_import')
  const canImport = canWrite && !aiLock
  const dropping = useImportDrop('invoices', canImport && !compose && !openId)
  const selection = {
    count: selected.size,
    actions: bulkActions(selectedDrafts.length, {
      exportCsv: unlessLocked(exportLock, () =>
        window.location.assign(exportIdsUrl([...selected])),
      ),
      downloadPdfs,
      removeDrafts: () => setDeleting(selectedDrafts),
    }),
  }
  const open = useStableCallback(openInvoice)
  const toggle = useStableCallback(toggleRow)
  const run = useStableCallback(commands.run)
  const act = useMemo<RowActions>(
    () => ({ open, toggle, prefetch, command: run }),
    [open, toggle, prefetch, run],
  )
  const pageItems = ({ Item }: MenuKit) => (
    <>
      {canWrite && (
        <ImportItem Item={Item} onSelect={importDrawer.open}>
          {translate('import')}
        </ImportItem>
      )}
      <ExportItem Item={Item} href={localizedHref(exportUrl(params))}>
        {translate('exportCSV')}
        {filtered ? ' (filtered)' : ''}
      </ExportItem>
      <Item asChild>
        <Link href="/settings/invoices">
          <ReceiptText />
          {translate('invoiceSettings2')}
        </Link>
      </Item>
    </>
  )

  return (
    <>
      <PageHeader
        tabs={tabs}
        tabIcons={INVOICE_KINDS.map((info) => KIND_ICONS[info.kind])}
        savedViews={false}
        active={active}
        onSelect={selectTab}
        primary={translate('newInvoice')}
        onPrimary={newInvoice}
        primaryMenu={<NewMenuItems onNew={openEditor} onDerive={setDeriving} canWrite={canWrite} />}
        menu={pageItems(dropdownKit)}
      />
      {importDrawer.isOpen && <ImportDrawer kind="invoices" onClose={importDrawer.close} />}
      {dropping && <DropOverlay title={translate('dropToImportTheseInvoices')} />}
      <PageContextMenu
        title={translate('invoices')}
        primary={{ label: translate('newInvoice'), onSelect: newInvoice }}
        items={pageItems}
        views={{
          tabs,
          active,
          onSelect: selectTab,
        }}
        selectAll={
          rows.length && !allSelected
            ? { onSelect: () => setSelected(new Set(rows.map((row) => row.id))) }
            : undefined
        }
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['invoices'] })}
      >
        <div className="relative flex flex-1 flex-col">
          <ApprovalInbox doc="invoices" onOpen={open} />
          {isReceivable(params.kind) && <InvoiceKpis />}
          <ListToolbar>
            <Filters params={params} onChange={update} />
            <ListSearch
              label={translate('searchInvoices')}
              placeholder={translate('searchNumberClientOrReference')}
              value={search}
              onChange={setSearch}
            />
          </ListToolbar>
          <ActiveFilters params={params} onChange={update} />

          {list.error ? (
            <State
              icon={<CloudOff />}
              title={translate('couldnTLoadInvoices')}
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
            filtered ? (
              <State
                icon={<SearchX />}
                title={
                  params.search
                    ? translate('noMatch', {
                        value1: kind.plural.toLowerCase(),
                        search: params.search,
                      })
                    : translate('nothingInThisView')
                }
                text={translate('tryAnotherSearchOrClearTheFilters')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      navigate(
                        listParamsToQuery(
                          { ...DEFAULT_PARAMS, kind: params.kind },
                          new URLSearchParams(),
                        ),
                      )
                    }}
                  >
                    {translate('clearSearchAndFilters')}
                  </Button>
                }
              />
            ) : (
              <State
                icon={<FilePlus2 />}
                title={translate('noYet', {
                  value1: locale === 'de' ? kind.plural : kind.plural.toLowerCase(),
                })}
                text={
                  CREATABLE_KINDS.includes(params.kind)
                    ? translate('pickAClientAddAFewLinesAndIssue')
                    : translate('makeOneFromAnIssuedInvoiceInItsActions')
                }
                action={
                  canWrite &&
                  CREATABLE_KINDS.includes(params.kind) && (
                    <EmptyImportActions
                      importLabel={translate('import')}
                      hint={translate('orDropFilesAnywhereOnThisPage')}
                      // The import reads invoices; other kinds' tabs keep their own button only.
                      onImport={
                        canImport && params.kind === 'invoice' ? importDrawer.open : undefined
                      }
                    >
                      <Button size="sm" onClick={() => openEditor(params.kind)}>
                        {translate('new2')}
                        {locale === 'de' ? kind.label : kind.label.toLowerCase()}
                      </Button>
                    </EmptyImportActions>
                  )
                }
              />
            )
          ) : (
            <div
              className={cn(
                'transition-opacity duration-150',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              <ResizableTable columns={widths} className={cn(listTable.table, 'hidden @4xl:table')}>
                <thead>
                  <tr className={listTable.head}>
                    <th className={listTable.select}>
                      <Checkbox
                        aria-label={translate('selectAllInvoicesOnThisPage')}
                        className="bg-card"
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelected(new Set(checked ? rows.map((row) => row.id) : []))
                        }
                      />
                    </th>
                    {COLUMNS.map((column) => {
                      const sorted = column.sort === params.sort
                      const resizable = RESIZABLE.includes(column.id)
                      return (
                        <th
                          key={column.id}
                          {...widths.head(column.id)}
                          aria-sort={
                            sorted ? (params.desc ? 'descending' : 'ascending') : undefined
                          }
                          className={cn(
                            listTable.th,
                            column.width,
                            column.align === 'right' && 'text-right',
                            column.wide && 'hidden @6xl:table-cell',
                          )}
                        >
                          {column.sort ? (
                            <button
                              type="button"
                              onClick={() => column.sort && sortBy(column.sort)}
                              className={cn(
                                'inline-flex items-center gap-1 uppercase hover:text-foreground',
                                sorted && 'text-foreground',
                              )}
                            >
                              {column.label}
                              {sorted &&
                                (params.desc ? (
                                  <ArrowDown className="size-3.5" />
                                ) : (
                                  <ArrowUp className="size-3.5" />
                                ))}
                            </button>
                          ) : (
                            column.label
                          )}
                          {resizable && (
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
                  {rows.map((invoice) => (
                    <InvoiceRow
                      key={invoice.id}
                      invoice={invoice}
                      selected={selected.has(invoice.id)}
                      bulk={selected.has(invoice.id) ? selection : undefined}
                      isOpen={invoice.id === openId}
                      access={canManage}
                      act={act}
                    />
                  ))}
                </tbody>
              </ResizableTable>

              <ul className={cn(listTable.list, '@4xl:hidden')}>
                {rows.map((invoice) => (
                  <InvoiceItem
                    key={invoice.id}
                    invoice={invoice}
                    selected={selected.has(invoice.id)}
                    bulk={selected.has(invoice.id) ? selection : undefined}
                    isOpen={invoice.id === openId}
                    access={canManage}
                    act={act}
                  />
                ))}
              </ul>

              {meta && <Pager meta={meta} onPage={(page) => update({ page })} />}
            </div>
          )}

          {selected.size > 0 && (
            <BulkBar
              count={selected.size}
              onClear={() => setSelected(new Set())}
              actions={selection.actions}
            />
          )}
        </div>
      </PageContextMenu>

      <RecordReplaceContext.Provider value={showInPlace}>
        {openId && (
          <InvoiceDetail
            id={openId}
            canManage={canManage}
            onClose={() => openInvoice(null)}
            run={commands.run}
            busy={commands.busy}
          />
        )}
        {compose && (
          <InvoiceEditorDrawer
            compose={compose}
            onClose={() => navigate(composeQuery(query, null))}
            onCreated={(id) => navigate(composeQuery(query, { ...compose, id }))}
          />
        )}
      </RecordReplaceContext.Provider>
      {commands.dialogs}
      {deriving && (
        <DerivePicker
          derived={deriving}
          onClose={() => setDeriving(null)}
          onPick={(invoice) => {
            setDeriving(null)
            commands.run(deriving.command, invoice)
          }}
        />
      )}
      {deleting && deleting.length > 0 && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? translate('deleteThisDraft')
              : translate('deleteDrafts4', { length: deleting.length })
          }
          body={
            deleting.length === selected.size
              ? translate('draftsHaveNoNumberSoNothingGoesMissingIn')
              : translate('onlyTheDraftsInYourSelectionAreDeletedIssued', {
                  length: deleting.length,
                })
          }
          confirmLabel={
            deleting.length === 1
              ? translate('deleteDraft2')
              : translate('deleteDrafts3', { length: deleting.length })
          }
          tone="destructive"
          onDecide={(approved) => void confirmDelete(approved)}
        />
      )}
    </>
  )
}

/** The split button's menu: the types made from scratch, then those made from an issued invoice (picked next). */
function NewMenuItems({
  onNew,
  onDerive,
  canWrite,
}: {
  onNew: (kind: InvoiceKind) => void
  onDerive: (derived: DeriveFrom) => void
  canWrite: boolean
}) {
  const corrections = useFeatureLock('invoice_corrections')
  return (
    <>
      {CREATABLE_KINDS.map((kind) => {
        const Icon = KIND_ICONS[kind]
        return (
          <DropdownMenuItem key={kind} onSelect={() => onNew(kind)}>
            <Icon /> {kindInfo(kind).label}
          </DropdownMenuItem>
        )
      })}
      {canWrite && <DropdownMenuSeparator />}
      {canWrite &&
        DERIVED.map((derived) => {
          const Icon = KIND_ICONS[derived.kind]
          return (
            <DropdownMenuItem
              key={derived.kind}
              disabled={Boolean(corrections)}
              onSelect={() => onDerive(derived)}
            >
              <Icon />
              <span className="grid leading-tight">
                {kindInfo(derived.kind).label}
                <span className="text-xs text-muted-foreground">
                  {translate('fromAnIssuedInvoice')}
                </span>
              </span>
              {corrections && <PlanTag lock={corrections} />}
            </DropdownMenuItem>
          )
        })}
    </>
  )
}

/** The bulk bar's buttons; deleting only when the selection holds drafts. */
export function bulkActions(
  drafts: number,
  run: { exportCsv: () => void; downloadPdfs: () => void; removeDrafts: () => void },
) {
  return [
    { label: translate('exportCSV'), icon: <Download />, onClick: run.exportCsv },
    { label: translate('downloadPDFs'), icon: <FileDown />, onClick: run.downloadPdfs },
    ...(drafts > 0
      ? [
          {
            label:
              drafts === 1
                ? translate('deleteDraft2')
                : translate('deleteDrafts2', { drafts: drafts }),
            icon: <Trash2 />,
            onClick: run.removeDrafts,
            destructive: true,
            write: true,
          },
        ]
      : []),
  ]
}

/** An invoice's actions, for its "…" button and its right-click menu. */
function invoiceMenu(
  invoice: InvoiceListItem,
  canManage: boolean,
  run: ReturnType<typeof useInvoiceCommands>['run'],
): RowMenuSpec {
  return {
    title: `${invoice.number ?? translate('draft')} · ${invoice.client.name}`,
    items: (kit) => (
      <CommandItems kit={kit} invoice={invoice} canManage={canManage} run={run} showOpen />
    ),
  }
}

/** Chips under the toolbar for filters the tabs don't show, each with its own ×. */
function ActiveFilters({
  params,
  onChange,
}: {
  params: ListParams
  onChange: (change: Partial<ListParams>) => void
}) {
  const client = useClient(params.client).data
  const chips: { label: string; clear: Partial<ListParams> }[] = []
  if (params.client)
    chips.push({
      label: translate('client5', { value1: client?.name ?? '…' }),
      clear: { client: null },
    })
  if (params.credited)
    chips.push({ label: translate('creditNotesOfOneInvoice'), clear: { credited: null } })
  if (params.from || params.to)
    chips.push({
      label: translate('issued5', {
        value1: params.from ? formatDay(params.from) : '…',
        value2: params.to ? formatDay(params.to) : translate('today2'),
      }),
      clear: { from: null, to: null },
    })
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 md:px-5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="flex h-7 items-center gap-1 rounded-md bg-muted pr-1 pl-2.5 text-[13px]"
        >
          {chip.label}
          <button
            type="button"
            aria-label={translate('removeFilter', { label: chip.label })}
            onClick={() => onChange(chip.clear)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

function Filters({
  params,
  onChange,
}: {
  params: ListParams
  onChange: (change: Partial<ListParams>) => void
}) {
  const [picking, setPicking] = useState(false)
  const client = useClient(params.client).data
  const count = params.status.length + (params.client ? 1 : 0) + (params.from || params.to ? 1 : 0)
  const option =
    'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted [&_[role=checkbox]]:bg-card'
  const presets = datePresets()

  return (
    <Popover onOpenChange={(open) => !open && setPicking(false)}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-title-sm font-normal">
          <ListFilter className="stroke-[1.5]" />
          {translate('filters')}
          {count > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          'grid max-h-[75svh] gap-3 overflow-y-auto p-3',
          picking ? 'w-80 p-0' : 'w-80',
        )}
      >
        {picking ? (
          <ClientSearch
            selectedId={params.client}
            onSelect={(picked) => {
              onChange({ client: picked.id })
              setPicking(false)
            }}
          />
        ) : (
          <>
            <fieldset className="grid gap-0.5">
              <legend className="px-2 pb-1 text-xs text-muted-foreground">
                {translate('status')}
              </legend>
              {STATUS_OPTIONS.map((status) => (
                <label key={status.value} className={option}>
                  <Checkbox
                    checked={params.status.includes(status.value)}
                    onCheckedChange={() =>
                      onChange({ status: toggleIn(params.status, status.value) })
                    }
                  />
                  {status.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="grid gap-1">
              <legend className="px-2 pb-1 text-xs text-muted-foreground">
                {translate('client')}
              </legend>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => setPicking(true)}
                  className="w-full justify-between px-3 font-normal"
                >
                  <span className={cn('truncate', !params.client && 'text-muted-foreground')}>
                    {params.client
                      ? (client?.name ?? translate('loading'))
                      : translate('anyClient')}
                  </span>
                  {!params.client && <Search className="size-3.5 text-muted-foreground" />}
                </Button>
                {params.client && (
                  <button
                    type="button"
                    aria-label={translate('anyClient')}
                    onClick={() => onChange({ client: null })}
                    className="absolute top-2 right-2 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="px-2 pb-1 text-xs text-muted-foreground">
                {translate('issueDate')}
              </legend>
              <div className="flex flex-wrap gap-1 px-1">
                {presets.map((preset) => {
                  const active = params.from === preset.from && params.to === preset.to
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onChange(
                          active ? { from: null, to: null } : { from: preset.from, to: preset.to },
                        )
                      }
                      className="h-7 rounded-md px-2 text-[13px] text-muted-foreground ring-1 ring-border ring-inset hover:bg-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-primary"
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 px-1">
                <input
                  type="date"
                  aria-label={translate('issuedFrom')}
                  value={params.from ?? ''}
                  max={params.to ?? undefined}
                  onChange={(event) => onChange({ from: event.target.value || null })}
                  className={cn(inputClass, 'px-2 tabular-nums')}
                />
                <input
                  type="date"
                  aria-label={translate('issuedTo')}
                  value={params.to ?? ''}
                  min={params.from ?? undefined}
                  onChange={(event) => onChange({ to: event.target.value || null })}
                  className={cn(inputClass, 'px-2 tabular-nums')}
                />
              </div>
            </fieldset>
            {count > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start text-muted-foreground"
                onClick={() => onChange({ status: [], client: null, from: null, to: null })}
              >
                {translate('clearFilters')}
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

type RowProps = {
  invoice: InvoiceListItem
  selected: boolean
  bulk: ComponentProps<typeof RowContextMenu>['bulk']
  access: boolean
  act: RowActions
  isOpen: boolean
}

/** Stable across the page's renders, so opening a drawer re-renders no row. */
type RowActions = {
  open: (id: string) => void
  toggle: (id: string) => void
  prefetch: (id: string) => void
  command: (name: InvoiceCommand, invoice: InvoiceListItem) => void
}

const InvoiceRow = memo(function InvoiceRow({
  invoice,
  selected,
  bulk,
  isOpen,
  access,
  act,
}: RowProps) {
  const menu = invoiceMenu(invoice, access, act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <tr
        data-selected={selected || undefined}
        data-attention={displayStatus(invoice) === 'overdue' || undefined}
        onPointerEnter={() => act.prefetch(invoice.id)}
        data-open={isOpen || undefined}
        onClick={(event) => {
          // Clicks on the row's own controls, and in portalled menus, do their own thing.
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, a, [role=checkbox], input')
          )
            return
          act.open(invoice.id)
        }}
        className={cn(listTable.row, 'cursor-pointer')}
      >
        <td className={listTable.select}>
          <Checkbox
            aria-label={translate('selectFor', {
              value1: invoice.number ?? translate('draft4'),
              name: invoice.client.name,
            })}
            className="bg-card"
            checked={selected}
            onCheckedChange={() => act.toggle(invoice.id)}
          />
        </td>
        {COLUMNS.map((column) => (
          <td
            key={column.id}
            className={cn(
              listTable.td,
              column.align === 'right' && listTable.numeric,
              column.wide && 'hidden @6xl:table-cell',
            )}
          >
            {column.cell(invoice)}
          </td>
        ))}
        <td className={listTable.menu}>
          <RowMenuButton
            label={translate('actionsFor2', {
              value1: invoice.number ?? translate('draft4'),
              name: invoice.client.name,
            })}
            menu={menu}
          />
        </td>
      </tr>
    </RowContextMenu>
  )
})

const InvoiceItem = memo(function InvoiceItem({ invoice, selected, bulk, access, act }: RowProps) {
  const menu = invoiceMenu(invoice, access, act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        data-attention={displayStatus(invoice) === 'overdue' || undefined}
        onPointerEnter={() => act.prefetch(invoice.id)}
        className={listTable.item}
      >
        <Checkbox
          aria-label={translate('selectFor', {
            value1: invoice.number ?? translate('draft4'),
            name: invoice.client.name,
          })}
          className="bg-card"
          checked={selected}
          onCheckedChange={() => act.toggle(invoice.id)}
        />
        <button
          type="button"
          onClick={() => act.open(invoice.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="grid min-w-0 flex-1 leading-snug">
            <span className="truncate text-[15px]">{invoice.client.name}</span>
            <span className="truncate text-[13px] text-muted-foreground">
              {invoice.number && `${invoice.number} · `}
              {translate('due5')}
              {formatDay(invoice.due_date)}
            </span>
          </span>
          <span className="grid justify-items-end gap-1">
            <Money
              value={invoice.payable_total}
              currency={invoice.currency}
              negative={isNegativeKind(invoice.kind)}
              className="text-[14px]"
            />
            <RowStatus invoice={invoice} />
          </span>
        </button>
      </li>
    </RowContextMenu>
  )
})
