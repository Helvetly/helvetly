'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DataTable, listTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { inputClass } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { usePageSize } from '@helvetly/ui/lib/table-storage'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  BookCheck,
  CircleCheck,
  CircleDashed,
  Copy,
  Download,
  FileUp,
  HandCoins,
  ListFilter,
  PanelRightOpen,
  Paperclip,
  Pencil,
  ReceiptText,
  SearchX,
  Tags,
  Trash2,
  Layers,
  ScanSearch,
  Clock,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { type ComponentProps, memo, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ApprovalInbox } from '@/components/approvals/approval-inbox'
import {
  ExportItem,
  FeatureLockNotice,
  unlessLocked,
  useFeatureLock,
} from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { LoadProblem } from '@/components/data/load-problem'
import {
  dropdownKit,
  PageContextMenu,
  RowContextMenu,
  RowMenuButton,
  type MenuKit,
  type RowMenuSpec,
} from '@/components/data/menus'
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { ExpenseCategoriesSheet } from '@/components/expenses/expense-categories-sheet'
import { handOffImport } from '@/components/import/hand-off'
import { useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { PageHeader } from '@/components/shell/page-header'
import { SwissScopeNotice } from '@/components/swiss-scope-notice'
import { isApprovalRequired, toastApprovalRequired } from '@/lib/approvals'
import { categoryLabel } from '@/lib/expense-categories'
import {
  canManageExpenses,
  DEFAULT_PARAMS,
  expensesApi,
  exportIdsUrl,
  exportUrl,
  listParamsToQuery,
  expenseListQuery,
  parseListParams,
  useBulkExpenses,
  useDeleteExpense,
  useExpenseAction,
  useExpenseCategories,
  useExpenseList,
  useExpenseSummary,
  type BulkAction,
  type Expense,
  type ListParams,
  type SortField,
  type View,
  expenseQuery,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { formatDay, formatMoney } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

import { ExpenseBadge } from './expense-bits'
import { ExpenseDetail, VoidDialog, type ExpenseCommand } from './expense-detail'
import { ExpenseForm } from './expense-form'
import { ExpenseKpis } from './expense-kpis'

const VIEWS: { label: string; icon: LucideIcon; view: View }[] = [
  { label: translate('all'), icon: Layers, view: 'all' },
  { label: translate('toReview'), icon: ScanSearch, view: 'review' },
  { label: translate('unpaid'), icon: Clock, view: 'unpaid' },
  { label: translate('toReimburse'), icon: HandCoins, view: 'reimburse' },
  { label: translate('void2'), icon: Ban, view: 'void' },
]

/** Which list sort each sortable column asks for. */
const SORTS: Partial<Record<string, SortField>> = {
  number: 'number',
  supplier: 'supplier',
  date: 'document_date',
  total: 'total',
}

const toggleIn = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

const BULK_DONE: Record<BulkAction, string> = {
  book: 'booked',
  mark_paid: translate('markedPaid'),
  mark_unpaid: translate('markedUnpaid'),
  mark_reimbursed: translate('markedReimbursed'),
  delete: 'deleted',
}

/** The expenses list: server-side search, filters, sort and paging, all kept in the URL. */
export function ExpensesPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const [pageSize, setPageSize] = usePageSize('expenses')
  const params = { ...parseListParams(query), pageSize }
  const openId = query.get('id')
  const canManage = canManageExpenses(useSession().data?.role)
  const canWrite = useCan('write:expenses')
  const lock = useFeatureLock('expenses')
  // a plan without expenses keeps the ones there are readable, but adds none
  const canAdd = canWrite && !lock

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState<{ expense?: Expense } | null>(null)
  const [deleting, setDeleting] = useState<Expense[] | null>(null)
  const [voiding, setVoiding] = useState<Expense | null>(null)

  const list = useExpenseList(params)
  const prefetch = usePrefetch(expenseQuery)
  const summary = useExpenseSummary()
  // The plain first page (shared with the list's own query when nothing is filtered).
  const unfiltered = useQuery(expenseListQuery(parseListParams(new URLSearchParams())))
  const bulk = useBulkExpenses()
  const remove = useDeleteExpense()
  const queryClient = useQueryClient()
  const book = useExpenseAction((id: string) => expensesApi.book(id))
  const duplicate = useExpenseAction((id: string) => expensesApi.duplicate(id))
  const voidIt = useExpenseAction(({ id, reason }: { id: string; reason: string }) =>
    expensesApi.void(id, reason),
  )

  const navigate = (next: URLSearchParams) => {
    setUrlQuery(pathname, next)
  }
  const update = (change: Partial<ListParams>) =>
    navigate(listParamsToQuery({ ...params, page: 1, ...change }, query))
  const openExpense = (id: string | null) => {
    const next = new URLSearchParams(query)
    if (id) next.set('id', id)
    else next.delete('id')
    navigate(next)
  }

  useEffect(() => {
    if (search === params.search) return
    const timer = setTimeout(() => update({ search }), 300)
    return () => clearTimeout(timer)
  })

  // "New expense" from Quick Actions arrives as ?new=1, which stays until the form closes.
  const isNew = query.get('new') === '1'
  const formState = form ?? (isNew ? {} : null)
  const closeForm = () => {
    setForm(null)
    if (!isNew) return
    const next = new URLSearchParams(query)
    next.delete('new')
    navigate(next)
  }

  const rows = list.data?.data ?? []
  const meta = list.data?.meta
  const filtered =
    Boolean(params.search) || params.categories.length > 0 || Boolean(params.from || params.to)
  // A workspace without expenses gets the welcome, not a band of zeros.
  const empty = rows.length === 0 && Boolean(list.data) && !filtered && params.view === 'all'
  // Whether the workspace has any expense at all, whatever is typed in the filters: the figures show only then.
  const noExpenses = unfiltered.data !== undefined && unfiltered.data.data.length === 0
  const viewIndex = VIEWS.findIndex((entry) => entry.view === params.view)
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const command = (name: ExpenseCommand, expense: Expense) => {
    if (name === 'edit') setForm({ expense })
    if (name === 'delete') setDeleting([expense])
    if (name === 'void') setVoiding(expense)
    if (name === 'mark_paid' || name === 'mark_unpaid' || name === 'mark_reimbursed')
      runBulk(name, [expense.id])
    if (name === 'book')
      book.mutate(expense.id, {
        onSuccess: (saved) => toast.success(translate('expenseBooked', { number: saved.number })),
        onError: (error) =>
          isApprovalRequired(error)
            ? toastApprovalRequired(queryClient, expense.id, 'expenses')
            : toastError(error),
      })
    if (name === 'duplicate')
      duplicate.mutate(expense.id, {
        onSuccess: (copy) => {
          toast.success(translate('copiedAsDraft', { number: copy.number }))
          openExpense(copy.id)
        },
        onError: toastError,
      })
  }

  const runBulk = (action: BulkAction, ids = [...selected]) =>
    bulk.mutate(
      { ids, action },
      {
        onSuccess: ({ updated, skipped }) => {
          const noun = updated === 1 ? 'expense' : 'expenses'
          if (updated) toast.success(`${updated} ${noun} ${BULK_DONE[action]}.`)
          if (skipped.length)
            toast.warning(
              translate('skipped', {
                length: skipped.length,
                value2: [...new Set(skipped.map((skip) => skip.reason))].join(' '),
              }),
            )
          // Only what was acted on leaves the selection: a single row's action keeps the rest.
          setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))))
          if (action === 'delete' && ids.includes(openId ?? '')) openExpense(null)
        },
        onError: toastError,
      },
    )

  const confirmDelete = (approved: boolean) => {
    const targets = deleting ?? []
    setDeleting(null)
    if (!approved) return
    if (targets.length === 1 && targets[0]) {
      const target = targets[0]
      remove.mutate(target.id, {
        onSuccess: () => {
          toast.success(translate('draftDeleted', { number: target.number }))
          setSelected(new Set())
          if (target.id === openId) openExpense(null)
        },
        onError: toastError,
      })
    } else
      runBulk(
        'delete',
        targets.map((expense) => expense.id),
      )
  }

  // Receipts go through the AI import: read into drafts that are reviewed in its drawer, then land in "To review".
  const importDrawer = useImportDrawer()
  const [managingCategories, setManagingCategories] = useState(false)
  const importReceipts = importDrawer.open
  // Dropping a file anywhere on the page reads it (not while a drawer is open).
  const dropping = useImportDrop('expenses', canAdd && !formState && !openId)

  const exportLock = useFeatureLock('data_export')
  const selection = {
    count: selected.size,
    actions: [
      {
        label: translate('book2'),
        icon: <BookCheck />,
        onClick: () => runBulk('book'),
        write: true,
      },
      {
        label: translate('markPaid2'),
        icon: <CircleCheck />,
        onClick: () => runBulk('mark_paid'),
        write: true,
      },
      {
        label: translate('markUnpaid2'),
        icon: <CircleDashed />,
        onClick: () => runBulk('mark_unpaid'),
        write: true,
      },
      {
        label: translate('exportCSV'),
        icon: <Download />,
        onClick: unlessLocked(exportLock, () =>
          window.location.assign(exportIdsUrl([...selected])),
        ),
      },
      {
        label: translate('deleteDrafts'),
        icon: <Trash2 />,
        onClick: () => setDeleting(rows.filter((row) => selected.has(row.id))),
        destructive: true,
        write: true,
      },
    ],
  }
  const pageItems = ({ Item }: MenuKit) => (
    <>
      {canAdd && (
        <Item onSelect={importReceipts}>
          <FileUp />
          {translate('importReceipts')}
        </Item>
      )}
      <ExportItem Item={Item} href={localizedHref(exportUrl(params))}>
        {translate('exportCSV')}
        {filtered || params.view !== 'all' ? translate('thisView') : ''}
      </ExportItem>
      {canManage && (
        <Item onSelect={() => setManagingCategories(true)}>
          <Tags />
          {translate('expenseCategories')}
        </Item>
      )}
    </>
  )
  const access = useMemo(() => ({ canManage, canWrite }), [canManage, canWrite])
  const open = useStableCallback(openExpense)
  const toggle = useStableCallback(toggleRow)
  const run = useStableCallback(command)
  const act = useMemo<RowActions>(
    () => ({ open, toggle, prefetch, command: run }),
    [open, toggle, prefetch, run],
  )
  const columns = useMemo(() => expenseColumns(access, act), [access, act])

  return (
    <>
      <PageHeader
        tabs={VIEWS.map((entry) => entry.label)}
        tabIcons={VIEWS.map((entry) => entry.icon)}
        tabCounts={VIEWS.map((entry) =>
          entry.view !== 'all' && entry.view !== 'void'
            ? summary.data?.views[entry.view]
            : undefined,
        )}
        savedViews={false}
        active={viewIndex}
        onSelect={(index) => update({ view: VIEWS[index]?.view ?? 'all' })}
        primary={canAdd ? translate('newExpense') : undefined}
        onPrimary={() => setForm({})}
        menu={pageItems(dropdownKit)}
      />
      <FeatureLockNotice
        lock={lock}
        kept={translate('expensesYouAlreadyHaveStayAvailableToRead')}
        className="mx-4 mt-4 sm:mx-6"
      />
      <SwissScopeNotice area="expenses" className="mx-4 mt-4 sm:mx-6" />
      <ApprovalInbox doc="expenses" onOpen={openExpense} />
      {!empty && !noExpenses && <ExpenseKpis />}
      {dropping && <DropOverlay title={translate('dropToReadTheseReceiptsIntoDraftExpenses')} />}
      <PageContextMenu
        title={translate('expenses')}
        primary={{ label: translate('newExpense'), onSelect: () => setForm({}) }}
        items={pageItems}
        views={{
          tabs: VIEWS.map((entry) => entry.label),
          active: viewIndex,
          onSelect: (index) => update({ view: VIEWS[index]?.view ?? 'all' }),
        }}
        selectAll={
          rows.length && !allSelected
            ? { onSelect: () => setSelected(new Set(rows.map((row) => row.id))) }
            : undefined
        }
        onRefresh={() => void list.refetch()}
      >
        <div className="relative flex flex-1 flex-col">
          <ListToolbar>
            <Filters params={params} onChange={update} />
            <ListSearch
              label={translate('searchExpenses')}
              placeholder={translate('searchSupplierDescriptionReferenceOrNumber')}
              value={search}
              onChange={setSearch}
            />
          </ListToolbar>

          {list.error ? (
            <LoadProblem
              error={list.error}
              what={translate('yourExpenses')}
              onRetry={() => void list.refetch()}
            />
          ) : !list.data ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            filtered ? (
              <State
                icon={<SearchX />}
                title={
                  params.search
                    ? translate('noExpensesMatch', { search: params.search })
                    : translate('noExpensesMatchTheseFilters')
                }
                text={translate('tryAnotherSearchOrClearTheFilters')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => {
                      setSearch('')
                      update({ search: '', categories: [], from: '', to: '' })
                    }}
                  >
                    {translate('clearSearchAndFilters')}
                  </Button>
                }
              />
            ) : params.view !== 'all' ? (
              <State
                icon={<CircleCheck />}
                title={EMPTY_VIEW[params.view].title}
                text={EMPTY_VIEW[params.view].text}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => update({ view: 'all' })}
                  >
                    {translate('showAllExpenses')}
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-14">
                <div className="grid w-full max-w-md justify-items-center text-center">
                  <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-card shadow-[0_10px_30px_-8px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-foreground/10">
                    <ReceiptText className="size-6 stroke-[1.5]" />
                  </span>
                  <p className="text-[17px] font-medium tracking-[-0.01em]">
                    {translate('noExpensesYet')}
                  </p>
                  <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
                    {translate('recordWhatTheBusinessSpendsWithTheReceiptThe')}
                  </p>
                  {canAdd && (
                    <div className="mt-5">
                      <EmptyImportActions
                        importLabel={translate('importReceipts')}
                        hint={translate('orDropAReceiptAnywhereOnThisPage')}
                        onImport={importReceipts}
                      >
                        <Button size="sm" className="cursor-pointer" onClick={() => setForm({})}>
                          {translate('addExpense')}
                        </Button>
                      </EmptyImportActions>
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            <div
              className={cn(
                'transition-opacity duration-150',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              <DataTable
                id="expenses"
                className="hidden @4xl:table"
                columns={columns}
                data={rows}
                getRowId={(expense) => expense.id}
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
                  allLabel: translate('selectAllExpensesOnThisPage'),
                  rowLabel: (expense) => translate('selectExpense', { number: expense.number }),
                }}
                onRowClick={(expense) => act.open(expense.id)}
                rowProps={(expense) => ({ onPointerEnter: () => act.prefetch(expense.id) })}
                renderRow={(expense, tr) => (
                  <RowContextMenu
                    menu={expenseMenu(expense, access, () => act.open(expense.id), act.command)}
                    bulk={selected.has(expense.id) ? selection : undefined}
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
                    {rows.map((expense) => (
                      <ExpenseItem
                        key={expense.id}
                        expense={expense}
                        selected={selected.has(expense.id)}
                        bulk={selected.has(expense.id) ? selection : undefined}
                        access={access}
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

      {openId && (
        <ExpenseDetail
          key={`detail:${openId}`}
          id={openId}
          canManage={canManage}
          onClose={() => openExpense(null)}
          onCommand={command}
        />
      )}
      {importDrawer.isOpen && <ImportDrawer kind="expenses" onClose={importDrawer.close} />}
      {managingCategories && (
        <ExpenseCategoriesSheet onClose={() => setManagingCategories(false)} />
      )}
      {formState && (
        <ExpenseForm
          key={`form:${formState.expense?.id ?? 'new'}`}
          expense={formState.expense}
          start={!formState.expense}
          onImport={(files) => {
            // One navigation: the form's ?new=1 goes as the import's ?import=1 comes.
            handOffImport('expenses', files)
            setForm(null)
            const next = new URLSearchParams(query)
            next.delete('new')
            next.set('import', '1')
            navigate(next)
          }}
          onClose={closeForm}
          onSaved={(expense, created) => {
            setForm(null)
            if (!created) return
            const next = new URLSearchParams(query)
            next.delete('new')
            next.set('id', expense.id)
            navigate(next)
          }}
        />
      )}
      {deleting && deleting.length > 0 && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? translate('deleteDraft3', { value1: deleting[0]?.number })
              : translate('deleteExpenses', { length: deleting.length })
          }
          body={translate('onlyDraftsAreDeletedBookedExpensesAreKeptAnd')}
          confirmLabel={
            deleting.length === 1
              ? translate('deleteDraft2')
              : translate('delete6', { length: deleting.length })
          }
          tone="destructive"
          onDecide={confirmDelete}
        />
      )}
      {voiding && (
        <VoidDialog
          expense={voiding}
          pending={voidIt.isPending}
          onClose={() => setVoiding(null)}
          onVoid={(reason) =>
            voidIt.mutate(
              { id: voiding.id, reason },
              {
                onSuccess: (saved) => {
                  setVoiding(null)
                  toast.success(translate('expenseVoided', { number: saved.number }))
                },
                onError: toastError,
              },
            )
          }
        />
      )}
    </>
  )
}

const EMPTY_VIEW: Record<Exclude<View, 'all'>, { title: string; text: string }> = {
  review: {
    title: translate('nothingToReview'),
    text: translate('everyDraftIsBookedNewExpensesWaitHereUntil'),
  },
  unpaid: {
    title: translate('everythingIsPaid'),
    text: translate('supplierInvoicesYouStillOweShowUpHereWith'),
  },
  reimburse: {
    title: translate('nothingToPayBack'),
    text: translate('expensesAMemberPaidOutOfPocketWaitHere'),
  },
  void: {
    title: translate('nothingVoided'),
    text: translate('voidedExpensesStayOnRecordHereWithTheReason'),
  },
}

/** An expense's actions, for its "…" button and its right-click menu. */
function expenseMenu(
  expense: Expense,
  can: { canManage: boolean; canWrite: boolean },
  onOpen: () => void,
  onCommand: (command: ExpenseCommand, expense: Expense) => void,
): RowMenuSpec {
  const live = expense.status !== 'void'
  const draft = expense.status === 'draft'
  const canVoid = expense.status === 'booked' && can.canManage
  return {
    title: `#${expense.number} · ${expense.supplier_name ?? translate('noSupplier')}`,
    items: ({ Item, Separator }) => (
      <>
        <Item onSelect={onOpen}>
          <PanelRightOpen />
          {translate('openDetails')}
        </Item>
        {can.canWrite && (
          <>
            {live && (
              <Item onSelect={() => onCommand('edit', expense)}>
                <Pencil />
                {translate('edit4')}
              </Item>
            )}
            {draft && (
              <Item disabled={!expense.is_complete} onSelect={() => onCommand('book', expense)}>
                <BookCheck />
                {translate('book')}
              </Item>
            )}
            <Item onSelect={() => onCommand('duplicate', expense)}>
              <Copy />
              {translate('duplicate')}
            </Item>
            {live && (
              <>
                <Separator />
                {expense.payment_status === 'unpaid' ? (
                  <Item onSelect={() => onCommand('mark_paid', expense)}>
                    <CircleCheck />
                    {translate('markPaid')}
                  </Item>
                ) : (
                  <Item onSelect={() => onCommand('mark_unpaid', expense)}>
                    <CircleDashed />
                    {translate('markUnpaid')}
                  </Item>
                )}
                {expense.paid_by_member && !expense.reimbursed_on && (
                  <Item onSelect={() => onCommand('mark_reimbursed', expense)}>
                    <HandCoins />
                    {translate('markReimbursed')}
                  </Item>
                )}
              </>
            )}
            {(draft || canVoid) && <Separator />}
            {canVoid && (
              <Item variant="destructive" onSelect={() => onCommand('void', expense)}>
                <Ban />
                {translate('void')}
              </Item>
            )}
            {draft && (
              <Item variant="destructive" onSelect={() => onCommand('delete', expense)}>
                <Trash2 />
                {translate('deleteDraft')}
              </Item>
            )}
          </>
        )}
      </>
    ),
  }
}

function Filters({
  params,
  onChange,
}: {
  params: ListParams
  onChange: (change: Partial<ListParams>) => void
}) {
  const categories = useExpenseCategories()
  const count = params.categories.length + (params.from || params.to ? 1 : 0)
  const dateClass = cn(inputClass, 'cursor-text px-2 tabular-nums')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer text-title-sm font-normal">
          <ListFilter className="stroke-[1.5]" />
          {translate('filters')}
          {count > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid max-h-[70svh] w-80 gap-3 overflow-y-auto p-3">
        <fieldset className="grid gap-1.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">
            {translate('receiptDate')}
          </legend>
          <div className="grid grid-cols-2 gap-2 px-1">
            <input
              type="date"
              aria-label={translate('from')}
              value={params.from}
              max={params.to || undefined}
              onChange={(event) => onChange({ from: event.target.value })}
              className={dateClass}
            />
            <input
              type="date"
              aria-label={translate('to3')}
              value={params.to}
              min={params.from || undefined}
              onChange={(event) => onChange({ to: event.target.value })}
              className={dateClass}
            />
          </div>
        </fieldset>
        <fieldset className="grid gap-0.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">
            {translate('category')}
          </legend>
          {(categories.data ?? []).map((category) => (
            <label
              key={category.id}
              className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted [&_[role=checkbox]]:bg-card"
            >
              <Checkbox
                checked={params.categories.includes(category.id)}
                onCheckedChange={() =>
                  onChange({ categories: toggleIn(params.categories, category.id) })
                }
              />
              <span className="min-w-0 flex-1 truncate">{categoryLabel(category)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {category.account_code}
              </span>
            </label>
          ))}
        </fieldset>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer justify-self-start text-muted-foreground"
            onClick={() => onChange({ categories: DEFAULT_PARAMS.categories, from: '', to: '' })}
          >
            {translate('clearFilters')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

type RowProps = {
  expense: Expense
  selected: boolean
  bulk: ComponentProps<typeof RowContextMenu>['bulk']
  access: { canManage: boolean; canWrite: boolean }
  act: RowActions
}

/** Stable across the page's renders, so opening a drawer re-renders no row. */
type RowActions = {
  open: (id: string) => void
  toggle: (id: string) => void
  prefetch: (id: string) => void
  command: (name: ExpenseCommand, expense: Expense) => void
}

function expenseColumns(access: RowProps['access'], act: RowActions): DataColumn<Expense>[] {
  return [
    {
      id: 'number',
      header: translate('no'),
      size: 72,
      minSize: 56,
      sortable: true,
      sortDescFirst: true,
      className: 'font-code text-muted-foreground',
      cell: (expense) => `#${expense.number}`,
    },
    {
      id: 'supplier',
      header: translate('supplier'),
      flex: true,
      sortable: true,
      cell: (expense) => (
        <span className="grid min-w-0 leading-tight">
          <span className="truncate" title={expense.supplier_name ?? undefined}>
            {expense.supplier_name ?? (
              <span className="text-muted-foreground">{translate('noSupplier')}</span>
            )}
          </span>
          {expense.description && (
            <span
              className="truncate text-caption text-muted-foreground"
              title={expense.description}
            >
              {expense.description}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'category',
      header: translate('category'),
      size: 200,
      minSize: 112,
      showFrom: 1100,
      cell: (expense) =>
        expense.category ? (
          <span className="grid min-w-0 leading-tight">
            <span className="truncate" title={categoryLabel(expense.category)}>
              {categoryLabel(expense.category)}
            </span>
            <span className="text-caption text-muted-foreground tabular-nums">
              {expense.category.account_code}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'date',
      header: translate('date'),
      size: 124,
      minSize: 100,
      sortable: true,
      sortDescFirst: true,
      className: 'text-muted-foreground tabular-nums',
      cell: (expense) => (expense.document_date ? formatDay(expense.document_date) : '—'),
    },
    {
      id: 'total',
      header: translate('amount'),
      size: 150,
      minSize: 100,
      sortable: true,
      sortDescFirst: true,
      align: 'right',
      cell: (expense) => formatMoney(expense.total, expense.currency),
    },
    {
      id: 'status',
      header: translate('status'),
      size: 132,
      resizable: false,
      cell: (expense) => <ExpenseBadge expense={expense} />,
    },
    {
      id: 'receipt',
      header: translate('receipt'),
      size: 76,
      resizable: false,
      cell: (expense) =>
        expense.receipts_count > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-caption text-muted-foreground tabular-nums"
            title={translate('receiptsAttached2')}
          >
            <Paperclip className="size-3.5" /> {expense.receipts_count}
          </span>
        ) : expense.receipt_missing_reason ? (
          <span
            className="text-caption text-muted-foreground"
            title={expense.receipt_missing_reason}
          >
            {translate('substitute')}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-caption text-[#a05c5c] dark:text-rose-300"
            title={translate('noReceiptYet')}
          >
            <CircleDashed className="size-3.5" />
            {translate('none3')}
          </span>
        ),
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      size: 48,
      resizable: false,
      cell: (expense) => (
        <RowMenuButton
          label={translate('actionsForExpense', { number: expense.number })}
          menu={expenseMenu(expense, access, () => act.open(expense.id), act.command)}
        />
      ),
    },
  ]
}

const ExpenseItem = memo(function ExpenseItem({ expense, selected, bulk, access, act }: RowProps) {
  const menu = expenseMenu(expense, access, () => act.open(expense.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(expense.id)}
        className={listTable.item}
      >
        <Checkbox
          aria-label={translate('selectExpense', { number: expense.number })}
          className="cursor-pointer bg-card"
          checked={selected}
          onCheckedChange={() => act.toggle(expense.id)}
        />
        <button
          type="button"
          onClick={() => act.open(expense.id)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        >
          <span className="grid min-w-0 flex-1 leading-snug">
            <span className="truncate text-[15px]">
              {expense.supplier_name ?? translate('noSupplier')}
            </span>
            <span className="truncate text-[13px] text-muted-foreground">
              {[
                expense.document_date && formatDay(expense.document_date),
                expense.category && categoryLabel(expense.category),
              ]
                .filter(Boolean)
                .join(' · ') || `#${expense.number}`}
            </span>
          </span>
          <span className="grid shrink-0 justify-items-end gap-1">
            <span className="text-[14px] whitespace-nowrap tabular-nums">
              {formatMoney(expense.total, expense.currency)}
            </span>
            <ExpenseBadge expense={expense} />
          </span>
        </button>
      </li>
    </RowContextMenu>
  )
})
