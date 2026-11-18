'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@helvetly/ui/components/dropdown-menu'
import { cn } from '@helvetly/ui/lib/utils'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Ban,
  CalendarClock,
  ClipboardCheck,
  Download,
  Layers,
  PanelRightOpen,
  Pencil,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  Trash2,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ExportItem, unlessLocked, useFeatureLock } from '@/components/billing/feature-lock'
import { listTable, Pager } from '@/components/data/list-table'
import { LoadProblem } from '@/components/data/load-problem'
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
import { Kpi, KpiBand, TickGauge } from '@/components/kpi-band'
import { PageHeader } from '@/components/shell/page-header'
import { ApiError, errorMessage } from '@/lib/api'
import {
  cancelEngagement,
  deleteEngagement,
  exportIdsUrl,
  exportUrl,
  getEngagementSettings,
  getEngagementSummary,
  ALL_STATUSES,
  engagementListQuery,
  engagementQuery,
  putEngagementSettings,
  billingOf,
  periodLabel,
  renewEngagement,
  resumeEngagement,
  type Engagement,
  type EngagementQuery,
} from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { queryKeys, usePrefetch, useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'

import {
  AttentionBadges,
  BillingLabel,
  EngagementStatusBadge,
  plain,
  ProgressBar,
  unitShort,
} from './engagement-bits'
import { EngagementDetail } from './engagement-detail'
import { EngagementForm } from './engagement-form'
import { friendlyError, useRefreshEngagement } from './entry-log'

const LIVE = 'scheduled,active'

const VIEWS: {
  label: string
  icon: LucideIcon
  query: Pick<EngagementQuery, 'status' | 'attention'>
}[] = [
  // First, like every other list; the API puts running engagements on top and finished ones after.
  { label: translate('all'), icon: Layers, query: { status: ALL_STATUSES } },
  { label: translate('active'), icon: ClipboardCheck, query: { status: LIVE } },
  {
    label: translate('endingSoon'),
    icon: CalendarClock,
    query: { status: LIVE, attention: 'ending_soon' },
  },
  {
    label: translate('behindPace'),
    icon: TrendingDown,
    query: { status: LIVE, attention: 'under_pace' },
  },
  // to_invoice also covers ended engagements (contract: Summary).
  {
    label: translate('needsInvoicing'),
    icon: ReceiptText,
    query: { status: 'scheduled,active,ended', attention: 'to_invoice' },
  },
  { label: translate('ended'), icon: Archive, query: { status: 'ended,cancelled' } },
]

const dash = <span className="text-muted-foreground">—</span>
const DAY = 86_400_000

/** Whole days from today to an ISO date, both read as civil dates (no time zone drift). */
function daysUntil(iso: string) {
  const today = new Date()
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - from) / DAY)
}

function PeriodCell({ engagement }: { engagement: Engagement }) {
  const period = engagement.current_period
  if (!period) return dash
  const left = daysUntil(period.ends_on) + 1
  return (
    <span className="grid leading-tight">
      <span className="whitespace-nowrap">{periodLabel(period)}</span>
      <span className="text-[12px] text-muted-foreground">
        {engagement.status === 'ended' || engagement.status === 'cancelled'
          ? translate('ended')
          : period.state === 'upcoming'
            ? translate('notStarted')
            : left <= 0
              ? translate('endsToday')
              : translate('dynamicLeft', {
                  left: left,
                  value2: left === 1 ? translate('dynamicDay') : translate('days'),
                })}
      </span>
    </span>
  )
}

function RemainingCell({ engagement }: { engagement: Engagement }) {
  const period = engagement.current_period
  if (!period) return dash
  const unit = unitShort(engagement.unit)
  const over = Number(period.overage) > 0
  return (
    <span className={cn('tabular-nums', over && 'text-amber-700 dark:text-amber-400')}>
      {over ? translate('over3', { value1: plain(period.overage) }) : plain(period.remaining)}
      {unit && !over && <span className="text-muted-foreground"> {unit}</span>}
    </span>
  )
}

