'use client'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { CalendarCheck2, CalendarDays, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { FeatureLockNotice, useFeatureLock } from '@/components/billing/feature-lock'
import { LoadProblem } from '@/components/data/load-problem'
import { PageHeader } from '@/components/shell/page-header'
import { translate } from '@/lib/i18n'
import { useMembers } from '@/lib/members'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import {
  daysOf,
  periodLabel,
  rangeOf,
  step,
  useBusy,
  useHostProfile,
  useOccurrences,
  useRequests,
  useSchedSettings,
  VIEWS,
  minutesOf,
  weekdayOf,
  zoned,
  zoneName,
  type Occurrence,
  type Person,
  type View,
} from '@/lib/scheduling'
import { getWorkspaceTimezone } from '@/lib/timezone'
import { setUrlQuery } from '@/lib/url-query'

import { useSessionChange } from './bits'
import { useDayOffMove, useDaysOff } from './day-off'
import { FULL_DAY, saveHours, storedHours, workingHours, type HoursChoice } from './hours-menu'
import { ListView } from './list-view'
import { MonthView } from './month-view'
import { PeopleMenu, type HostMode } from './people-menu'
import { RequestsDrawer } from './requests'
import { SessionDrawer, type DrawerTarget } from './session-drawer'
import { TimeGrid } from './time-grid'
import { ViewMenu, type Layout } from './view-menu'

const isView = (value: string | null): value is View => VIEWS.some((view) => view === value)
const VIEW_KEY = 'helvetly.scheduling.view'
const LAYOUT_KEY = 'helvetly.scheduling.layout'
// The last chosen view and layout are a per-browser convenience; storage may be unavailable.
const stored = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

const MAX_LANES = 4

/** The calendar: Day, Week, Month and List of the workspace's sessions, with requests and sessions to mark on top. */
export function SchedulingPage({ now: fixedNow }: { now?: Date }) {
  const [now] = useState(() => fixedNow ?? new Date())
  const params = useSearchParams()
  const pathname = usePathname() ?? '/scheduling'
  const session = useSession().data
  const me = session?.user.id
  const workspaceZone = session?.workspace.timezone ?? getWorkspaceTimezone()
  const profile = useHostProfile(me).data
  const zone = profile?.time_zone ?? workspaceZone
  const lock = useFeatureLock('scheduling')
  const canWrite = useCan('write:scheduling') && !lock

  const [view, setView] = useState<View>(() => {
    const asked = params.get('view')
    if (isView(asked)) return asked
    const saved = stored(VIEW_KEY)
    return isView(saved) ? saved : 'week'
  })
  // "list" was once a view of its own: an old link or saved choice opens the list.
  const [layout, setLayout] = useState<Layout>(() => {
    const asked = params.get('layout') ?? (params.get('view') === 'list' ? 'list' : null)
    if (asked === 'list' || asked === 'calendar') return asked
    const saved = stored(LAYOUT_KEY) ?? (stored(VIEW_KEY) === 'list' ? 'list' : null)
    if (saved === 'list' || saved === 'calendar') return saved
    // Phones get the list: a week of columns does not fit.
    return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches
      ? 'list'
      : 'calendar'
  })
  const [date, setDate] = useState(() => {
    const asked = params.get('date')
    return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : zoned(now, zone).date
  })
  const [hostMode, setHostMode] = useState<HostMode>('me')
  const [picked, setPicked] = useState<string[]>([])
  const [toMark, setToMark] = useState(false)
  const [drawer, setDrawer] = useState<DrawerTarget | null>(() => {
    const id = params.get('session')
    return id ? { kind: 'view', id } : null
  })
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [savedHours, setSavedHours] = useState(storedHours)
  // Until a range is chosen, working hours suggest the host's own (they load after the first render).
  const hoursChoice: HoursChoice = savedHours ?? { mode: 'full', work: workingHours(profile) }
  const chooseHours = (next: HoursChoice) => {
    setSavedHours(next)
    saveHours(next)
  }

  const remember = (next: {
    view?: View
    layout?: Layout
    date?: string
    session?: string | null
  }) => {
    const query = new URLSearchParams(params.toString())
    if (next.view) query.set('view', next.view)
    if (next.layout) query.set('layout', next.layout)
    if (next.date) query.set('date', next.date)
    if (next.session === null) query.delete('session')
    else if (next.session) query.set('session', next.session)
    setUrlQuery(pathname, query)
  }
  const go = (next: string) => {
    setDate(next)
    remember({ date: next })
  }
  const choose = (next: View) => {
    setToMark(false)
    setView(next)
    remember({ view: next })
    store(VIEW_KEY, next)
  }
  const chooseLayout = (next: Layout) => {
    setToMark(false)
    setLayout(next)
    remember({ layout: next })
    store(LAYOUT_KEY, next)
  }
  const openSession = (id: string) => {
    setDrawer({ kind: 'view', id })
    remember({ session: id })
  }
  const closeDrawer = () => {
    setDrawer(null)
    remember({ session: null })
  }

  const members = useMembers()
  const hostParam =
    hostMode === 'me' ? 'me' : hostMode === 'pick' && picked.length ? picked.join(',') : 'all'
  const range = rangeOf(view, date, zone)
  const occurrences = useOccurrences({ ...range, host: hostParam })
  const busy = useBusy(
    { ...range, host: hostParam },
    layout === 'calendar' && (view === 'day' || view === 'week'),
  )
  const requests = useRequests()
  const markRange = {
    from: new Date(now.getTime() - 100 * 86_400_000).toISOString(),
    to: now.toISOString(),
  }
  const unmarked = useOccurrences({ ...markRange, host: hostParam, to_mark: true })
  useSchedSettings()
  const change = useSessionChange()
  const daysOff = useDaysOff()
  const dayOffMove = useDayOffMove(daysOff, zone, change.move)
  const shownDays = daysOf(view, date)
  const daysOffShown = new Map([...daysOff].filter(([day]) => shownDays.includes(day)))

  const list: Occurrence[] = toMark ? (unmarked.data ?? []) : (occurrences.data ?? [])
  const waiting = requests.data?.length ?? 0
  const toMarkCount = unmarked.data?.length ?? 0

  const hostOptions = (members.data ?? []).map((member) => ({
    value: member.user_id,
    label: member.name || member.email,
  }))
  const seen = new Map<string, Person>()
  for (const entry of list) if (entry.host) seen.set(entry.host.id, entry.host)
  const laneHosts: Person[] =
    hostMode === 'pick' && picked.length > 1
      ? picked.flatMap((id) => {
          const option = hostOptions.find((entry) => entry.value === id)
          return option ? [{ id, name: option.label }] : []
        })
      : hostMode === 'all'
        ? [...seen.values()].toSorted((a, b) => a.name.localeCompare(b.name))
        : []
  const lanes = laneHosts.length > 1 && laneHosts.length <= MAX_LANES ? laneHosts : null

  const today = zoned(now, zone).date
  const newAt = (day: string, minutes?: number, hostId?: string) => {
    if (!me) return
    const nextHour = Math.min(23, Math.ceil(zoned(now, zone).minutes / 60)) * 60
    // Another day starts when the host's hours that weekday do, else at 09:00.
    const workStarts = (profile?.weekly ?? [])
      .filter((entry) => entry.day === weekdayOf(day))
      .map((entry) => minutesOf(entry.start))
    setDrawer({
      kind: 'create',
      start: {
        date: day,
        minutes:
          minutes ??
          (day === today ? nextHour : workStarts.length ? Math.min(...workStarts) : 9 * 60),
        hostId: hostId ?? me,
        location: null,
      },
    })
  }

  return (
    <>
      <PageHeader
        tabs={[translate('schedScheduling')]}
        tabIcons={[CalendarDays]}
        savedViews={false}
        primary={canWrite ? translate('schedNewSession') : undefined}
        onPrimary={canWrite ? () => newAt(date) : undefined}
        start={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => go(today)}>
              {translate('today')}
            </Button>
            <div className="flex shrink-0 items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('schedPrevious')}
                    onClick={() => go(step(view, date, -1))}
                  >
                    <ChevronLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('schedPrevious')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('schedNext')}
                    onClick={() => go(step(view, date, 1))}
                  >
                    <ChevronRight />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('schedNext')}</TooltipContent>
              </Tooltip>
            </div>
            <h2 className="truncate text-title-sm font-semibold" aria-live="polite">
              {toMark ? translate('schedToMarkTitle') : periodLabel(view, date)}
            </h2>
            {zone !== workspaceZone && (
              <span className="truncate text-body-sm text-muted-foreground max-lg:hidden">
                {translate('schedTimesIn', {
                  zone: zoneName(zone),
                  workspace: zoneName(workspaceZone),
                })}
              </span>
            )}
          </>
        }
        actions={
          <>
            <ViewMenu
              view={view}
              layout={layout}
              hours={hoursChoice}
              onView={choose}
              onLayout={chooseLayout}
              onHours={chooseHours}
            />
            <PeopleMenu
              mode={hostMode}
              picked={picked}
              options={hostOptions}
              onMode={(mode) => {
                setHostMode(mode)
                setPicked([])
              }}
              onPicked={(next) => {
                setPicked(next)
                setHostMode(next.length ? 'pick' : 'me')
              }}
            />
          </>
        }
      />
      {/* The calendar runs to the panel's left, right and bottom edges; notices keep the page padding. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {(lock || waiting > 0 || toMarkCount > 0) && (
          <div className="grid gap-3 px-4 py-3 sm:px-6">
            <FeatureLockNotice lock={lock} kept={translate('schedLockedKept')} />
            {(waiting > 0 || toMarkCount > 0) && (
              <div className="flex flex-wrap gap-2">
                {waiting > 0 && (
                  <button
                    type="button"
                    onClick={() => setRequestsOpen(true)}
                    className="flex items-center gap-2 rounded-lg bg-warning-surface px-3 py-2 text-body-sm text-warning underline-offset-2 hover:underline"
                  >
                    <Inbox className="size-4" />
                    {translate('schedRequestsWaiting', { count: waiting })}
                  </button>
                )}
                {toMarkCount > 0 && (
                  <button
                    type="button"
                    aria-pressed={toMark}
                    onClick={() => setToMark(!toMark)}
                    className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-body-sm transition-colors hover:bg-muted/70 aria-pressed:bg-brand/10 aria-pressed:text-brand"
                  >
                    <CalendarCheck2 className="size-4" />
                    {translate('schedToMark', { count: toMarkCount })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {occurrences.error ? (
          <LoadProblem
            error={occurrences.error}
            what={translate('schedSessions')}
            onRetry={() => void occurrences.refetch()}
          />
        ) : layout === 'list' || toMark ? (
          <ListView
            zone={zone}
            occurrences={list}
            daysOff={toMark ? undefined : daysOffShown}
            onOpen={(entry) => openSession(entry.id)}
            empty={toMark ? translate('schedNothingToMark') : translate('schedNoSessionsInRange')}
          />
        ) : view === 'month' ? (
          <MonthView
            days={daysOf('month', date)}
            month={date.slice(0, 7)}
            zone={zone}
            today={today}
            occurrences={list}
            daysOff={daysOff}
            canWrite={canWrite}
            onOpen={(entry) => openSession(entry.id)}
            onCreate={(day) => newAt(day)}
          />
        ) : (
          <TimeGrid
            key={range.from}
            days={shownDays}
            zone={zone}
            occurrences={list}
            daysOff={daysOff}
            busy={busy.data ?? []}
            lanes={lanes}
            now={now}
            hours={hoursChoice.mode === 'full' ? FULL_DAY : hoursChoice.work}
            canWrite={canWrite}
            onOpen={(entry) => openSession(entry.id)}
            onShowAll={() => chooseHours({ ...hoursChoice, mode: 'full' })}
            onCreate={(day, minutes, hostId) => newAt(day, minutes, hostId)}
            onMove={dayOffMove.move}
          />
        )}
      </div>

      {drawer && (
        <SessionDrawer
          target={drawer}
          zone={zone}
          now={now}
          onClose={closeDrawer}
          onView={openSession}
        />
      )}
      {requestsOpen && (
        <RequestsDrawer
          zone={zone}
          onClose={() => setRequestsOpen(false)}
          onOpenSession={(id) => {
            setRequestsOpen(false)
            openSession(id)
          }}
        />
      )}
      {change.dialog}
      {dayOffMove.dialog}
    </>
  )
}
