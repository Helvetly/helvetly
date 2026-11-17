'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@helvetly/ui/components/dropdown-menu'
import { cn } from '@helvetly/ui/lib/utils'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  CalendarClock,
  ClipboardCheck,
  Layers,
  ReceiptText,
  Search,
  SearchX,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ExportItem } from '@/components/billing/feature-lock'
import { listTable, Pager } from '@/components/data/list-table'
import { LoadProblem } from '@/components/data/load-problem'
import { dropdownKit } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { ImportItem, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { Kpi, KpiBand, TickGauge } from '@/components/kpi-band'
import { PageHeader } from '@/components/shell/page-header'
import {
  exportUrl,
  getEngagementSettings,
  getEngagementSummary,
  ALL_STATUSES,
  engagementListQuery,
  engagementQuery,
  putEngagementSettings,
  periodLabel,
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

/** The "…" menu's own items: export what the filters show, and (owner/admin) the daily digest. */
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
  const { Item } = dropdownKit
  return (
    <>
      {canWrite && (
        <ImportItem Item={Item} onSelect={importDrawer.open}>
          {translate('import')}
        </ImportItem>
      )}
      <ExportItem Item={Item} href={localizedHref(exportUrl(filters))}>
        {translate('exportCSV')}
      </ExportItem>
      {canManage && (
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
      )}
    </>
  )
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
  const showForm = creating || url.get('new') === '1'

  // Search waits for a pause in typing, then goes to the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const params: EngagementQuery = { ...VIEWS[view]?.query, q: term || undefined, page }
  const menu = useMenu({ ...VIEWS[view]?.query, q: term || undefined })
  const list = useQuery({ ...engagementListQuery(params), placeholderData: keepPreviousData })
  const prefetch = usePrefetch(engagementQuery)
  const summary = useQuery({
    queryKey: [...queryKeys.engagements, 'summary'],
    queryFn: async () => (await getEngagementSummary()).data,
  })

  const select = (index: number) => {
    setView(index)
    setPage(1)
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
    if (url.get('new') !== '1') return
    const next = new URLSearchParams(url)
    next.delete('new')
    setUrlQuery(pathname, next)
  }

  const rows = list.data?.data ?? []
  const meta = list.data?.meta
  const stats = summary.data
  const share = (count: number) => (stats && stats.active > 0 ? count / stats.active : 0)

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
        menu={menu}
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
                term ? translate('nothingMatches3', { term: term }) : translate('nothingInThisView')
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
                  {HEADERS.map(([label, width]) => (
                    <th key={label} className={cn(listTable.th, width)}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((engagement) => (
                  <tr
                    key={engagement.id}
                    onPointerEnter={() => prefetch(engagement.id)}
                    onClick={() => openEngagement(engagement.id)}
                    className={cn(listTable.row, 'cursor-pointer')}
                  >
                    <td className={listTable.td}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          openEngagement(engagement.id)
                        }}
                        className="block w-full cursor-pointer text-left"
                      >
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
                      <BillingLabel engagement={engagement} />
                    </td>
                    <td className={listTable.td}>
                      {engagement.attention.length ? (
                        <AttentionBadges attention={engagement.attention} />
                      ) : (
                        <EngagementStatusBadge status={engagement.status} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className={cn(listTable.list, '@4xl:hidden')}>
              {rows.map((engagement) => (
                <li key={engagement.id}>
                  <button
                    type="button"
                    onPointerEnter={() => prefetch(engagement.id)}
                    onClick={() => openEngagement(engagement.id)}
                    className="grid w-full cursor-pointer gap-2 px-4 py-3 text-left"
                  >
                    <TitleCell engagement={engagement} />
                    {engagement.current_period && (
                      <ProgressBar period={engagement.current_period} unit={engagement.unit} />
                    )}
                    <AttentionBadges attention={engagement.attention} />
                  </button>
                </li>
              ))}
            </ul>

            {meta && <Pager meta={meta} onPage={setPage} />}
          </div>
        )}
      </div>

      {openId && (
        <EngagementDetail
          key={`detail:${openId}`}
          id={openId}
          onOpenChange={(open) => !open && openEngagement(null)}
        />
      )}
      <EngagementForm
        open={showForm}
        onOpenChange={closeForm}
        onSaved={(saved) => openEngagement(saved.id)}
      />
    </>
  )
}
