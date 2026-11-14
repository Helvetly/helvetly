'use client'

import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@helvetly/ui/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Download,
  FileDown,
  FilePlus2,
  FileUp,
  ListFilter,
  ReceiptText,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  type ComponentProps,
  memo,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { toast } from 'sonner'

import {
  dropdownKit,
  PageContextMenu,
  RowContextMenu,
  RowMenuButton,
  type MenuKit,
  type RowMenuSpec,
} from '@/components/data/menus'
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { Initials } from '@/components/initials'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import {
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
import { InvoiceNumber, KIND_ICONS, Money, RowStatus } from './invoice-bits'
import { CommandItems, useInvoiceCommands, type InvoiceCommand } from './invoice-commands'
import { InvoiceDetail } from './invoice-detail'
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
const newHref = (kind: InvoiceKind) =>
  kind === 'invoice' ? '/invoices/new' : `/invoices/new?kind=${kind}`

const STATUS_OPTIONS: { value: ListStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
  { value: 'replaced', label: 'Replaced' },
  { value: 'refund_due', label: 'Refund due' },
]

/** Date presets for the issue date filter, relative to today in the workspace time zone. */
export function datePresets(day = today()) {
  const month = day.slice(0, 7)
  const startOfMonth = `${month}-01`
  const lastMonthEnd = addDays(startOfMonth, -1)
  const quarter = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1
  return [
    { label: 'This month', from: startOfMonth, to: day },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    {
      label: 'This quarter',
      from: `${day.slice(0, 4)}-${String(quarter).padStart(2, '0')}-01`,
      to: day,
    },
    { label: 'Last 90 days', from: addDays(day, -89), to: day },
    { label: 'This year', from: `${day.slice(0, 4)}-01-01`, to: day },
  ]
}

const toggleIn = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

type ColumnDef = {
  id: string
  label: string
  width: string
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
          'text-[12.5px]',
          days < 0 ? 'text-[#b5544f] dark:text-rose-300' : 'text-muted-foreground',
        )}
      >
        {days < 0
          ? `${-days} ${days === -1 ? 'day' : 'days'} late`
          : days === 0
            ? 'today'
            : `in ${days} ${days === 1 ? 'day' : 'days'}`}
      </span>
    </span>
  )
}

const COLUMNS: ColumnDef[] = [
  {
    id: 'number',
    label: 'Number',
    width: 'w-[128px]',
    sort: 'number',
    cell: (invoice) => (
      <span className="grid leading-tight">
        <span className="flex items-center gap-1.5">
          <InvoiceNumber invoice={invoice} />
          <PaymentMarks methods={invoice.payment_methods} />
        </span>
        {invoice.kind === 'credit_note' && (
          <span className="text-[12.5px] text-muted-foreground">Credit note</span>
        )}
      </span>
    ),
  },
  {
    id: 'client',
    label: 'Client',
    width: 'w-[30%]',
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
    label: 'Issued',
    width: 'w-[128px]',
    sort: 'issue_date',
    wide: true,
    cell: (invoice) => (
      <span className="text-muted-foreground">{formatDay(invoice.issue_date)}</span>
    ),
  },
  {
    id: 'due',
    label: 'Due',
    width: 'w-[128px]',
    sort: 'due_date',
    cell: (invoice) => <DueCell invoice={invoice} />,
  },
  {
    id: 'total',
    label: 'Amount',
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
          <span className="text-[12.5px] text-muted-foreground tabular-nums">
            {formatAmount(invoice.amount_due)} due
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'status',
    label: 'Status',
    width: 'w-[112px]',
    cell: (invoice) => (
      <span className="flex items-center gap-1.5">
        <RowStatus invoice={invoice} />
      </span>
    ),
  },
]

