'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CopyPlus,
  Download,
  ListFilter,
  Package,
  PanelRightOpen,
  Pencil,
  SearchX,
  SlidersHorizontal,
  Trash2,
  Wrench,
  X,
  Layers,
  BriefcaseBusiness,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { type ComponentProps, memo, type ReactNode, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ExportItem, unlessLocked, useFeatureLock } from '@/components/billing/feature-lock'
import { Combobox, CURRENCY_OPTIONS } from '@/components/clients/fields'
import { listTable, Pager } from '@/components/data/list-table'
import { ListSearch, ListToolbar, ToolbarText } from '@/components/data/list-toolbar'
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
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatAmount, useInvoiceSettings } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import {
  canManageProducts,
  exportIdsUrl,
  exportUrl,
  listParamsToQuery,
  parseListParams,
  useArchiveProduct,
  useBulkProducts,
  useDeleteProduct,
  useDuplicateProduct,
  useProductList,
  type BulkAction,
  type BulkResult,
  type ListParams,
  type Product,
  type SortField,
  productQuery,
} from '@/lib/products'
import { usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

import { ProductTypeBadge, unitLabel, unitShort, vatLabel } from './product-bits'
import { ProductDetail, type ProductCommand } from './product-detail'
import { ProductForm } from './product-form'

const ALL: Pick<ListParams, 'type' | 'status'> = { type: null, status: 'active' }
const VIEWS: { label: string; icon: LucideIcon; change: Pick<ListParams, 'type' | 'status'> }[] = [
  { label: translate('all'), icon: Layers, change: ALL },
  { label: translate('products'), icon: Package, change: { type: 'product', status: 'active' } },
  {
    label: translate('services'),
    icon: BriefcaseBusiness,
    change: { type: 'service', status: 'active' },
  },
  { label: translate('archived'), icon: Archive, change: { type: null, status: 'archived' } },
]

type ColumnId = 'name' | 'type' | 'sku' | 'unit' | 'price' | 'vat' | 'updated'
type ColumnDef = {
  id: ColumnId
  label: string
  /** Leave it off the main text column: that one takes the spare width (see `listTable`). */
  width?: string
  sort?: SortField
  align?: 'right'
  /** Only from a wide panel (≥72rem), where there is room. */
  wide?: boolean
  visible: boolean
  cell: (product: Product) => ReactNode
}

const dash = <span className="text-muted-foreground">—</span>

const COLUMNS: ColumnDef[] = [
  {
    id: 'name',
    label: translate('name'),
    sort: 'name',
    visible: true,
    cell: () => null,
  },
  {
    id: 'type',
    label: translate('type'),
    width: 'w-[104px]',
    visible: true,
    cell: (product) => <ProductTypeBadge type={product.type} />,
  },
  {
    id: 'sku',
    label: 'SKU',
    width: 'w-[16%]',
    sort: 'sku',
    visible: true,
    cell: (product) =>
      product.sku ? <span className="font-code break-all">{product.sku}</span> : dash,
  },
  {
    id: 'unit',
    label: translate('unit'),
    width: 'w-[110px]',
    wide: true,
    visible: true,
    cell: (product) => unitLabel(product.unit) ?? dash,
  },
  {
    id: 'price',
    label: translate('unitPrice'),
    width: 'w-[168px]',
    sort: 'unit_price',
    align: 'right',
    visible: true,
    cell: (product) => <PriceCell product={product} />,
  },
  {
    id: 'vat',
    label: translate('vat'),
    width: 'w-[120px]',
    align: 'right',
    visible: true,
    cell: (product) => <span className="tabular-nums">{vatLabel(product)}</span>,
  },
  {
    id: 'updated',
    label: translate('updated3'),
    width: 'w-[124px]',
    sort: 'updated_at',
    wide: true,
    visible: true,
    cell: (product) => (
      <span className="text-muted-foreground">{formatDate(product.updated_at)}</span>
    ),
  },
]

function PriceCell({ product }: { product: Product }) {
  const unit = unitShort(product.unit)
  return (
    <span className="grid justify-items-end leading-tight tabular-nums">
      <span className="whitespace-nowrap">
        <span className="mr-1 text-[12px] text-muted-foreground">{product.currency}</span>
        {formatAmount(product.unit_price)}
        {unit && <span className="text-muted-foreground"> / {unit}</span>}
      </span>
      <span className="text-[12px] text-muted-foreground">
        {product.price_basis === 'gross' ? translate('inclVAT3') : translate('exclVAT2')}
      </span>
    </span>
  )
}

const COLUMNS_KEY = 'helvetly:products:columns'

/** Which columns show: a per-browser choice, so storage may be missing. */
function useColumns() {
  const [hidden, setHidden] = useState<ColumnId[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null')
      if (Array.isArray(stored))
        return stored.filter((id): id is ColumnId => COLUMNS.some((column) => column.id === id))
    } catch {}
    return []
  })
  const toggle = (id: ColumnId) => {
    const next = hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id]
    setHidden(next)
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next))
    } catch {}
  }
  const visible = useMemo(() => COLUMNS.filter((column) => !hidden.includes(column.id)), [hidden])
  return { visible, hidden, toggle }
}

