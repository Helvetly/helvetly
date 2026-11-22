'use client'

import { locale, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DataTable, listTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { DropdownMenuItem, DropdownMenuSeparator } from '@helvetly/ui/components/dropdown-menu'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { usePageSize } from '@helvetly/ui/lib/table-storage'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, Download, FileDown, FilePlus2, ReceiptText, SearchX, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  type ComponentProps,
  memo,
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
import { ClientFilter } from '@/components/data/client-filter'
import { ListFilters } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import {
  dropdownKit,
  PageContextMenu,
  RowContextMenu,
  RowMenuButton,
  type MenuKit,
  type RowMenuSpec,
} from '@/components/data/menus'
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { Initials } from '@/components/initials'
import {
  RecordDrawersContext,
  RecordReplaceContext,
  type DrawerRef,
} from '@/components/record-link'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import {
  displayStatus,
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
  LIST_STATUSES,
  type ListParams,
  type ListStatus,
  type SortField,
  invoiceQuery,
} from '@/lib/invoices'
import { among, oneValue, type QueryField } from '@/lib/list-query'
import { useCan } from '@/lib/permissions'
import { usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

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

/** Which list sort each sortable column asks for. */
const SORTS: Partial<Record<string, SortField>> = {
  number: 'number',
  client: 'client',
  issued: 'issue_date',
  due: 'due_date',
  total: 'total',
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

function invoiceColumns(access: boolean, act: RowActions): DataColumn<InvoiceListItem>[] {
  return [
    {
      id: 'number',
      header: translate('number'),
      size: 128,
      minSize: 96,
      sortable: true,
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
      header: translate('client'),
      flex: true,
      sortable: true,
      cell: (invoice) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Initials name={invoice.client.name} />
          <span className="truncate">{invoice.client.name}</span>
        </span>
      ),
    },
    {
      id: 'issued',
      header: translate('issued4'),
      size: 128,
      minSize: 100,
      sortable: true,
      sortDescFirst: true,
      showFrom: 1100,
      cell: (invoice) => (
        <span className="text-muted-foreground">{formatDay(invoice.issue_date)}</span>
      ),
    },
    {
      id: 'due',
      header: translate('due'),
      size: 128,
      minSize: 112,
      sortable: true,
      sortDescFirst: true,
      cell: (invoice) => <DueCell invoice={invoice} />,
    },
    {
      id: 'total',
      header: translate('amount'),
      size: 180,
      minSize: 112,
      sortable: true,
      sortDescFirst: true,
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
      header: translate('status'),
      size: 132,
      resizable: false,
      cell: (invoice) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <RowStatus invoice={invoice} />
        </span>
      ),
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      size: 48,
      resizable: false,
      cell: (invoice) => (
        <RowMenuButton
          label={translate('actionsFor2', {
            value1: invoice.number ?? translate('draft4'),
            name: invoice.client.name,
          })}
          menu={invoiceMenu(invoice, access, act.command)}
        />
      ),
    },
  ]
}

/** The invoices list: server-side search, filters, sort and paging, all kept in the URL. */
export function InvoicesPage() {
  const canWrite = useCan('write:invoices')
  const importDrawer = useImportDrawer()
  const pathname = usePathname()
  const urlQuery = useSearchParams()
  // On the older /invoices/new and /invoices/edit URLs the query belongs to the editor, not the list.
  const legacy = isLegacyEditorPath(pathname)
  const query = legacy ? new URLSearchParams() : urlQuery
  const listPath = legacy ? '/invoices' : pathname
  const compose = canWrite ? parseCompose(pathname, urlQuery) : null
  const [pageSize, setPageSize] = usePageSize('invoices')
  const params = { ...parseListParams(query), pageSize }
  const openId = query.get('id')
  const canManage = canManageInvoices(useSession().data?.role)
  const queryClient = useQueryClient()

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [deleting, setDeleting] = useState<InvoiceListItem[] | null>(null)
  const [deriving, setDeriving] = useState<DeriveFrom | null>(null)
  const list = useInvoiceList(params)
  const queryFields = useQueryFields(params)
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
  const showInPlace = useStableCallback((record: DrawerRef) => {
    if (record.kind !== 'invoice' || 'mode' in record) return openStacked?.(record)
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
    params.to !== null ||
    params.totalMin !== null ||
    params.totalMax !== null
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const selectedRows = rows.filter((row) => selected.has(row.id))
  const selectedDrafts = selectedRows.filter((row) => row.status === 'draft')
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
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
  const columns = useMemo(() => invoiceColumns(canManage, act), [canManage, act])
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
            <ListFilters
              fields={queryFields}
              params={params}
              onChange={update}
              custom={{
                client: (
                  <ClientFilter value={params.client} onChange={(client) => update({ client })} />
                ),
              }}
            />
            <ListSearch
              label={translate('searchInvoices')}
              placeholder={translate('searchNumberClientOrReference')}
              value={search}
              onChange={setSearch}
              query={{ fields: queryFields, params, onChange: update }}
            />
          </ListToolbar>

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
              <DataTable
                id="invoices"
                className="hidden @4xl:table"
                columns={columns}
                data={rows}
                getRowId={(invoice) => invoice.id}
                sorting={{
                  column: Object.keys(SORTS).find((column) => SORTS[column] === params.sort),
                  desc: params.desc,
                  onSort: (column, desc) => {
                    const field = SORTS[column]
                    if (field) update({ sort: field, desc })
                  },
                }}
                selection={{
                  selected,
                  onChange: setSelected,
                  allLabel: translate('selectAllInvoicesOnThisPage'),
                  rowLabel: (invoice) =>
                    translate('selectFor', {
                      value1: invoice.number ?? translate('draft4'),
                      name: invoice.client.name,
                    }),
                }}
                onRowClick={(invoice) => act.open(invoice.id)}
                rowProps={(invoice) => ({
                  'data-attention': displayStatus(invoice) === 'overdue' || undefined,
                  'data-open': invoice.id === openId || undefined,
                  onPointerEnter: () => act.prefetch(invoice.id),
                })}
                renderRow={(invoice, tr) => (
                  <RowContextMenu
                    menu={invoiceMenu(invoice, canManage, act.command)}
                    bulk={selected.has(invoice.id) ? selection : undefined}
                  >
                    {tr}
                  </RowContextMenu>
                )}
                pagination={
                  meta && {
                    page: meta.page,
                    pageSize,
                    total: meta.total,
                    onChange: (page, size) => {
                      setPageSize(size)
                      update({ page })
                    },
                  }
                }
                footer={
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
                }
              />
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

const day = (value: string | null) => (value ? [{ value, label: formatDay(value) }] : [])

/** The search's field terms: `status:`, `client:`, `from:`, `to:` and a link's `credited:`. */
function useQueryFields(params: ListParams): QueryField<ListParams>[] {
  const client = useClient(params.client).data
  return [
    {
      id: 'status',
      label: translate('status'),
      type: 'enum',
      values: STATUS_OPTIONS,
      tones: STATUS_TONES.invoice,
      placeholder: translate('anyStatus'),
      get: (current) => current.status,
      set: (status) => ({ status: among(LIST_STATUSES, status) }),
    },
    {
      id: 'client',
      label: translate('client'),
      type: 'enum',
      // shortcut: only the chosen client resolves by name; the Filters popover picks others.
      values: params.client ? [{ value: params.client, label: client?.name ?? '…' }] : [],
      placeholder: translate('anyClient'),
      ...oneValue(
        (current) => current.client,
        (value) => ({ client: value }),
      ),
    },
    {
      id: 'from',
      label: translate('issuedFrom'),
      type: 'date',
      values: day(params.from),
      placeholder: translate('anyIssueDate'),
      until: 'to',
      ...oneValue(
        (current) => current.from,
        (from) => ({ from }),
      ),
    },
    {
      id: 'to',
      label: translate('issuedUntil'),
      type: 'date',
      values: day(params.to),
      ...oneValue(
        (current) => current.to,
        (to) => ({ to }),
      ),
    },
    {
      id: 'credited',
      label: translate('creditNotesOfOneInvoice'),
      type: 'enum',
      values: params.credited ? [{ value: params.credited, label: '' }] : [],
      ...oneValue(
        (current) => current.credited,
        (credited) => ({ credited }),
      ),
    },
    {
      id: 'min',
      label: translate('minAmount'),
      type: 'number',
      placeholder: translate('minAmount'),
      until: 'max',
      ...oneValue(
        (current) => current.totalMin,
        (totalMin) => ({ totalMin }),
      ),
    },
    {
      id: 'max',
      label: translate('maxAmount'),
      type: 'number',
      ...oneValue(
        (current) => current.totalMax,
        (totalMax) => ({ totalMax }),
      ),
    },
  ]
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
              {invoice.number && (
                <>
                  <span className="font-code">{invoice.number}</span> ·{' '}
                </>
              )}
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
