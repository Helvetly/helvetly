'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { formatDate } from '@helvetly/ui/lib/format'
import { displayPhone } from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CloudOff,
  Download,
  FilePen,
  ListFilter,
  PanelRightOpen,
  PauseCircle,
  Pencil,
  Power,
  PowerOff,
  SearchX,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  X,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ExportItem, unlessLocked, useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
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
  ResetColumnWidths,
  ResizableTable,
  useResizableColumns,
} from '@/components/data/resizable-columns'
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { DropOverlay, EmptyImportActions, useImportDrop } from '@/components/import/page-drop'
import { Initials } from '@/components/initials'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import {
  canDeleteClients,
  exportIdsUrl,
  exportUrl,
  listParamsToQuery,
  parseListParams,
  STATUS_VIEWS,
  statusView,
  type StatusView,
  useBulkClients,
  useClientList,
  useClientStatusCounts,
  useClientTags,
  useDeleteClient,
  clientQuery,
  useSaveClient,
  type Client,
  type ClientStatus,
  type ListParams,
  type SortField,
} from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'

import { ChangesPendingBadge, ClientRowStatus, ClientTypeBadge } from './client-bits'
import { ClientDetail, type ClientCommand } from './client-detail'
import { ClientForm } from './client-form'
import { countryName } from './client-form-model'
import { Combobox, COUNTRY_OPTIONS } from './fields'

const VIEW_ICONS: Record<StatusView, LucideIcon> = {
  all: Users,
  active: CircleCheck,
  draft: FilePen,
  inactive: PauseCircle,
}

type ColumnId = 'number' | 'name' | 'type' | 'phone' | 'city' | 'tags' | 'status' | 'created'
type ColumnDef = {
  /** Only from a wide panel (≥72rem), where there is room. */
  wide?: boolean
  id: ColumnId
  label: string
  /** Leave it off the main text column: that one takes the spare width (see `listTable`). */
  width?: string
  sort?: SortField
  /** Shown until switched off in Customize. */
  visible: boolean
  cell: (client: Client) => ReactNode
}

