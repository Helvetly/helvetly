'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { CalendarDays, ChevronDown, LayoutGrid } from 'lucide-react'
import { useState } from 'react'

import { useDrawers } from '@/components/record-link'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage, type Session } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { SUMMARY_PERIODS, formatRange, useInvoiceSummary, type SummaryPeriod } from '@/lib/invoices'
import { can, effectiveScopes, type Need } from '@/lib/permissions'
import { useSession } from '@/lib/queries'

import {
  DASHBOARD_CARDS,
  DEFAULT_CARD_ORDER,
  DashboardCustomize,
  DashboardGrid,
} from './dashboard-customize'
import { DashboardKpis } from './dashboard-kpis'
import {
  dashboardLayoutKey,
  loadDashboardLayout,
  mergeDashboardLayout,
  saveDashboardLayout,
  type DashboardLayout,
} from './dashboard-layout'
import { firstName, greetingKey } from './figures'
import { WorkspaceAuditButton } from './workspace-audit'

const GREETINGS = {
  goodMorningName: [
    () => translate('goodMorning'),
    (name: string) => translate('goodMorningName', { name }),
  ],
  goodAfternoonName: [
    () => translate('goodAfternoon'),
    (name: string) => translate('goodAfternoonName', { name }),
  ],
  goodEveningName: [
    () => translate('goodEvening'),
    (name: string) => translate('goodEveningName', { name }),
  ],
} as const

/** "Good morning, Anna" by the person's clock; without a name, just the greeting. */
function greeting(name: string | undefined, now = new Date()) {
  const [plain, named] = GREETINGS[greetingKey(now.getHours())]
  const first = firstName(name)
  return first ? named(first) : plain()
}

export function Dashboard() {
  const session = useSession()
  if (session.error) {
    return (
      <div className="grid justify-items-start gap-3 p-5">
        <p role="alert" className="text-sm text-muted-foreground">
          {translate('workspaceOverviewCouldnTBeLoaded')}
          {errorMessage(session.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void session.refetch()}>
          {translate('retryWorkspaceOverview')}
        </Button>
      </div>
    )
  }
  if (!session.data) {
    return (
      <div className="p-5">
        <Loader label={translate('loadingWorkspaceOverview')} className="min-h-56" />
      </div>
    )
  }
  // Each workspace and person has their own layout; a switch starts from theirs.
  const layoutKey = dashboardLayoutKey(session.data.workspace.id, session.data.user.id)
  return <DashboardPage key={layoutKey} session={session.data} layoutKey={layoutKey} />
}

function DashboardPage({ session, layoutKey }: { session: Session; layoutKey: string }) {
  const drawers = useDrawers()
  const [period, setPeriod] = useRememberedPeriod()
  const [layout, setLayout] = useState(() => loadDashboardLayout(layoutKey, DEFAULT_CARD_ORDER))
  const scopes = effectiveScopes(session.role, session.scopes)
  const allows = (need: Need) => can(scopes, need)
  const canReadInvoices = allows('read:invoices')
  const canAudit =
    canReadInvoices || allows('read:expenses') || allows('read:clients') || allows('read:documents')
  const cards = layout.order.flatMap((id) => {
    const card = DASHBOARD_CARDS.find((entry) => entry.id === id)
    return card && card.requiresAny.some(allows) ? [card] : []
  })
  const visible = cards.filter((card) => !layout.hidden.includes(card.id))
  const changeLayout = (next: DashboardLayout | null) => {
    setLayout(next ?? mergeDashboardLayout(DEFAULT_CARD_ORDER, null))
    saveDashboardLayout(layoutKey, next)
  }

  return (
    <>
      <PageHeader
        tabs={[translate('dashboard')]}
        tabIcons={[LayoutGrid]}
        primary={allows('write:invoices') ? translate('newInvoice') : undefined}
        onPrimary={() => drawers.open({ kind: 'invoice', mode: 'new' })}
        actions={
          <>
            {canReadInvoices && <PeriodFilter value={period} onChange={setPeriod} />}
            {canAudit && (
              <WorkspaceAuditButton
                key={[
                  session.workspace.id,
                  session.user.id,
                  session.role,
                  ...(session.scopes ?? []),
                ].join('/')}
              />
            )}
            {cards.length > 0 && (
              <DashboardCustomize cards={cards} layout={layout} onChange={changeLayout} />
            )}
          </>
        }
      />
      <div className="grid flex-1 content-start gap-4 p-4 md:p-6">
        <div className="grid min-w-0 gap-1">
          {/* The page's heading is the bar's "Dashboard"; the greeting is its welcome. */}
          <p className="truncate text-page leading-tight font-medium tracking-[-0.01em]">
            {greeting(session.user.name)}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {translate('heresWhatSHappeningWithYourBusiness')}
          </p>
        </div>
        <DashboardKpis period={period} />
        {visible.length > 0 && (
          <DashboardGrid cards={visible} layout={layout} onChange={changeLayout} />
        )}
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate('yourWorkspaceOverviewShowsTheSectionsYouHavePermission')}
          </p>
        ) : (
          visible.length === 0 && (
            <p className="text-sm text-muted-foreground">{translate('dashboardAllCardsHidden')}</p>
          )
        )}
      </div>
    </>
  )
}

const PERIOD_KEY = 'helvetly.dashboard.period'

/** The dashboard's period, remembered in this browser (storage may be unavailable: then this month). */
function useRememberedPeriod() {
  const [period, setPeriod] = useState<SummaryPeriod>(() => {
    try {
      const saved = window.localStorage.getItem(PERIOD_KEY)
      return SUMMARY_PERIODS.find((entry) => entry.value === saved)?.value ?? 'this_month'
    } catch {
      return 'this_month'
    }
  })
  const choose = (next: SummaryPeriod) => {
    setPeriod(next)
    try {
      window.localStorage.setItem(PERIOD_KEY, next)
    } catch {
      // Not remembered; the choice still applies now.
    }
  }
  return [period, choose] as const
}

/** The period of the key figures: one button naming the period and its dates, a menu to change it. */
function PeriodFilter({
  value,
  onChange,
}: {
  value: SummaryPeriod
  onChange: (period: SummaryPeriod) => void
}) {
  // The same query the key figures run; the range is the workspace's, resolved by the API.
  const resolved = useInvoiceSummary(undefined, value).data?.period
  const range = resolved?.name === value ? formatRange(resolved.from, resolved.to) : null
  const label = SUMMARY_PERIODS.find((period) => period.value === value)?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-0 font-normal">
          <CalendarDays className="stroke-[1.5] text-muted-foreground" />
          <span className="sr-only">{translate('period2')}</span>
          <span className="truncate">{label}</span>
          {range && (
            <span className="truncate text-muted-foreground @max-[40rem]:hidden">{range}</span>
          )}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {translate('keyFiguresFor')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const period = SUMMARY_PERIODS.find((entry) => entry.value === next)
            if (period) onChange(period.value)
          }}
        >
          {SUMMARY_PERIODS.map((period) => (
            <DropdownMenuRadioItem key={period.value} value={period.value}>
              {period.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
