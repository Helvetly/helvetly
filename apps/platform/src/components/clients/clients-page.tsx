'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  ColumnsCustomize,
  DataTable,
  listTable,
  type DataColumn,
} from '@helvetly/ui/components/data-table'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { formatDate } from '@helvetly/ui/lib/format'
import { displayPhone } from '@helvetly/ui/lib/phone'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { usePageSize } from '@helvetly/ui/lib/table-storage'
import { cn } from '@helvetly/ui/lib/utils'
import {
  CircleCheck,
  CloudOff,
  Download,
  FilePen,
  KeyRound,
  LockKeyhole,
  PanelRightOpen,
  PauseCircle,
  Pencil,
  Power,
  PowerOff,
  SearchX,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { memo, useEffect, useMemo, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { useExportAction, unlessLocked, useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { ListFilters, sinceOptions } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import {
  PageContextMenu,
  RowContextMenu,
  RowMenuButton,
  type RowMenuSpec,
} from '@/components/data/menus'
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { useHiddenColumns } from '@/components/data/use-hidden-columns'
import { useImportAction, useImportDrawer } from '@/components/import/import-button'
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
  STATUSES,
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
import { among, oneValue, SINCE_PRESETS, type QueryField } from '@/lib/list-query'
import { useCan } from '@/lib/permissions'
import { usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'
import { useStableCallback } from '@/lib/use-stable-callback'
import { usePortalAddress } from '@/lib/workspaces'

import { ChangesPendingBadge, ClientRowStatus, ClientTypeBadge } from './client-bits'
import { ClientDetail, type ClientCommand } from './client-detail'
import { ClientForm } from './client-form'
import { COUNTRY_OPTIONS } from './fields'

const VIEW_ICONS: Record<StatusView, LucideIcon> = {
  all: Users,
  active: CircleCheck,
  draft: FilePen,
  inactive: PauseCircle,
}

/** Which list sort each sortable column asks for. */
const SORTS: Partial<Record<string, SortField>> = {
  number: 'number',
  name: 'name',
  city: 'city',
  created: 'created_at',
}

/** The clients list: server-side search, filters, sort and paging, all kept in the URL. */
export function ClientsPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const [pageSize, setPageSize] = usePageSize('clients')
  const params = { ...parseListParams(query), pageSize }
  const openId = query.get('id')
  const role = useSession().data?.role
  const canWrite = useCan('write:clients')
  const canDelete = canWrite && canDeleteClients(role)
  const importDrawer = useImportDrawer()

  const [search, setSearch] = useState(params.search)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [portalChange, setPortalChange] = useState<{ enabled: boolean; ids: string[] } | null>(null)
  const portal = usePortalAddress(canWrite && selected.size > 0).data
  const [form, setForm] = useState<{ client?: Client; focus?: 'address' } | null>(null)
  const [deleting, setDeleting] = useState<Client[] | null>(null)
  const hiddenColumns = useHiddenColumns('helvetly:clients:columns', ['tags'])

  const list = useClientList(params)
  const queryFields = useQueryFields()
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
    params.countries.length > 0 ||
    params.created !== null ||
    Boolean(params.name || params.email || params.city)
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

  const exportLock = useFeatureLock('data_export')
  const aiLock = useFeatureLock('ai_import')
  const canImport = canWrite && !aiLock
  const dropping = useImportDrop('clients', canImport && !formState && !openId)
  const selection = {
    count: selected.size,
    actions: bulkActions(canDelete, {
      activate: () => runBulk('activate'),
      deactivate: () => runBulk('deactivate'),
      portal:
        canWrite && portal?.enabled && portal.feature_available
          ? {
              change: (enabled: boolean) => setPortalChange({ enabled, ids: [...selected] }),
              disabled: bulk.isPending ? translate('loading') : undefined,
            }
          : undefined,
      exportCsv: unlessLocked(exportLock, () =>
        window.location.assign(exportIdsUrl([...selected])),
      ),
      remove: () => setDeleting(rows.filter((row) => selected.has(row.id))),
    }),
  }
  const importAction = useImportAction(translate('import'), importDrawer.open)
  const exportAction = useExportAction(
    `${translate('exportCSV')}${filtered ? ' (filtered)' : ''}`,
    localizedHref(exportUrl(params)),
  )
  const pageItems = [canWrite && importAction, exportAction]
  const access = useMemo(() => ({ canWrite, canDelete }), [canWrite, canDelete])
  const open = useStableCallback(openClient)
  const toggle = useStableCallback(toggleRow)
  const run = useStableCallback(command)
  const act = useMemo<RowActions>(
    () => ({ open, toggle, prefetch, command: run }),
    [open, toggle, prefetch, run],
  )
  const allColumns = useMemo(() => clientColumns(access, act), [access, act])
  const columns = useMemo(
    () => allColumns.filter((column) => !hiddenColumns.hidden.includes(column.id)),
    [allColumns, hiddenColumns.hidden],
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
        menu={pageItems}
      />
      {importDrawer.isOpen && <ImportDrawer kind="clients" onClose={importDrawer.close} />}
      {dropping && <DropOverlay title={translate('dropToReadTheseFilesIntoNewClients')} />}
      <PageContextMenu
        title={translate('clients')}
        primary={{ label: translate('newClient'), onSelect: () => setForm({}) }}
        actions={pageItems}
        selectAll={
          rows.length && !allSelected
            ? { onSelect: () => setSelected(new Set(rows.map((row) => row.id))) }
            : undefined
        }
        onRefresh={() => void list.refetch()}
      >
        <div className="relative flex flex-1 flex-col">
          <ListToolbar className="flex-wrap gap-y-2 py-2">
            <ListFilters fields={queryFields} params={params} onChange={update} />
            <ListSearch
              label={translate('searchClients')}
              placeholder={translate('searchNameEmailCityVATOrNumber')}
              value={search}
              onChange={setSearch}
              query={{ fields: queryFields, params, onChange: update }}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-title-sm font-normal">
                  <SlidersHorizontal className="stroke-[1.5]" />
                  <span className="max-sm:sr-only">{translate('customize')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                aria-label={translate('customize')}
                className="w-64 gap-1 p-2"
              >
                <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                  {translate('columns')}
                </p>
                <ColumnsCustomize
                  table="clients"
                  columns={allColumns.map((column) => ({
                    id: column.id,
                    label: column.id === 'number' ? translate('number') : column.header,
                    required: column.id === 'name',
                  }))}
                  hidden={hiddenColumns.hidden}
                  onToggle={hiddenColumns.toggle}
                />
              </PopoverContent>
            </Popover>
          </ListToolbar>

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
              <DataTable
                id="clients"
                className="hidden @4xl:table"
                columns={columns}
                data={rows}
                getRowId={(client) => client.id}
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
                  allLabel: translate('selectAllClientsOnThisPage'),
                  rowLabel: (client) => translate('select', { name: client.name }),
                }}
                onRowClick={(client) => act.open(client.id)}
                rowProps={(client) => ({ onPointerEnter: () => act.prefetch(client.id) })}
                renderRow={(client, tr) => (
                  <RowContextMenu
                    menu={clientMenu(client, access, () => act.open(client.id), act.command)}
                    bulk={selected.has(client.id) ? selection : undefined}
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
      {portalChange && (
        <ConfirmDialog
          tone="default"
          title={translate(portalChange.enabled ? 'bulkEnablePortal' : 'bulkDisablePortal')}
          body={translate(portalChange.enabled ? 'bulkEnablePortalBody' : 'bulkDisablePortalBody', {
            count: portalChange.ids.length,
          })}
          confirmLabel={translate(portalChange.enabled ? 'bulkEnablePortal' : 'bulkDisablePortal')}
          onDecide={(approved) => {
            const { ids, enabled } = portalChange
            setPortalChange(null)
            if (!approved) return
            bulk.mutate(
              { ids, action: enabled ? 'enable_portal' : 'disable_portal' },
              {
                onSuccess: ({ data }) => {
                  toast.success(
                    translate(enabled ? 'bulkPortalEnabled' : 'bulkPortalDisabled', {
                      count: data.updated,
                    }),
                    {
                      description: data.missing_email
                        ? translate('bulkPortalMissingEmail', { count: data.missing_email })
                        : undefined,
                    },
                  )
                  setSelected((current) => {
                    const remaining = new Set(current)
                    for (const id of ids) remaining.delete(id)
                    return remaining
                  })
                },
                onError: toastError,
              },
            )
          }}
        />
      )}
    </>
  )
}

/** The bulk bar's buttons; deleting only for those allowed to. */
export function bulkActions(
  canDelete: boolean,
  run: {
    activate: () => void
    deactivate: () => void
    exportCsv: () => void
    remove: () => void
    portal?: { change: (enabled: boolean) => void; disabled?: string }
  },
) {
  const { portal } = run
  return [
    { label: translate('activate'), icon: <Power />, onClick: run.activate, write: true },
    { label: translate('deactivate'), icon: <PowerOff />, onClick: run.deactivate, write: true },
    ...(portal
      ? [
          {
            label: translate('bulkEnablePortal'),
            icon: <KeyRound />,
            onClick: () => portal.change(true),
            disabled: portal.disabled,
            write: true,
          },
          {
            label: translate('bulkDisablePortal'),
            icon: <LockKeyhole />,
            onClick: () => portal.change(false),
            disabled: portal.disabled,
            write: true,
          },
        ]
      : []),
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
    header: `#${client.number} · ${client.name}`,
    actions: [
      {
        id: 'open',
        group: 'view',
        icon: <PanelRightOpen />,
        label: translate('openDetails'),
        onSelect: onOpen,
      },
      can.canWrite && {
        id: 'toggle',
        group: 'status',
        icon: client.is_active ? <PowerOff /> : <Power />,
        label: client.is_active ? translate('deactivate') : translate('activate'),
        onSelect: () => onCommand('toggle', client),
      },
      can.canWrite && {
        id: 'edit',
        group: 'edit',
        icon: <Pencil />,
        label: translate('edit4'),
        onSelect: () => onCommand('edit', client),
      },
      can.canDelete && {
        id: 'delete',
        group: 'danger',
        icon: <Trash2 />,
        label: translate('delete'),
        onSelect: () => onCommand('delete', client),
      },
    ],
  }
}

const STATUS_LABELS: Record<ClientStatus, string> = {
  active: translate('active'),
  inactive: translate('inactive'),
  draft: translate('draft'),
  complete: translate('completeAddress'),
}

/** The search's field terms: `status:`, `type:`, `tag:`, `country:`, `name:`, `email:`, `city:`. */
function useQueryFields(): QueryField<ListParams>[] {
  const tags = useClientTags()
  return [
    {
      id: 'status',
      label: translate('status'),
      type: 'enum',
      values: STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
      tones: STATUS_TONES.client,
      // A quick view shows as the active tab; only another combination needs chips.
      get: (params) => (statusView(params.status) === null ? params.status : []),
      set: (status, params) =>
        status.length || statusView(params.status) === null
          ? { status: among(STATUSES, status) }
          : {},
    },
    {
      id: 'type',
      label: translate('type'),
      type: 'enum',
      values: [
        { value: 'company', label: translate('companies') },
        { value: 'person', label: translate('people') },
      ],
      placeholder: translate('anyType'),
      ...oneValue(
        (params) => params.type,
        (type) => ({ type: type === 'company' || type === 'person' ? type : null }),
      ),
    },
    {
      id: 'tag',
      label: translate('tags'),
      type: 'tag',
      values: tags.data?.map((tag) => ({ value: tag.name, label: tag.name })),
      placeholder: translate('anyTag'),
      get: (params) => params.tags,
      set: (names) => ({ tags: names }),
    },
    {
      id: 'country',
      label: translate('country'),
      type: 'enum',
      values: COUNTRY_OPTIONS,
      kind: 'location',
      placeholder: translate('anyCountry'),
      get: (params) => params.countries,
      set: (countries) => ({ countries }),
    },
    {
      id: 'created',
      label: translate('created3'),
      type: 'enum',
      values: sinceOptions(),
      kind: 'date',
      placeholder: translate('createdAnyTime'),
      ...oneValue(
        (params) => params.created,
        (created) => ({ created: SINCE_PRESETS.find((preset) => preset === created) ?? null }),
      ),
    },
    ...TEXT_FIELDS.map(({ id, label }): QueryField<ListParams> => ({
      id,
      label,
      type: 'text',
      kind: id === 'city' ? 'location' : 'text',
      ...oneValue(
        (params) => params[id],
        (value) => ({ [id]: value ?? '' }),
      ),
    })),
  ]
}

const TEXT_FIELDS = [
  { id: 'name', label: translate('name') },
  { id: 'email', label: translate('email') },
  { id: 'city', label: translate('city') },
] as const

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

function clientColumns(access: RowProps['access'], act: RowActions): DataColumn<Client>[] {
  return [
    {
      id: 'number',
      header: translate('no'),
      size: 76,
      minSize: 56,
      sortable: true,
      cell: (client) => <span className="font-code text-muted-foreground">#{client.number}</span>,
    },
    {
      id: 'name',
      header: translate('name'),
      flex: true,
      sortable: true,
      cell: (client) => <NameCell client={client} onOpen={() => act.open(client.id)} />,
    },
    {
      id: 'type',
      header: translate('type'),
      size: 110,
      minSize: 96,
      cell: (client) => <ClientTypeBadge company={client.is_company} />,
    },
    {
      id: 'phone',
      header: translate('phone'),
      size: 150,
      minSize: 96,
      showFrom: 1100,
      cell: (client) =>
        client.phone ? (
          <span className="font-code">{displayPhone(client.phone)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'city',
      header: translate('city'),
      size: 160,
      minSize: 88,
      sortable: true,
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
      header: translate('tags'),
      size: 150,
      minSize: 80,
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
      header: translate('status'),
      size: 160,
      cell: (client) => <ClientRowStatus client={client} />,
    },
    {
      id: 'created',
      header: translate('added3'),
      size: 120,
      minSize: 100,
      sortable: true,
      sortDescFirst: true,
      showFrom: 1100,
      cell: (client) => (
        <span className="text-muted-foreground">{formatDate(client.created_at)}</span>
      ),
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      size: 48,
      cell: (client) => (
        <RowMenuButton
          label={translate('actionsFor', { name: client.name })}
          menu={clientMenu(client, access, () => act.open(client.id), act.command)}
        />
      ),
    },
  ]
}

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