const toastError = (error: unknown) => toast.error(errorMessage(error))

/** "3 items archived." plus why the others were skipped, if any. */
function bulkMessage(result: BulkResult, verb: string) {
  const done = `${result.updated} ${result.updated === 1 ? 'item' : 'items'} ${verb}.`
  const reasons = [...new Set(result.skipped.map((skip) => skip.reason))]
  return result.skipped.length
    ? `${done} ${result.skipped.length} skipped: ${reasons.join(' ')}`
    : done
}

/** The catalogue: server-side search, filters, sort and paging, all kept in the URL. */
export function ProductsPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const openId = query.get('id')
  const canWrite = useCan('write:products')
  const role = useSession().data?.role
  const canManage = canWrite && canManageProducts(role)
  const importDrawer = useImportDrawer()
  const settingsQuery = useInvoiceSettings()
  const settings = settingsQuery.data
  const defaults = {
    currency: settings?.currency ?? 'CHF',
    vat_registered: settings?.vat_registered ?? true,
    default_vat_rate: settings?.default_vat_rate ?? '8.1',
  }

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState<{ product?: Product } | null>(null)
  const [deleting, setDeleting] = useState<Product[] | null>(null)
  const columns = useColumns()

  const list = useProductList(params)
  const prefetch = usePrefetch(productQuery)
  const archive = useArchiveProduct()
  const duplicate = useDuplicateProduct()
  const remove = useDeleteProduct()
  const bulk = useBulkProducts()

  const navigate = (next: URLSearchParams) => {
    setUrlQuery(pathname, next)
  }
  const update = (change: Partial<ListParams>) => {
    setSelected(new Set())
    navigate(listParamsToQuery({ ...params, page: 1, ...change }, query))
  }
  const openProduct = (id: string | null) => {
    const next = new URLSearchParams(query)
    if (id) next.set('id', id)
    else next.delete('id')
    navigate(next)
  }

  // Search waits for a pause in typing, then goes to the URL (and so to the server).
  useEffect(() => {
    if (search === params.search) return
    const timer = setTimeout(() => update({ search }), 300)
    return () => clearTimeout(timer)
  })

  // "New product" from Quick Actions arrives as ?new=1, which stays until the form closes.
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
  const filtered = Boolean(params.search) || params.currencies.length > 0
  const viewIndex = VIEWS.findIndex(
    (view) => view.change.type === params.type && view.change.status === params.status,
  )
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const command = (name: ProductCommand, product: Product) => {
    if (name === 'edit') setForm({ product })
    if (name === 'delete') setDeleting([product])
    if (name === 'duplicate')
      duplicate.mutate(product.id, {
        onSuccess: (copy) => {
          toast.success(translate('created2', { name: copy.name }))
          setForm({ product: copy })
        },
        onError: toastError,
      })
    if (name === 'archive')
      archive.mutate(
        { id: product.id, archived: !product.is_archived },
        {
          onSuccess: (saved) =>
            toast.success(
              `${saved.name} ${saved.is_archived ? translate('archived3') : translate('restored')}.`,
            ),
          onError: toastError,
        },
      )
  }

  const runBulk = (action: Exclude<BulkAction, 'delete'>) =>
    bulk.mutate(
      { ids: [...selected], action },
      {
        onSuccess: (result) => {
          toast.success(bulkMessage(result, action === 'archive' ? 'archived' : 'restored'))
          setSelected(new Set())
        },
        onError: toastError,
      },
    )

  const confirmDelete = (approved: boolean) => {
    const targets = deleting ?? []
    setDeleting(null)
    if (!approved) return
    const done = () => {
      setSelected(new Set())
      if (targets.some((product) => product.id === openId)) openProduct(null)
    }
    if (targets.length === 1 && targets[0]) {
      const name = targets[0].name
      remove.mutate(targets[0].id, {
        onSuccess: () => {
          toast.success(translate('deleted3', { name: name }))
          done()
        },
        onError: toastError,
      })
    } else
      bulk.mutate(
        { ids: targets.map((product) => product.id), action: 'delete' },
        {
          onSuccess: (result) => {
            toast.success(bulkMessage(result, 'deleted'))
            done()
          },
          onError: toastError,
        },
      )
  }

  const sortBy = (field: SortField) =>
    update({
      sort: field,
      desc: params.sort === field ? !params.desc : field === 'updated_at' || field === 'unit_price',
    })
  const archivedView = params.status === 'archived'
  const exportLock = useFeatureLock('data_export')
  const aiLock = useFeatureLock('ai_import')
  const canImport = canWrite && !aiLock
  const dropping = useImportDrop('products', canImport && !formState && !openId)
  const selection = {
    count: selected.size,
    actions: bulkActions(canManage, archivedView, {
      archive: () => runBulk('archive'),
      unarchive: () => runBulk('unarchive'),
      exportCsv: unlessLocked(exportLock, () =>
        window.location.assign(exportIdsUrl([...selected])),
      ),
      remove: () => setDeleting(rows.filter((row) => selected.has(row.id))),
    }),
  }
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
    </>
  )
  const access = useMemo(() => ({ canManage, canWrite }), [canManage, canWrite])
  const open = useStableCallback(openProduct)
  const toggle = useStableCallback(toggleRow)
  const run = useStableCallback(command)
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
        active={viewIndex}
        onSelect={(index) => update(VIEWS[index]?.change ?? ALL)}
        primary={translate('newItem')}
        onPrimary={() => setForm({})}
        menu={pageItems(dropdownKit)}
      />
      {importDrawer.isOpen && <ImportDrawer kind="products" onClose={importDrawer.close} />}
      {dropping && <DropOverlay title={translate('dropToReadTheseFilesIntoProductsAndServices')} />}
      <PageContextMenu
        title={translate('productsServices')}
        primary={{ label: translate('newItem'), onSelect: () => setForm({}) }}
        items={pageItems}
        views={{
          tabs: VIEWS.map((view) => view.label),
          active: viewIndex,
          onSelect: (index) => update(VIEWS[index]?.change ?? ALL),
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
              label={translate('searchProductsAndServices')}
              placeholder={translate('searchNameSKUGTINOrDescription')}
              value={search}
              onChange={setSearch}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-[15px] font-normal">
                  <SlidersHorizontal className="stroke-[1.5]" />
                  <ToolbarText className="max-sm:sr-only">{translate('customize')}</ToolbarText>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 gap-1 p-2">
                <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                  {translate('columns')}
                </p>
                {COLUMNS.filter((column) => column.id !== 'name').map((column) => (
                  <label
                    key={column.id}
                    className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={!columns.hidden.includes(column.id)}
                      onCheckedChange={() => columns.toggle(column.id)}
                    />
                    {column.label}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          </ListToolbar>

          {list.error ? (
            <LoadProblem
              error={list.error}
              what={translate('theCatalogue')}
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
                    ? translate('nothingMatches', { search: params.search })
                    : translate('nothingInThisView')
                }
                text={translate('tryAnotherSearchOrClearTheFilters')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      update({ search: '', currencies: [] })
                    }}
                  >
                    {translate('clearSearchAndFilters')}
                  </Button>
                }
              />
            ) : archivedView ? (
              <State
                icon={<Archive />}
                title={translate('nothingArchived')}
                text={translate('archivedItemsStayOutOfTheInvoicePickerBut')}
                action={
                  <Button variant="outline" size="sm" onClick={() => update(ALL)}>
                    {translate('showActiveItems')}
                  </Button>
                }
              />
            ) : (
              <State
                icon={<Package />}
                title={
                  params.type === 'product'
                    ? translate('noProductsYet')
                    : params.type === 'service'
                      ? translate('noServicesYet')
                      : translate('noProductsOrServicesYet')
                }
                text={translate('saveWhatYouSellOnceAndInvoiceLinesFill')}
                action={
                  canWrite && (
                    <EmptyImportActions
                      importLabel={translate('import')}
                      hint={translate('orDropFilesAnywhereOnThisPage')}
                      onImport={canImport ? importDrawer.open : undefined}
                    >
                      <Button size="sm" className="cursor-pointer" onClick={() => setForm({})}>
                        {translate('addProductOrService')}
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
              <table className={cn(listTable.table, 'hidden @4xl:table')}>
                <thead>
                  <tr className={listTable.head}>
                    <th className={listTable.select}>
                      <Checkbox
                        aria-label={translate('selectAllItemsOnThisPage')}
                        className="bg-card"
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelected(new Set(checked ? rows.map((row) => row.id) : []))
                        }
                      />
                    </th>
                    {columns.visible.map((column) => {
                      const sorted = column.sort === params.sort
                      return (
                        <th
                          key={column.id}
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
                    <th className={listTable.menu}>
                      <span className="sr-only">{translate('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      columns={columns.visible}
                      selected={selected.has(product.id)}
                      bulk={selected.has(product.id) ? selection : undefined}
                      access={access}
                      act={act}
                    />
                  ))}
                </tbody>
              </table>

              <ul className={cn(listTable.list, '@4xl:hidden')}>
                {rows.map((product) => (
                  <ProductItem
                    key={product.id}
                    product={product}
                    selected={selected.has(product.id)}
                    bulk={selected.has(product.id) ? selection : undefined}
                    access={access}
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

      {openId && (
        <ProductDetail
          key={`detail:${openId}`}
          id={openId}
          canManage={canManage}
          onClose={() => openProduct(null)}
          onCommand={command}
        />
      )}
      {formState && !formState.product && !settled(settingsQuery) ? (
        <FormSheetLoading title={translate('newProductOrService')} onClose={closeForm} />
      ) : (
        formState && (
          <ProductForm
            key={`form:${formState.product?.id ?? 'new'}`}
            product={formState.product}
            defaults={defaults}
            onClose={closeForm}
            onSaved={(product, created) => {
              setForm(null)
              if (!created) return
              const next = new URLSearchParams(query)
              next.delete('new')
              next.set('id', product.id)
              navigate(next)
            }}
          />
        )
      )}
      {deleting && deleting.length > 0 && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? translate('delete5', { value1: deleting[0]?.name })
              : translate('deleteItems2', { length: deleting.length })
          }
          body={translate('invoicesKeepTheirCopyOfTheLinesToOnly')}
          confirmLabel={
            deleting.length === 1
              ? translate('deleteItem')
              : translate('deleteItems', { length: deleting.length })
          }
          tone="destructive"
          onDecide={confirmDelete}
        />
      )}
    </>
  )
}

/** The bulk bar's buttons: archive (or restore in the archive) and delete only for managers. */
export function bulkActions(
  canManage: boolean,
  archivedView: boolean,
  run: { archive: () => void; unarchive: () => void; exportCsv: () => void; remove: () => void },
) {
  return [
    ...(canManage
      ? [
          archivedView
            ? {
                label: translate('restore'),
                icon: <ArchiveRestore />,
                onClick: run.unarchive,
                write: true,
              }
            : { label: translate('archive'), icon: <Archive />, onClick: run.archive, write: true },
        ]
      : []),
    { label: translate('exportCSV'), icon: <Download />, onClick: run.exportCsv },
    ...(canManage
      ? [
          {
            label: translate('delete3'),
            icon: <Trash2 />,
            onClick: run.remove,
            destructive: true,
            write: true,
          },
        ]
      : []),
  ]
}

function NameCell({ product, onOpen }: { product: Product; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 text-left"
    >
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        {product.type === 'product' ? (
          <Package className="size-3.5 stroke-[1.75]" />
        ) : (
          <Wrench className="size-3.5 stroke-[1.75]" />
        )}
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="break-words">{product.name}</span>
        {product.description && (
          <span className="truncate text-[13px] text-muted-foreground" title={product.description}>
            {product.description}
          </span>
        )}
      </span>
    </button>
  )
}

/** An item's actions, for its "…" button and its right-click menu. */
function productMenu(
  product: Product,
  can: { canManage: boolean; canWrite: boolean },
  onOpen: () => void,
  onCommand: (command: ProductCommand, product: Product) => void,
): RowMenuSpec {
  return {
    title: product.sku ? `${product.sku} · ${product.name}` : product.name,
    items: ({ Item, Separator }) => (
      <>
        <Item onSelect={onOpen}>
          <PanelRightOpen />
          {translate('openDetails')}
        </Item>
        {can.canWrite && (
          <>
            <Item onSelect={() => onCommand('edit', product)}>
              <Pencil />
              {translate('edit4')}
            </Item>
            <Item onSelect={() => onCommand('duplicate', product)}>
              <CopyPlus />
              {translate('duplicate')}
            </Item>
          </>
        )}
        {can.canManage && (
          <>
            <Separator />
            <Item onSelect={() => onCommand('archive', product)}>
              {product.is_archived ? <ArchiveRestore /> : <Archive />}
              {product.is_archived ? translate('restore') : translate('archive')}
            </Item>
            <Item variant="destructive" onSelect={() => onCommand('delete', product)}>
              <Trash2 />
              {translate('delete')}
            </Item>
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
  const count = params.currencies.length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-[15px] font-normal">
          <ListFilter className="stroke-[1.5]" />
          <ToolbarText>{translate('filters')}</ToolbarText>
          {count > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-72 gap-3 p-3">
        <fieldset className="grid gap-1.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">
            {translate('currency')}
          </legend>
          {params.currencies.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1">
              {params.currencies.map((code) => (
                <span
                  key={code}
                  className="flex h-6 items-center gap-1 rounded-[5px] bg-muted pr-0.5 pl-2 text-[13px]"
                >
                  {code}
                  <button
                    type="button"
                    aria-label={translate('remove8', { code: code })}
                    onClick={() =>
                      onChange({ currencies: params.currencies.filter((entry) => entry !== code) })
                    }
                    className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-card"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Combobox
            value=""
            label={translate('addACurrency2')}
            options={CURRENCY_OPTIONS.filter((option) => !params.currencies.includes(option.value))}
            placeholder={translate('addACurrency')}
            onChange={(code) => onChange({ currencies: [...params.currencies, code] })}
          />
        </fieldset>
        <p className="px-2 text-[12.5px] text-muted-foreground">
          {translate('theTabsAboveFilterByTypeAndArchive')}
        </p>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-muted-foreground"
            onClick={() => onChange({ currencies: [] })}
          >
            {translate('clearFilters')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

type RowProps = {
  product: Product
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
  command: (name: ProductCommand, product: Product) => void
}

const ProductRow = memo(function ProductRow({
  product,
  columns,
  selected,
  bulk,
  access,
  act,
}: RowProps & { columns: ColumnDef[] }) {
  const menu = productMenu(product, access, () => act.open(product.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <tr
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(product.id)}
        onClick={(event) => {
          // The row's own controls, and portalled menus React bubbles up here, do their own thing.
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, a, [role=checkbox], input')
          )
            return
          act.open(product.id)
        }}
        className={cn(listTable.row, 'cursor-pointer')}
      >
        <td className={listTable.select}>
          <Checkbox
            aria-label={translate('select', { name: product.name })}
            className="bg-card"
            checked={selected}
            onCheckedChange={() => act.toggle(product.id)}
          />
        </td>
        {columns.map((column) => (
          <td
            key={column.id}
            className={cn(
              listTable.td,
              column.align === 'right' && listTable.numeric,
              column.wide && 'hidden @6xl:table-cell',
            )}
          >
            {column.id === 'name' ? (
              <NameCell product={product} onOpen={() => act.open(product.id)} />
            ) : (
              column.cell(product)
            )}
          </td>
        ))}
        <td className={listTable.menu}>
          <RowMenuButton label={translate('actionsFor', { name: product.name })} menu={menu} />
        </td>
      </tr>
    </RowContextMenu>
  )
})

const ProductItem = memo(function ProductItem({ product, selected, bulk, access, act }: RowProps) {
  const menu = productMenu(product, access, () => act.open(product.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(product.id)}
        className={listTable.item}
      >
        <Checkbox
          aria-label={translate('select', { name: product.name })}
          className="bg-card"
          checked={selected}
          onCheckedChange={() => act.toggle(product.id)}
        />
        <button
          type="button"
          onClick={() => act.open(product.id)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        >
          <span className="grid min-w-0 flex-1 leading-snug">
            <span className="text-[15px] break-words">{product.name}</span>
            <span className="text-[13px] break-all text-muted-foreground">
              {product.type === 'product' ? 'Product' : 'Service'}
              {product.sku && (
                <>
                  {' · '}
                  <span className="font-code">{product.sku}</span>
                </>
              )}
            </span>
          </span>
          <PriceCell product={product} />
        </button>
      </li>
    </RowContextMenu>
  )
})