const TitleCell = ({ engagement }: { engagement: Engagement }) => (
  <span className="grid min-w-0 leading-snug">
    <span className="truncate text-[15px]">{engagement.title}</span>
    <span className="truncate text-[13px] text-muted-foreground">
      {engagement.client.name} · #{engagement.number}
    </span>
  </span>
)

const HEADERS = [
  [translate('engagement2'), 'w-[26%]'],
  [translate('period'), 'w-[17%]'],
  [translate('progress'), 'w-[20%]'],
  [translate('remaining'), 'w-[10%] text-right'],
  [translate('billing'), 'w-[10%]'],
  [translate('attention'), 'w-[17%]'],
] as const

type Command = 'edit' | 'renew' | 'cancel' | 'resume' | 'delete'
type Access = { canWrite: boolean; canManage: boolean }

/** A row's actions, for its "…" button and its right-click menu: the drawer's own, no more. */
export function engagementMenu(
  engagement: Engagement,
  access: Access,
  onOpen: () => void,
  onCommand: (command: Command, engagement: Engagement) => void,
): RowMenuSpec {
  const cancellable = engagement.status === 'active' || engagement.status === 'scheduled'
  const manage = access.canWrite && access.canManage
  return {
    title: `#${engagement.number} · ${engagement.client.name}`,
    items: ({ Item, Separator }) => (
      <>
        <Item onSelect={onOpen}>
          <PanelRightOpen />
          {translate('openDetails')}
        </Item>
        {access.canWrite && (
          <Item onSelect={() => onCommand('edit', engagement)}>
            <Pencil />
            {translate('edit4')}
          </Item>
        )}
        {access.canWrite && engagement.recurrence === 'none' && (
          <Item onSelect={() => onCommand('renew', engagement)}>
            <RefreshCw />
            {translate('renew')}
          </Item>
        )}
        {manage && (cancellable || engagement.status === 'cancelled') && (
          <Item onSelect={() => onCommand(cancellable ? 'cancel' : 'resume', engagement)}>
            {cancellable ? <Ban /> : <RotateCcw />}
            {cancellable ? translate('cancelEngagement') : translate('resume')}
          </Item>
        )}
        {manage && (
          <>
            <Separator />
            <Item variant="destructive" onSelect={() => onCommand('delete', engagement)}>
              <Trash2 />
              {translate('delete')}
            </Item>
          </>
        )}
      </>
    ),
  }
}

/** The bulk bar's buttons: export for everyone, delete for owners and admins. */
export function bulkActions(
  canManage: boolean,
  run: { exportCsv: () => void; remove: () => void },
): BulkAction[] {
  return [
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

/** Why one delete failed: invoiced engagements stay, the rest is the API's own message. */
const deleteProblem = (error: unknown) =>
  error instanceof ApiError && error.code === 'engagement_invoiced'
    ? translate('thisEngagementHasInvoicesVoidOrDeleteThemFirst')
    : errorMessage(error)

type RowProps = {
  engagement: Engagement
  selected: boolean
  bulk?: { count: number; actions: BulkAction[] }
  menu: RowMenuSpec
  onOpen: () => void
  onToggle: () => void
  onPrefetch: () => void
}

function EngagementRow({
  engagement,
  selected,
  bulk,
  menu,
  onOpen,
  onToggle,
  onPrefetch,
}: RowProps) {
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <tr
        data-selected={selected || undefined}
        onPointerEnter={onPrefetch}
        onClick={(event) => {
          // The row's own controls, and portalled menus React bubbles up here, do their own thing.
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, a, [role=checkbox], input')
          )
            return
          onOpen()
        }}
        className={cn(listTable.row, 'cursor-pointer')}
      >
        <td className={listTable.select}>
          <Checkbox
            aria-label={translate('select', { name: engagement.title })}
            className="bg-card"
            checked={selected}
            onCheckedChange={onToggle}
          />
        </td>
        <td className={listTable.td}>
          <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left">
            <TitleCell engagement={engagement} />
          </button>
        </td>
        <td className={listTable.td}>
          <PeriodCell engagement={engagement} />
        </td>
        <td className={listTable.td}>
          {engagement.current_period ? (
            <ProgressBar period={engagement.current_period} unit={engagement.unit} />
          ) : (
            dash
          )}
        </td>
        <td className={cn(listTable.td, listTable.numeric)}>
          <RemainingCell engagement={engagement} />
        </td>
        <td className={listTable.td}>
          <BillingLabel engagement={{ ...engagement, billing: billingOf(engagement) }} />
        </td>
        <td className={listTable.td}>
          {engagement.attention.length ? (
            <AttentionBadges attention={engagement.attention} />
          ) : (
            <EngagementStatusBadge status={engagement.status} />
          )}
        </td>
        <td className={listTable.menu}>
          <RowMenuButton label={translate('actionsFor', { name: engagement.title })} menu={menu} />
        </td>
      </tr>
    </RowContextMenu>
  )
}