/** The invoices list: server-side search, filters, sort and paging, all kept in the URL. */
export function InvoicesPage() {
  const canWrite = useCan('write:invoices')
  const importDrawer = useImportDrawer()
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const openId = query.get('id')
  const canManage = canManageInvoices(useSession().data?.role)
  const queryClient = useQueryClient()

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [deleting, setDeleting] = useState<InvoiceListItem[] | null>(null)
  const list = useInvoiceList(params)
  const prefetch = usePrefetch(invoiceQuery)

  const navigate = (next: URLSearchParams) => {
    setUrlQuery(pathname, next)
  }
  const update = (change: Partial<ListParams>) =>
    navigate(listParamsToQuery({ ...params, page: 1, ...change }, query))
  const openInvoice = (id: string | null) => {
    const next = new URLSearchParams(query)
    if (id) next.set('id', id)
    else next.delete('id')
    navigate(next)
  }
  const commands = useInvoiceCommands(openInvoice)

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
    if (failed) toast.error(`${failed} of ${targets.length} drafts couldn’t be deleted.`)
    else
      toast.success(targets.length === 1 ? 'Draft deleted.' : `${targets.length} drafts deleted.`)
  }

  const kind = kindInfo(params.kind)
  const newInvoice = () => router.push(newHref('invoice'))
  const tabs = INVOICE_KINDS.map((info) => info.plural)
  const active = INVOICE_KINDS.indexOf(kind)
  const selectTab = (index: number) => update({ kind: INVOICE_KINDS[index]?.kind })
  const selection = {
    count: selected.size,
    actions: bulkActions(selectedDrafts.length, {
      exportCsv: () => window.location.assign(exportIdsUrl([...selected])),
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
        <Item onSelect={importDrawer.open}>
          <FileUp /> Import
        </Item>
      )}
      <Item asChild>
        <a href={exportUrl(params)} download>
          <Download /> Export CSV{filtered ? ' (filtered)' : ''}
        </a>
      </Item>
      <Item asChild>
        <Link href="/settings/invoices">
          <ReceiptText /> Invoice settings
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
        primary="New invoice"
        onPrimary={newInvoice}
        primaryMenu={<NewMenuItems onNew={(next) => router.push(newHref(next))} />}
        menu={pageItems(dropdownKit)}
      />
      {importDrawer.isOpen && <ImportDrawer kind="invoices" onClose={importDrawer.close} />}
      <PageContextMenu
        title="Invoices"
        primary={{ label: 'New invoice', onSelect: newInvoice }}
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
          {isReceivable(params.kind) && <InvoiceKpis />}
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:px-3">
            <Filters params={params} onChange={update} />
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:text-foreground">
              <Search className="size-4 shrink-0 stroke-[1.5]" />
              <input
                type="search"
                aria-label="Search invoices"
                placeholder="Search number, client or reference"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent text-[15px] text-foreground outline-none placeholder:text-placeholder"
              />
            </label>
          </div>
          <ActiveFilters params={params} onChange={update} />

          {list.error ? (
            <State
              icon={<CloudOff />}
              title="Couldn’t load invoices"
              text={errorMessage(list.error)}
              action={
                <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                  Try again
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
                    ? `No ${kind.plural.toLowerCase()} match “${params.search}”`
                    : 'Nothing in this view'
                }
                text="Try another search or clear the filters."
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
                    Clear search and filters
                  </Button>
                }
              />
            ) : (
              <State
                icon={<FilePlus2 />}
                title={`No ${kind.plural.toLowerCase()} yet`}
                text={
                  CREATABLE_KINDS.includes(params.kind)
                    ? 'Pick a client, add a few lines and issue it: totals and VAT are done for you.'
                    : 'Make one from an issued invoice, in its actions.'
                }
                action={
                  canWrite &&
                  CREATABLE_KINDS.includes(params.kind) && (
                    <Button size="sm" onClick={() => router.push(newHref(params.kind))}>
                      New {kind.label.toLowerCase()}
                    </Button>
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
              <table className="hidden w-full table-fixed text-[15px] @4xl:table">
                <thead>
                  <tr className="h-11 border-b bg-muted/50 text-left text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
                    <th className="w-12 pl-5">
                      <Checkbox
                        aria-label="Select all invoices on this page"
                        className="bg-card"
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelected(new Set(checked ? rows.map((row) => row.id) : []))
                        }
                      />
                    </th>
                    {COLUMNS.map((column) => {
                      const sorted = column.sort === params.sort
                      return (
                        <th
                          key={column.id}
                          aria-sort={
                            sorted ? (params.desc ? 'descending' : 'ascending') : undefined
                          }
                          className={cn(
                            'px-3 font-medium',
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
                        </th>
                      )
                    })}
                    <th className="w-12">
                      <span className="sr-only">Actions</span>
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
              </table>

              <ul className="divide-y divide-border/70 @4xl:hidden">
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

              {meta && (
                <nav
                  aria-label="Pages"
                  className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-[13px] text-muted-foreground md:px-5"
                >
                  <span className="tabular-nums">
                    {(meta.page - 1) * meta.page_size + 1}–
                    {Math.min(meta.page * meta.page_size, meta.total)} of {meta.total}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Previous page"
                      disabled={meta.page <= 1}
                      onClick={() => update({ page: meta.page - 1 })}
                    >
                      <ChevronLeft />
                    </Button>
                    <span className="tabular-nums">
                      Page {meta.page} of {Math.max(meta.total_pages, 1)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Next page"
                      disabled={meta.page >= meta.total_pages}
                      onClick={() => update({ page: meta.page + 1 })}
                    >
                      <ChevronRight />
                    </Button>
                  </span>
                </nav>
              )}
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

      {openId && (
        <InvoiceDetail
          key={`detail:${openId}`}
          id={openId}
          canManage={canManage}
          onClose={() => openInvoice(null)}
          run={commands.run}
          busy={commands.busy}
        />
      )}
      {commands.dialogs}
      {deleting && deleting.length > 0 && (
        <ConfirmDialog
          title={deleting.length === 1 ? 'Delete this draft?' : `Delete ${deleting.length} drafts?`}
          body={
            deleting.length === selected.size
              ? 'Drafts have no number, so nothing goes missing in your numbering. This can’t be undone.'
              : `Only the ${deleting.length} drafts in your selection are deleted; issued invoices stay, they can only be credited.`
          }
          confirmLabel={deleting.length === 1 ? 'Delete draft' : `Delete ${deleting.length} drafts`}
          tone="destructive"
          onDecide={(approved) => void confirmDelete(approved)}
        />
      )}
    </>
  )
}

/** The split button's menu: the types made from scratch, then those made from an issued invoice. */
function NewMenuItems({ onNew }: { onNew: (kind: InvoiceKind) => void }) {
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
      <DropdownMenuSeparator />
      {(['credit_note', 'debit_note', 'corrected'] as const).map((kind) => {
        const Icon = KIND_ICONS[kind]
        return (
          <DropdownMenuItem key={kind} disabled>
            <Icon />
            <span className="grid leading-tight">
              {kindInfo(kind).label}
              <span className="text-xs text-muted-foreground">From an issued invoice</span>
            </span>
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
    { label: 'Export CSV', icon: <Download />, onClick: run.exportCsv },
    { label: 'Download PDFs', icon: <FileDown />, onClick: run.downloadPdfs },
    ...(drafts > 0
      ? [
          {
            label: drafts === 1 ? 'Delete draft' : `Delete ${drafts} drafts`,
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
    title: `${invoice.number ?? 'Draft'} · ${invoice.client.name}`,
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
    chips.push({ label: `Client: ${client?.name ?? '…'}`, clear: { client: null } })
  if (params.credited)
    chips.push({ label: 'Credit notes of one invoice', clear: { credited: null } })
  if (params.from || params.to)
    chips.push({
      label: `Issued ${params.from ? formatDay(params.from) : '…'} – ${params.to ? formatDay(params.to) : 'today'}`,
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
            aria-label={`Remove filter ${chip.label}`}
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
        <Button variant="ghost" size="sm" className="text-[15px] font-normal">
          <ListFilter className="stroke-[1.5]" /> Filters
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
              <legend className="px-2 pb-1 text-xs text-muted-foreground">Status</legend>
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
              <legend className="px-2 pb-1 text-xs text-muted-foreground">Client</legend>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs hover:bg-muted/60"
                >
                  <span className={cn('truncate', !params.client && 'text-muted-foreground')}>
                    {params.client ? (client?.name ?? 'Loading…') : 'Any client'}
                  </span>
                  {!params.client && <Search className="size-3.5 text-muted-foreground" />}
                </button>
                {params.client && (
                  <button
                    type="button"
                    aria-label="Any client"
                    onClick={() => onChange({ client: null })}
                    className="absolute top-2 right-2 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="px-2 pb-1 text-xs text-muted-foreground">Issue date</legend>
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
                  aria-label="Issued from"
                  value={params.from ?? ''}
                  max={params.to ?? undefined}
                  onChange={(event) => onChange({ from: event.target.value || null })}
                  className="h-8 rounded-md border border-input bg-card px-2 text-[13px] tabular-nums shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                />
                <input
                  type="date"
                  aria-label="Issued to"
                  value={params.to ?? ''}
                  min={params.from ?? undefined}
                  onChange={(event) => onChange({ to: event.target.value || null })}
                  className="h-8 rounded-md border border-input bg-card px-2 text-[13px] tabular-nums shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
                Clear filters
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
        className="h-[58px] cursor-pointer border-b border-border/50 transition-colors duration-150 last:border-0 hover:bg-muted/40 data-open:bg-muted/50 data-selected:bg-muted/50"
      >
        <td className="pl-5">
          <Checkbox
            aria-label={`Select ${invoice.number ?? 'draft'} for ${invoice.client.name}`}
            className="bg-card"
            checked={selected}
            onCheckedChange={() => act.toggle(invoice.id)}
          />
        </td>
        {COLUMNS.map((column) => (
          <td
            key={column.id}
            className={cn(
              'truncate px-3',
              column.align === 'right' && 'text-right',
              column.wide && 'hidden @6xl:table-cell',
            )}
          >
            {column.cell(invoice)}
          </td>
        ))}
        <td className="pr-3 text-right">
          <RowMenuButton
            label={`Actions for ${invoice.number ?? 'draft'} · ${invoice.client.name}`}
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
        onPointerEnter={() => act.prefetch(invoice.id)}
        className="flex items-center gap-3 px-4 py-3 data-selected:bg-muted/50"
      >
        <Checkbox
          aria-label={`Select ${invoice.number ?? 'draft'} for ${invoice.client.name}`}
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
              {invoice.number && `${invoice.number} · `}due {formatDay(invoice.due_date)}
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