const COLUMNS: ColumnDef[] = [
  {
    id: 'number',
    label: translate('no'),
    width: 'w-[76px]',
    sort: 'number',
    visible: true,
    cell: (client) => <span className="font-code text-muted-foreground">#{client.number}</span>,
  },
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
    width: 'w-[110px]',
    visible: true,
    cell: (client) => <ClientTypeBadge company={client.is_company} />,
  },
  {
    id: 'phone',
    wide: true,
    label: translate('phone'),
    width: 'w-[15%]',
    visible: true,
    cell: (client) =>
      client.phone ? (
        <span className="font-code">{displayPhone(client.phone)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'city',
    label: translate('city'),
    width: 'w-[15%]',
    sort: 'city',
    visible: true,
    cell: (client) =>
      client.city || client.country ? (
        <span>
          {client.city}
          {client.country && (
            <span className="ml-1.5 text-xs text-muted-foreground">{client.country}</span>
          )}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'tags',
    label: translate('tags'),
    width: 'w-[14%]',
    visible: false,
    cell: (client) => (
      <span className="flex gap-1 overflow-hidden">
        {client.tags.map((tag) => (
          <Badge variant="outline" size="sm" key={tag}>
            {tag}
          </Badge>
        ))}
      </span>
    ),
  },
  {
    id: 'status',
    label: translate('status'),
    width: 'w-[130px]',
    visible: true,
    cell: (client) => <ClientRowStatus client={client} />,
  },
  {
    id: 'created',
    wide: true,
    label: translate('added3'),
    width: 'w-[120px]',
    sort: 'created_at',
    visible: true,
    cell: (client) => (
      <span className="text-muted-foreground">{formatDate(client.created_at)}</span>
    ),
  },
]

const COLUMNS_KEY = 'helvetly:clients:columns'

/** Which columns show: a per-browser choice, so storage may be missing. */
function useColumns() {
  const [hidden, setHidden] = useState<ColumnId[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null')
      if (Array.isArray(stored))
        return stored.filter((id): id is ColumnId => typeof id === 'string')
    } catch {}
    return COLUMNS.filter((column) => !column.visible).map((column) => column.id)
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

const toggleIn = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

/** Status keeps its width: badges are short and the same everywhere. */
const RESIZABLE = ['number', 'name', 'type', 'phone', 'city', 'tags', 'created']

/** The clients list: server-side search, filters, sort and paging, all kept in the URL. */
export function ClientsPage() {
  const widths = useResizableColumns('clients', RESIZABLE, { flex: 'name' })
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const openId = query.get('id')
  const role = useSession().data?.role
  const canWrite = useCan('write:clients')
  const canDelete = canWrite && canDeleteClients(role)
  const importDrawer = useImportDrawer()

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState<{ client?: Client; focus?: 'address' } | null>(null)
  const [deleting, setDeleting] = useState<Client[] | null>(null)
  const columns = useColumns()

  const list = useClientList(params)
  const save = useSaveClient()
  const remove = useDeleteClient()
  const bulk = useBulkClients()
  const prefetch = usePrefetch(clientQuery)

  const navigate = (next: URLSearchParams) => {
    setUrlQuery(pathname, next)
  }
  const statusCounts = useClientStatusCounts(params)
  const update = (change: Partial<ListParams>) =>
    navigate(listParamsToQuery({ ...params, page: 1, ...change }, query))
  const openClient = (id: string | null) => {
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

  // "New client" from Quick Actions arrives as ?new=1, which stays until the form closes.
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
    Boolean(params.search) ||
    params.status.length > 0 ||
    params.type !== null ||
    params.tags.length > 0 ||
    params.countries.length > 0
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const setActive = (client: Client, active: boolean) =>
    save.mutate(
      { id: client.id, input: { is_active: active } },
      {
        onSuccess: () =>
          toast.success(
            `${client.name} ${active ? translate('activated') : translate('deactivated')}.`,
          ),
        onError: toastError,
      },
    )

  const command = (name: ClientCommand, client: Client) => {
    if (name === 'edit') setForm({ client })
    if (name === 'complete') setForm({ client, focus: 'address' })
    if (name === 'toggle') setActive(client, !client.is_active)
    if (name === 'delete') setDeleting([client])
  }

  const runBulk = (action: 'activate' | 'deactivate') =>
    bulk.mutate(
      { ids: [...selected], action },
      {
        onSuccess: ({ data }) => {
          toast.success(
            translate(action === 'activate' ? 'clientsActivated' : 'clientsDeactivated', {
              count: data.updated,
            }),
          )
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
      toast.success(
        targets.length === 1
          ? translate('deleted', { value1: targets[0]?.name })
          : translate('clientsDeleted', { length: targets.length }),
      )
      setSelected(new Set())
      if (targets.some((client) => client.id === openId)) openClient(null)
    }
    if (targets.length === 1 && targets[0])
      remove.mutate(targets[0].id, { onSuccess: done, onError: toastError })
    else
      bulk.mutate(
        { ids: targets.map((client) => client.id), action: 'delete' },
        { onSuccess: done, onError: toastError },
      )
  }

  const sortBy = (field: SortField) =>
    update({ sort: field, desc: params.sort === field ? !params.desc : field === 'created_at' })

  const exportLock = useFeatureLock('data_export')
  const aiLock = useFeatureLock('ai_import')
  const canImport = canWrite && !aiLock
  const dropping = useImportDrop('clients', canImport && !formState && !openId)
  const selection = {
    count: selected.size,
    actions: bulkActions(canDelete, {
      activate: () => runBulk('activate'),
      deactivate: () => runBulk('deactivate'),
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
  const access = useMemo(() => ({ canWrite, canDelete }), [canWrite, canDelete])
  const open = useStableCallback(openClient)
  const toggle = useStableCallback(toggleRow)
  const run = useStableCallback(command)
  const act = useMemo<RowActions>(
    () => ({ open, toggle, prefetch, command: run }),
    [open, toggle, prefetch, run],
  )

  return (
    <>
      <PageHeader
        tabs={STATUS_VIEWS.map((view) =>
          view.value === 'all' ? translate('allClients') : view.label,
        )}
        tabIcons={STATUS_VIEWS.map((view) => VIEW_ICONS[view.value])}
        tabCounts={STATUS_VIEWS.map((view) =>
          view.value === 'all' ? undefined : statusCounts.data?.get(view.value),
        )}
        savedViews={false}
        active={STATUS_VIEWS.findIndex((view) => view.value === statusView(params.status))}
        onSelect={(index) => update({ status: [...(STATUS_VIEWS[index]?.status ?? [])] })}
        primary={translate('newClient')}
        onPrimary={() => setForm({})}
        menu={pageItems(dropdownKit)}
      />
      {importDrawer.isOpen && <ImportDrawer kind="clients" onClose={importDrawer.close} />}
      {dropping && <DropOverlay title={translate('dropToReadTheseFilesIntoNewClients')} />}
      <PageContextMenu
        title={translate('clients')}
        primary={{ label: translate('newClient'), onSelect: () => setForm({}) }}
        items={pageItems}
        selectAll={
          rows.length && !allSelected
            ? { onSelect: () => setSelected(new Set(rows.map((row) => row.id))) }
            : undefined
        }
        onRefresh={() => void list.refetch()}
      >
        <div className="relative flex flex-1 flex-col">
          <ListToolbar className="flex-wrap gap-y-2 py-2">
            <Filters params={params} onChange={update} />
            <ListSearch
              label={translate('searchClients')}
              placeholder={translate('searchNameEmailCityVATOrNumber')}
              value={search}
              onChange={setSearch}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-title-sm font-normal">
                  <SlidersHorizontal className="stroke-[1.5]" />
                  <span className="max-sm:sr-only">{translate('customize')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 gap-1 p-2">
                <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                  {translate('columns')}
                </p>
                {COLUMNS.filter((column) => column.id !== 'name').map((column) => (
                  <label
                    key={column.id}
                    className="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={!columns.hidden.includes(column.id)}
                      onCheckedChange={() => columns.toggle(column.id)}
                    />
                    {column.label === 'No.' ? translate('number') : column.label}
                  </label>
                ))}
                <ResetColumnWidths columns={widths} />
              </PopoverContent>
            </Popover>
          </ListToolbar>
          <ActiveFilters params={params} onChange={update} />

          {list.error ? (
            <State
              icon={<CloudOff />}
              title={translate('couldnTLoadClients')}
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
                    ? translate('noClientsMatch', { search: params.search })
                    : translate('noClientsInThisView')
                }
                text={translate('tryAnotherSearchOrClearTheFilters')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      navigate(listParamsToQuery({ ...parseListParams(new URLSearchParams()) }))
                    }}
                  >
                    {translate('clearSearchAndFilters')}
                  </Button>
                }
              />
            ) : (
              <State
                icon={<UserPlus />}
                title={translate('noClientsYet')}
                text={translate('addThePeopleAndCompaniesYouWorkForThe')}
                action={
                  canWrite && (
                    <EmptyImportActions
                      importLabel={translate('import')}
                      hint={translate('orDropFilesAnywhereOnThisPage')}
                      onImport={canImport ? importDrawer.open : undefined}
                    >
                      <Button size="sm" onClick={() => setForm({})}>
                        {translate('addYourFirstClient')}
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
                        aria-label={translate('selectAllClientsOnThisPage')}
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
                          {...widths.head(column.id)}
                          aria-sort={
                            sorted ? (params.desc ? 'descending' : 'ascending') : undefined
                          }
                          className={cn(
                            listTable.th,
                            column.width,
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
                  {rows.map((client) => (
                    <ClientRow
                      key={client.id}
                      client={client}
                      columns={columns.visible}
                      selected={selected.has(client.id)}
                      bulk={selected.has(client.id) ? selection : undefined}
                      access={access}
                      act={act}
                    />
                  ))}
                </tbody>
              </ResizableTable>

              <ul className={cn(listTable.list, '@4xl:hidden')}>
                {rows.map((client) => (
                  <ClientItem
                    key={client.id}
                    client={client}
                    selected={selected.has(client.id)}
                    bulk={selected.has(client.id) ? selection : undefined}
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
        <ClientDetail
          key={`detail:${openId}`}
          id={openId}
          canDelete={canDelete}
          onClose={() => openClient(null)}
          onCommand={command}
        />
      )}
      {formState && (
        <ClientForm
          client={formState.client}
          focus={formState.focus}
          onClose={closeForm}
          onSaved={(client, created) => {
            setForm(null)
            if (!created) return
            const next = new URLSearchParams(query)
            next.delete('new')
            next.set('id', client.id)
            navigate(next)
          }}
        />
      )}
      {deleting && deleting.length > 0 && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? translate('delete5', { value1: deleting[0]?.name })
              : translate('deleteClients2', { length: deleting.length })
          }
          body={translate('invoicesAndDocumentsThatMentionThemKeepTheirCopy')}
          confirmLabel={
            deleting.length === 1
              ? translate('deleteClient')
              : translate('deleteClients', { length: deleting.length })
          }
          tone="destructive"
          onDecide={confirmDelete}
        />
      )}
    </>
  )
}

/** The bulk bar's buttons; deleting only for those allowed to. */
export function bulkActions(
  canDelete: boolean,
  run: { activate: () => void; deactivate: () => void; exportCsv: () => void; remove: () => void },
) {
  return [
    { label: translate('activate'), icon: <Power />, onClick: run.activate, write: true },
    { label: translate('deactivate'), icon: <PowerOff />, onClick: run.deactivate, write: true },
    { label: translate('exportCSV'), icon: <Download />, onClick: run.exportCsv },
    ...(canDelete
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

/** The name opens the client: by click like the rest of the row, and by keyboard. */
function NameCell({ client, onOpen }: { client: Client; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Initials name={client.name} />
      <span className="grid min-w-0 leading-tight">
        <span className="truncate">{client.name}</span>
        {client.email && (
          <span className="truncate text-caption text-muted-foreground">{client.email}</span>
        )}
      </span>
      <span className="ml-auto shrink-0">
        <ChangesPendingBadge client={client} />
      </span>
    </button>
  )
}

/** A client's actions, for its "…" button and its right-click menu. */
function clientMenu(
  client: Client,
  can: { canWrite: boolean; canDelete: boolean },
  onOpen: () => void,
  onCommand: (command: ClientCommand, client: Client) => void,
): RowMenuSpec {
  return {
    title: `#${client.number} · ${client.name}`,
    items: ({ Item, Separator }) => (
      <>
        <Item onSelect={onOpen}>
          <PanelRightOpen />
          {translate('openDetails')}
        </Item>
        {can.canWrite && (
          <Item onSelect={() => onCommand('edit', client)}>
            <Pencil />
            {translate('edit4')}
          </Item>
        )}
        {can.canWrite && (
          <>
            <Separator />
            <Item onSelect={() => onCommand('toggle', client)}>
              {client.is_active ? <PowerOff /> : <Power />}
              {client.is_active ? translate('deactivate') : translate('activate')}
            </Item>
          </>
        )}
        {can.canDelete && (
          <Item variant="destructive" onSelect={() => onCommand('delete', client)}>
            <Trash2 />
            {translate('delete')}
          </Item>
        )}
      </>
    ),
  }
}

const STATUS_LABELS: Record<ClientStatus, string> = {
  active: translate('active'),
  inactive: translate('inactive'),
  draft: translate('draft'),
  complete: translate('completeAddress'),
}

/** Chips under the toolbar for every filter in use, each with its own ×, and "Clear all". */
function ActiveFilters({
  params,
  onChange,
}: {
  params: ListParams
  onChange: (change: Partial<ListParams>) => void
}) {
  const chips: { label: string; clear: Partial<ListParams> }[] = [
    ...(params.type
      ? [
          {
            label: params.type === 'company' ? translate('companies') : translate('people'),
            clear: { type: null },
          },
        ]
      : []),
    // A quick view shows in the toolbar; only another combination (from a link) needs chips.
    ...(statusView(params.status) === null
      ? params.status.map((status) => ({
          label: STATUS_LABELS[status],
          clear: { status: params.status.filter((entry) => entry !== status) },
        }))
      : []),
    ...params.tags.map((tag) => ({
      label: translate('tag', { tag: tag }),
      clear: { tags: params.tags.filter((entry) => entry !== tag) },
    })),
    ...params.countries.map((code) => ({
      label: countryName(code),
      clear: { countries: params.countries.filter((entry) => entry !== code) },
    })),
  ]
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 md:px-4">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="flex h-7 items-center gap-1 rounded-md bg-muted pr-1 pl-2.5 text-body-sm"
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
      {chips.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-body-sm font-normal text-muted-foreground"
          onClick={() =>
            onChange({
              ...(statusView(params.status) === null && { status: [] }),
              type: null,
              tags: [],
              countries: [],
            })
          }
        >
          {translate('clearAll')}
        </Button>
      )}
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
  const tags = useClientTags()
  const count = (params.type ? 1 : 0) + params.tags.length + params.countries.length
  const option =
    'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted [&_[role=checkbox]]:bg-card'

  return (
    <Popover>
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
      <PopoverContent align="start" className="grid max-h-[70svh] w-72 gap-3 overflow-y-auto p-3">
        <fieldset className="grid gap-0.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">{translate('type')}</legend>
          {(['company', 'person'] as const).map((type) => (
            <label key={type} className={option}>
              <Checkbox
                checked={params.type === type}
                onCheckedChange={(on) => onChange({ type: on ? type : null })}
              />
              {type === 'company' ? translate('companies') : translate('people')}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-0.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">{translate('tags')}</legend>
          {tags.data?.length ? (
            tags.data.map((tag) => (
              <label key={tag.name} className={option}>
                <Checkbox
                  checked={params.tags.includes(tag.name)}
                  onCheckedChange={() => onChange({ tags: toggleIn(params.tags, tag.name) })}
                />
                <span className="truncate">{tag.name}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {tag.count}
                </span>
              </label>
            ))
          ) : (
            <p className="px-2 text-[13px] text-muted-foreground">{translate('noTagsYet')}</p>
          )}
        </fieldset>
        <fieldset className="grid gap-1.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">
            {translate('country')}
          </legend>
          {params.countries.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1">
              {params.countries.map((code) => (
                <span
                  key={code}
                  className="flex h-6 items-center gap-1 rounded-[5px] bg-muted pr-0.5 pl-2 text-[13px]"
                >
                  {countryName(code)}
                  <button
                    type="button"
                    aria-label={translate('remove4', { value1: countryName(code) })}
                    onClick={() =>
                      onChange({ countries: params.countries.filter((entry) => entry !== code) })
                    }
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-card"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Combobox
            value=""
            label={translate('addACountry2')}
            options={COUNTRY_OPTIONS.filter((country) => !params.countries.includes(country.value))}
            placeholder={translate('addACountry')}
            onChange={(code) => onChange({ countries: [...params.countries, code] })}
          />
        </fieldset>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-muted-foreground"
            onClick={() => onChange({ type: null, tags: [], countries: [] })}
          >
            {translate('clearFilters')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

type RowProps = {
  client: Client
  selected: boolean
  bulk: ComponentProps<typeof RowContextMenu>['bulk']
  access: { canWrite: boolean; canDelete: boolean }
  act: RowActions
}

/** Stable across the page's renders, so opening a drawer re-renders no row. */
type RowActions = {
  open: (id: string) => void
  toggle: (id: string) => void
  prefetch: (id: string) => void
  command: (name: ClientCommand, client: Client) => void
}

const ClientRow = memo(function ClientRow({
  client,
  columns,
  selected,
  bulk,
  access,
  act,
}: RowProps & { columns: ColumnDef[] }) {
  const menu = clientMenu(client, access, () => act.open(client.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <tr
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(client.id)}
        onClick={(event) => {
          // Clicks on the row's own controls do their own thing, and so do clicks in portalled
          // menus and dialogs, which React bubbles up to here although they're elsewhere.
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, a, [role=checkbox], input')
          )
            return
          act.open(client.id)
        }}
        className={cn(listTable.row, 'cursor-pointer')}
      >
        <td className={listTable.select}>
          <Checkbox
            aria-label={translate('select', { name: client.name })}
            className="bg-card"
            checked={selected}
            onCheckedChange={() => act.toggle(client.id)}
          />
        </td>
        {columns.map((column) => (
          <td key={column.id} className={cn(listTable.td, column.wide && 'hidden @6xl:table-cell')}>
            {column.id === 'name' ? (
              <NameCell client={client} onOpen={() => act.open(client.id)} />
            ) : (
              column.cell(client)
            )}
          </td>
        ))}
        <td className={listTable.menu}>
          <RowMenuButton label={translate('actionsFor', { name: client.name })} menu={menu} />
        </td>
      </tr>
    </RowContextMenu>
  )
})

const ClientItem = memo(function ClientItem({ client, selected, bulk, access, act }: RowProps) {
  const menu = clientMenu(client, access, () => act.open(client.id), act.command)
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        onPointerEnter={() => act.prefetch(client.id)}
        className={listTable.item}
      >
        <Checkbox
          aria-label={translate('select', { name: client.name })}
          className="bg-card"
          checked={selected}
          onCheckedChange={() => act.toggle(client.id)}
        />
        <button
          type="button"
          onClick={() => act.open(client.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="grid min-w-0 flex-1 leading-snug">
            <span className="truncate text-[15px]">
              {client.name}{' '}
              <span className="font-code text-[13px] text-muted-foreground">#{client.number}</span>
            </span>
            <span className="truncate text-[13px] text-muted-foreground">
              {[client.email, client.city].filter(Boolean).join(' · ') ||
                translate('noContactDetails')}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            <ChangesPendingBadge client={client} />
            <ClientRowStatus client={client} />
          </span>
        </button>
      </li>
    </RowContextMenu>
  )
})