function EngagementItem({
  engagement,
  selected,
  bulk,
  menu,
  onOpen,
  onToggle,
  onPrefetch,
}: RowProps) {
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <li
        data-selected={selected || undefined}
        onPointerEnter={onPrefetch}
        className={listTable.item}
      >
        <Checkbox
          aria-label={translate('select', { name: engagement.title })}
          className="bg-card"
          checked={selected}
          onCheckedChange={onToggle}
        />
        <button
          type="button"
          onClick={onOpen}
          className="grid min-w-0 flex-1 cursor-pointer gap-2 text-left"
        >
          <TitleCell engagement={engagement} />
          {engagement.current_period && (
            <ProgressBar period={engagement.current_period} unit={engagement.unit} />
          )}
          <AttentionBadges attention={engagement.attention} />
        </button>
      </li>
    </RowContextMenu>
  )
}

/** The page's actions (import, export what the filters show) and the "…" menu's owner/admin daily digest. */
function useMenu(filters: EngagementQuery) {
  const client = useQueryClient()
  const canWrite = useCan('write:engagements')
  const importDrawer = useImportDrawer()
  const role = useSession().data?.role
  const canManage = role === 'owner' || role === 'admin'
  const key = [...queryKeys.engagements, 'settings']
  const settings = useQuery({
    queryKey: key,
    queryFn: getEngagementSettings,
    enabled: canManage,
  })
  const toggle = useMutation({
    mutationFn: putEngagementSettings,
    onMutate: async (body) => {
      await client.cancelQueries({ queryKey: key })
      const before = client.getQueryData(key)
      client.setQueryData(key, body)
      return { before }
    },
    onError: (_error, _body, context) => {
      client.setQueryData(key, context?.before)
      toast.error(translate('couldNotChangeTheDailyDigest'))
    },
  })
  const items = ({ Item }: MenuKit) => (
    <>
      {canWrite && (
        <ImportItem Item={Item} onSelect={importDrawer.open}>
          {translate('import')}
        </ImportItem>
      )}
      <ExportItem Item={Item} href={localizedHref(exportUrl(filters))}>
        {translate('exportCSV')}
      </ExportItem>
    </>
  )
  const digestToggle = canManage && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={settings.data?.digest ?? false}
        disabled={!settings.data}
        onCheckedChange={(digest) => toggle.mutate({ digest })}
        className="items-start"
      >
        <span className="grid leading-snug">
          {translate('dailyEMailDigest')}
          <span className="text-[12px] text-muted-foreground">
            {translate('eachMorningWhatNeedsInvoicingOrIsEndingSoon')}
          </span>
        </span>
      </DropdownMenuCheckboxItem>
    </>
  )
  return { items, digestToggle }
}

