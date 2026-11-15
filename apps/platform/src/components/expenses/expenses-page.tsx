'use client'

import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  BookCheck,
  ChevronLeft,
  ChevronRight,
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
  Search,
  SearchX,
  Trash2,
  Upload,
  Layers,
  ScanSearch,
  Clock,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { type ComponentProps, memo, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
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
import { handOffImport } from '@/components/import/hand-off'
import { useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { addFiles } from '@/components/import/import-files'
import { PageHeader } from '@/components/shell/page-header'
import {
  canManageExpenses,
  DEFAULT_PARAMS,
  expensesApi,
  isHeic,
  exportIdsUrl,
  exportUrl,
  listParamsToQuery,
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
  { label: 'All', icon: Layers, view: 'all' },
  { label: 'To review', icon: ScanSearch, view: 'review' },
  { label: 'Unpaid', icon: Clock, view: 'unpaid' },
  { label: 'To reimburse', icon: HandCoins, view: 'reimburse' },
  { label: 'Void', icon: Ban, view: 'void' },
]

const COLUMNS: {
  id: string
  label: string
  width: string
  sort?: SortField
  align?: 'right'
  wide?: boolean
}[] = [
  { id: 'number', label: 'No.', width: 'w-[72px]', sort: 'number' },
  { id: 'supplier', label: 'Supplier', width: 'w-[30%]', sort: 'supplier' },
  { id: 'category', label: 'Category', width: 'w-[20%]', wide: true },
  { id: 'date', label: 'Date', width: 'w-[124px]', sort: 'document_date' },
  { id: 'total', label: 'Amount', width: 'w-[150px]', sort: 'total', align: 'right' },
  { id: 'status', label: 'Status', width: 'w-[132px]' },
  { id: 'receipt', label: 'Receipt', width: 'w-[76px]' },
]

const toggleIn = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

const BULK_DONE: Record<BulkAction, string> = {
  book: 'booked',
  mark_paid: 'marked paid',
  mark_unpaid: 'marked unpaid',
  mark_reimbursed: 'marked reimbursed',
  delete: 'deleted',
}

/** The expenses list: server-side search, filters, sort and paging, all kept in the URL. */
export function ExpensesPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const openId = query.get('id')
  const canManage = canManageExpenses(useSession().data?.role)
  const canWrite = useCan('write:expenses')

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState<{ expense?: Expense } | null>(null)
  const [deleting, setDeleting] = useState<Expense[] | null>(null)
  const [voiding, setVoiding] = useState<Expense | null>(null)

  const list = useExpenseList(params)
  const prefetch = usePrefetch(expenseQuery)
  const summary = useExpenseSummary()
  const bulk = useBulkExpenses()
  const remove = useDeleteExpense()
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
        onSuccess: (saved) => toast.success(`Expense #${saved.number} booked.`),
        onError: toastError,
      })
    if (name === 'duplicate')
      duplicate.mutate(expense.id, {
        onSuccess: (copy) => {
          toast.success(`Copied as draft #${copy.number}.`)
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
              `${skipped.length} skipped: ${[...new Set(skipped.map((skip) => skip.reason))].join(' ')}`,
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
          toast.success(`Draft #${target.number} deleted.`)
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

  const sortBy = (field: SortField) =>
    update({ sort: field, desc: params.sort === field ? !params.desc : field !== 'supplier' })
  // Receipts go through the AI import: read into drafts that are reviewed in its drawer, then land in "To review".
  const importDrawer = useImportDrawer()
  const uploadReceipts = importDrawer.open
  const startWith = (dropped: File[]) => {
    const heic = dropped.filter(isHeic)
    if (heic.length)
      toast.error(
        `${heic.map((file) => file.name).join(', ')}: HEIC photos can’t be read by the AI. Export them as JPEG, or attach them to a New expense.`,
      )
    const { files, note } = addFiles(
      [],
      dropped.filter((file) => !isHeic(file)),
    )
    if (note) toast.error(note)
    if (!files.length) return
    handOffImport('expenses', files)
    importDrawer.open()
  }
  // Dropping a file anywhere on the page reads it (not while a drawer is open).
  const dropping = useFileDrop(canWrite && !formState && !openId && !importDrawer.isOpen, startWith)

  const selection = {
    count: selected.size,
    actions: [
      { label: 'Book', icon: <BookCheck />, onClick: () => runBulk('book'), write: true },
      {
        label: 'Mark paid',
        icon: <CircleCheck />,
        onClick: () => runBulk('mark_paid'),
        write: true,
      },
      {
        label: 'Mark unpaid',
        icon: <CircleDashed />,
        onClick: () => runBulk('mark_unpaid'),
        write: true,
      },
      {
        label: 'Export CSV',
        icon: <Download />,
        onClick: () => window.location.assign(exportIdsUrl([...selected])),
      },
      {
        label: 'Delete drafts',
        icon: <Trash2 />,
        onClick: () => setDeleting(rows.filter((row) => selected.has(row.id))),
        destructive: true,
        write: true,
      },
    ],
  }
  const pageItems = ({ Item }: MenuKit) => (
    <>
      {canWrite && (
        <Item onSelect={uploadReceipts}>
          <FileUp /> Upload receipts
        </Item>
      )}
      <Item asChild>
        <a href={exportUrl(params)} download>
          <Download /> Export CSV{filtered || params.view !== 'all' ? ' (this view)' : ''}
        </a>
      </Item>
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
        primary="New expense"
        onPrimary={() => setForm({})}
        menu={pageItems(dropdownKit)}
      />
      {!empty && <ExpenseKpis />}
      {dropping && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px]"
        >
          <div className="grid justify-items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-card px-12 py-10 text-center shadow-elevation-2">
            <Upload className="size-6 stroke-[1.5]" />
            <p className="text-[15px] font-medium">
              Drop to read these receipts into draft expenses
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, photos or spreadsheets · up to 10 files of 25 MB, 95 MB in all · you review them
              first
            </p>
          </div>
        </div>
      )}
      <PageContextMenu
        title="Expenses"
        primary={{ label: 'New expense', onSelect: () => setForm({}) }}
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
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:px-3">
            <Filters params={params} onChange={update} />
            <label className="flex h-8 min-w-0 flex-1 cursor-text items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:text-foreground">
              <Search className="size-4 shrink-0 stroke-[1.5]" />
              <input
                type="search"
                aria-label="Search expenses"
                placeholder="Search supplier, description, reference or #number"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent text-[15px] text-foreground outline-none placeholder:text-placeholder"
              />
            </label>
          </div>

          {list.error ? (
            <LoadProblem
              error={list.error}
              what="Your expenses"
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
                    ? `No expenses match “${params.search}”`
                    : 'No expenses match these filters'
                }
                text="Try another search or clear the filters."
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
                    Clear search and filters
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
                    Show all expenses
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-14">
                <div className="grid w-full max-w-md justify-items-center text-center">
                  <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-card shadow-[0_10px_30px_-8px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-foreground/10">
                    <ReceiptText className="size-6 stroke-[1.5]" />
                  </span>
                  <p className="text-[17px] font-medium tracking-[-0.01em]">No expenses yet</p>
                  <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
                    Record what the business spends, with the receipt: the reclaimable VAT is worked
                    out for you.
                  </p>
                  {canWrite && (
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <Button size="sm" className="cursor-pointer" onClick={() => setForm({})}>
                        Add expense
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        onClick={uploadReceipts}
                      >
                        <FileUp /> Upload receipts
                      </Button>
                    </div>
                  )}
                  {canWrite && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      or drop a receipt anywhere on this page
                    </p>
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
              <table className="hidden w-full table-fixed text-[15px] @4xl:table">
                <thead>
                  <tr className="h-11 border-b bg-muted/50 text-left text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
                    <th className="w-12 pl-5">
                      <Checkbox
                        aria-label="Select all expenses on this page"
                        className="cursor-pointer bg-card"
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
                                'inline-flex cursor-pointer items-center gap-1 uppercase hover:text-foreground',
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
                  {rows.map((expense) => (
                    <ExpenseRow
                      key={expense.id}
                      expense={expense}
                      selected={selected.has(expense.id)}
                      bulk={selected.has(expense.id) ? selection : undefined}
                      access={access}
                      act={act}
                    />
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-border/70 @4xl:hidden">
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
                      className="cursor-pointer"
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
                      className="cursor-pointer"
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
        <ExpenseDetail
          key={`detail:${openId}`}
          id={openId}
          canManage={canManage}
          onClose={() => openExpense(null)}
          onCommand={command}
        />
      )}
      {importDrawer.isOpen && <ImportDrawer kind="expenses" onClose={importDrawer.close} />}
      {formState && (
        <ExpenseForm
          key={`form:${formState.expense?.id ?? 'new'}`}
          expense={formState.expense}
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
              ? `Delete draft #${deleting[0]?.number}?`
              : `Delete ${deleting.length} expenses?`
          }
          body="Only drafts are deleted; booked expenses are kept and skipped. Their receipts go with them."
          confirmLabel={deleting.length === 1 ? 'Delete draft' : `Delete ${deleting.length}`}
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
                  toast.success(`Expense #${saved.number} voided.`)
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
    title: 'Nothing to review',
    text: 'Every draft is booked. New expenses wait here until they are complete.',
  },
  unpaid: {
    title: 'Everything is paid',
    text: 'Supplier invoices you still owe show up here with their due date.',
  },
  reimburse: {
    title: 'Nothing to pay back',
    text: 'Expenses a member paid out of pocket wait here until reimbursed.',
  },
  void: { title: 'Nothing voided', text: 'Voided expenses stay on record here, with the reason.' },
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
    title: `#${expense.number} · ${expense.supplier_name ?? 'No supplier'}`,
    items: ({ Item, Separator }) => (
      <>
        <Item onSelect={onOpen}>
          <PanelRightOpen /> Open details
        </Item>
        {can.canWrite && (
          <>
            {live && (
              <Item onSelect={() => onCommand('edit', expense)}>
                <Pencil /> Edit
              </Item>
            )}
            {draft && (
              <Item disabled={!expense.is_complete} onSelect={() => onCommand('book', expense)}>
                <BookCheck /> Book
              </Item>
            )}
            <Item onSelect={() => onCommand('duplicate', expense)}>
              <Copy /> Duplicate
            </Item>
            {live && (
              <>
                <Separator />
                {expense.payment_status === 'unpaid' ? (
                  <Item onSelect={() => onCommand('mark_paid', expense)}>
                    <CircleCheck /> Mark paid
                  </Item>
                ) : (
                  <Item onSelect={() => onCommand('mark_unpaid', expense)}>
                    <CircleDashed /> Mark unpaid
                  </Item>
                )}
                {expense.paid_by_member && !expense.reimbursed_on && (
                  <Item onSelect={() => onCommand('mark_reimbursed', expense)}>
                    <HandCoins /> Mark reimbursed
                  </Item>
                )}
              </>
            )}
            {(draft || canVoid) && <Separator />}
            {canVoid && (
              <Item variant="destructive" onSelect={() => onCommand('void', expense)}>
                <Ban /> Void…
              </Item>
            )}
            {draft && (
              <Item variant="destructive" onSelect={() => onCommand('delete', expense)}>
                <Trash2 /> Delete draft
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
  const dateClass =
    'h-8 w-full min-w-0 cursor-text rounded-md border border-input bg-card px-2 text-sm tabular-nums outline-none focus-visible:border-ring dark:bg-input/30'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer text-[15px] font-normal">
          <ListFilter className="stroke-[1.5]" /> Filters
          {count > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid max-h-[70svh] w-80 gap-3 overflow-y-auto p-3">
        <fieldset className="grid gap-1.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">Receipt date</legend>
          <div className="grid grid-cols-2 gap-2 px-1">
            <input
              type="date"
              aria-label="From"
              value={params.from}
              max={params.to || undefined}
              onChange={(event) => onChange({ from: event.target.value })}
              className={dateClass}
            />
            <input
              type="date"
              aria-label="To"
              value={params.to}
              min={params.from || undefined}
              onChange={(event) => onChange({ to: event.target.value })}
              className={dateClass}
            />
          </div>
        </fieldset>
        <fieldset className="grid gap-0.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">Category</legend>
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
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
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
            Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Whether files are being dragged over the window; dropping them calls onFiles. */
function useFileDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const drop = useEffectEvent(onFiles)
  useEffect(() => {
    if (!enabled) return
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setOver(true)
    }
    const leave = (event: DragEvent) => {
      if (hasFiles(event) && --depth <= 0) setOver(false)
    }
    const overEvent = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const dropEvent = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setOver(false)
      drop([...(event.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overEvent)
    window.addEventListener('drop', dropEvent)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overEvent)
      window.removeEventListener('drop', dropEvent)
      setOver(false)
    }
  }, [enabled])
  return over
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

const ExpenseRow = memo(function ExpenseRow({ expense, selected, bulk, access, act }: RowProps) {
  const menu = expenseMenu(expense, access, () => act.open(expense.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <tr
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(expense.id)}
        onClick={(event) => {
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, a, [role=checkbox], input')
          )
            return
          act.open(expense.id)
        }}
        className="h-[54px] cursor-pointer border-b border-border/50 transition-colors duration-150 last:border-0 hover:bg-muted/40 data-selected:bg-muted/60"
      >
        <td className="pl-5">
          <Checkbox
            aria-label={`Select expense #${expense.number}`}
            className="cursor-pointer bg-card"
            checked={selected}
            onCheckedChange={() => act.toggle(expense.id)}
          />
        </td>
        <td className="px-3 text-muted-foreground tabular-nums">#{expense.number}</td>
        <td className="px-3">
          <span className="grid min-w-0 leading-tight">
            <span className="truncate" title={expense.supplier_name ?? undefined}>
              {expense.supplier_name ?? <span className="text-muted-foreground">No supplier</span>}
            </span>
            {expense.description && (
              <span
                className="truncate text-[13px] text-muted-foreground"
                title={expense.description}
              >
                {expense.description}
              </span>
            )}
          </span>
        </td>
        <td className="hidden px-3 @6xl:table-cell">
          {expense.category ? (
            <span className="grid leading-tight">
              <span>{expense.category.name}</span>
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {expense.category.account_code}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 whitespace-nowrap text-muted-foreground tabular-nums">
          {expense.document_date ? formatDay(expense.document_date) : '—'}
        </td>
        <td className="px-3 text-right whitespace-nowrap tabular-nums">
          {formatMoney(expense.total, expense.currency)}
        </td>
        <td className="px-3">
          <ExpenseBadge expense={expense} />
        </td>
        <td className="px-3">
          {expense.receipts_count > 0 ? (
            <span
              className="inline-flex items-center gap-1 text-[13px] text-muted-foreground tabular-nums"
              title="Receipts attached"
            >
              <Paperclip className="size-3.5" /> {expense.receipts_count}
            </span>
          ) : expense.receipt_missing_reason ? (
            <span
              className="text-[13px] text-muted-foreground"
              title={expense.receipt_missing_reason}
            >
              Substitute
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-[13px] text-[#a05c5c] dark:text-rose-300"
              title="No receipt yet"
            >
              <CircleDashed className="size-3.5" /> None
            </span>
          )}
        </td>
        <td className="pr-3 text-right">
          <RowMenuButton label={`Actions for expense #${expense.number}`} menu={menu} />
        </td>
      </tr>
    </RowContextMenu>
  )
})

const ExpenseItem = memo(function ExpenseItem({ expense, selected, bulk, access, act }: RowProps) {
  const menu = expenseMenu(expense, access, () => act.open(expense.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(expense.id)}
        className="flex items-center gap-3 px-4 py-3 data-selected:bg-muted/60"
      >
        <Checkbox
          aria-label={`Select expense #${expense.number}`}
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
            <span className="truncate text-[15px]">{expense.supplier_name ?? 'No supplier'}</span>
            <span className="truncate text-[13px] text-muted-foreground">
              {[expense.document_date && formatDay(expense.document_date), expense.category?.name]
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