/** The work you committed to per client: server-side views, search and paging. */
export function EngagementsPage() {
  const canWrite = useCan('write:engagements')
  const importDrawer = useImportDrawer()
  const pathname = usePathname()
  const url = useSearchParams()
  const openId = url.get('id')
  const [view, setView] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Engagement | null>(null)
  const [deleting, setDeleting] = useState<Engagement[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const showForm = creating || url.get('new') === '1'
  const role = useSession().data?.role
  const access = { canWrite, canManage: role === 'owner' || role === 'admin' }
  const refresh = useRefreshEngagement()
  const exportLock = useFeatureLock('data_export')
  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => refresh(),
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })

  // Search waits for a pause in typing, then goes to the server. Only a changed term resets page and selection.
  useEffect(() => {
    const next = search.trim()
    if (next === term) return
    const timer = setTimeout(() => {
      setTerm(next)
      setPage(1)
      setSelected(new Set())
    }, 300)
    return () => clearTimeout(timer)
  }, [search, term])

  const params: EngagementQuery = { ...VIEWS[view]?.query, q: term || undefined, page }
  const { items, digestToggle } = useMenu({ ...VIEWS[view]?.query, q: term || undefined })
  const list = useQuery({ ...engagementListQuery(params), placeholderData: keepPreviousData })
  const prefetch = usePrefetch(engagementQuery)
  const summary = useQuery({
    queryKey: [...queryKeys.engagements, 'summary'],
    queryFn: async () => (await getEngagementSummary()).data,
  })

  const select = (index: number) => {
    setView(index)
    setPage(1)
    setSelected(new Set())
  }
  const turnPage = (next: number) => {
    setPage(next)
    setSelected(new Set())
  }
  const openEngagement = (id: string | null) => {
    const next = new URLSearchParams(url)
    if (id) next.set('id', id)
    else next.delete('id')
    setUrlQuery(pathname, next)
  }
  const closeForm = (open: boolean) => {
    if (open) return
    setCreating(false)
    setEditing(null)
    if (url.get('new') !== '1') return
    const next = new URLSearchParams(url)
    next.delete('new')
    setUrlQuery(pathname, next)
  }

  const rows = list.data?.data ?? []
  const meta = list.data?.meta
  const stats = summary.data
  const share = (count: number) => (stats && stats.active > 0 ? count / stats.active : 0)

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const command = (name: Command, engagement: Engagement) => {
    if (name === 'edit') setEditing(engagement)
    if (name === 'delete') setDeleting([engagement])
    if (name === 'renew')
      act.mutate(async () => {
        await renewEngagement(engagement.id)
        toast.success(translate('renewedForTheNextPeriod'))
      })
    if (name === 'cancel') act.mutate(() => cancelEngagement(engagement.id))
    if (name === 'resume') act.mutate(() => resumeEngagement(engagement.id))
  }
  const confirmDelete = async (approved: boolean) => {
    const targets = deleting ?? []
    setDeleting(null)
    if (!approved) return
    const results = await Promise.allSettled(targets.map((row) => deleteEngagement(row.id)))
    const failed = results.filter((result) => result.status === 'rejected')
    refresh()
    setSelected(new Set())
    if (targets.length === 1 && failed[0]) toast.error(deleteProblem(failed[0].reason))
    else if (targets.length === 1) toast.success(translate('engagementDeleted'))
    else if (failed.length)
      toast.error(
        translate('engagementsNotDeleted', { failed: failed.length, count: targets.length }),
      )
    else toast.success(translate('engagementsDeleted', { count: targets.length }))
  }
  const selection = {
    count: selected.size,
    actions: bulkActions(access.canWrite && access.canManage, {
      exportCsv: unlessLocked(exportLock, () =>
        window.location.assign(localizedHref(exportIdsUrl([...selected]))),
      ),
      remove: () => setDeleting(rows.filter((row) => selected.has(row.id))),
    }),
  }
  const rowProps = (engagement: Engagement) => ({
    engagement,
    selected: selected.has(engagement.id),
    bulk: selected.has(engagement.id) ? selection : undefined,
    menu: engagementMenu(engagement, access, () => openEngagement(engagement.id), command),
    onOpen: () => openEngagement(engagement.id),
    onToggle: () => toggleRow(engagement.id),
    onPrefetch: () => prefetch(engagement.id),
  })

  return (
    <>
      <PageHeader
        tabs={VIEWS.map((entry) => entry.label)}
        tabIcons={VIEWS.map((entry) => entry.icon)}
        active={view}
        onSelect={select}
        savedViews={false}
        primary={translate('newEngagement2')}
        onPrimary={() => setCreating(true)}
        menu={
          <>
            {items(dropdownKit)}
            {digestToggle}
          </>
        }
      />
      {importDrawer.isOpen && <ImportDrawer kind="engagements" onClose={importDrawer.close} />}
      <KpiBand loading={!stats}>
        {stats && (
          <>
            <Kpi
              label={translate('active')}
              value={String(stats.active)}
              chart={<TickGauge share={1} />}
            />
            <Kpi
              label={translate('endingSoon')}
              value={String(stats.ending_soon)}
              chart={<TickGauge share={share(stats.ending_soon)} />}
            />
            <Kpi
              label={translate('behindPace')}
              value={String(stats.under_pace)}
              chart={<TickGauge share={share(stats.under_pace)} />}
            />
            <Kpi
              label={translate('overage')}
              value={String(stats.overage)}
              chart={<TickGauge share={share(stats.overage)} />}
            />
            <Kpi
              label={translate('needsInvoicing')}
              value={String(stats.to_invoice)}
              chart={<TickGauge share={share(stats.to_invoice)} />}
            />
          </>
        )}
      </KpiBand>
      <PageContextMenu
        title={translate('engagements')}
        primary={{ label: translate('newEngagement2'), onSelect: () => setCreating(true) }}
        items={items}
        views={{ tabs: VIEWS.map((entry) => entry.label), active: view, onSelect: select }}
        selectAll={
          rows.length && !allSelected
            ? { onSelect: () => setSelected(new Set(rows.map((row) => row.id))) }
            : undefined
        }
        onRefresh={refresh}
      >
        <div className="relative flex flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:px-3">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:text-foreground">
              <Search className="size-4 shrink-0 stroke-[1.5]" />
              <input
                type="search"
                aria-label={translate('searchEngagements')}
                placeholder={translate('searchTitleClientOrReference')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent text-[15px] text-foreground outline-none placeholder:text-placeholder"
              />
            </label>
          </div>

          {list.error ? (
            <LoadProblem
              error={list.error}
              what={translate('engagements')}
              onRetry={() => void list.refetch()}
            />
          ) : !list.data ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            term || view > 0 ? (
              <State
                icon={<SearchX />}
                title={
                  term
                    ? translate('nothingMatches3', { term: term })
                    : translate('nothingInThisView')
                }
                text={translate('tryAnotherSearchOrLookAtAllEngagements')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      select(0)
                    }}
                  >
                    {translate('showAllEngagements')}
                  </Button>
                }
              />
            ) : (
              <State
                icon={<ClipboardCheck />}
                title={translate('noEngagementsYet')}
                text={translate('agreeAQuantityOfWorkPerClientLogWhat')}
                action={
                  canWrite && (
                    <Button size="sm" className="cursor-pointer" onClick={() => setCreating(true)}>
                      {translate('newEngagement2')}
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
                    {HEADERS.map(([label, width]) => (
                      <th key={label} className={cn(listTable.th, width)}>
                        {label}
                      </th>
                    ))}
                    <th className={listTable.menu}>
                      <span className="sr-only">{translate('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((engagement) => (
                    <EngagementRow key={engagement.id} {...rowProps(engagement)} />
                  ))}
                </tbody>
              </table>

              <ul className={cn(listTable.list, '@4xl:hidden')}>
                {rows.map((engagement) => (
                  <EngagementItem key={engagement.id} {...rowProps(engagement)} />
                ))}
              </ul>

              {meta && <Pager meta={meta} onPage={turnPage} />}
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
        <EngagementDetail
          key={`detail:${openId}`}
          id={openId}
          onOpenChange={(open) => !open && openEngagement(null)}
        />
      )}
      <EngagementForm
        key={editing?.id ?? 'new'}
        open={showForm || editing !== null}
        onOpenChange={closeForm}
        engagement={editing ?? undefined}
        onSaved={(saved) => {
          if (!editing) openEngagement(saved.id)
        }}
      />
      {deleting && deleting.length > 0 && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? translate('deleteThisEngagement')
              : translate('deleteEngagements', { count: deleting.length })
          }
          body={translate('itsLogAndPeriodsAreRemovedThisCanT')}
          confirmLabel={translate('delete3')}
          tone="destructive"
          onDecide={(approved) => void confirmDelete(approved)}
        />
      )}
    </>
  )
}
