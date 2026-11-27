'use client'
import { Button } from '@helvetly/ui/components/button'
import { Panel } from '@helvetly/ui/components/panel'
import { CalendarPlus } from 'lucide-react'
import { useState } from 'react'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import { isOpen, useOccurrences, zoned, type Occurrence, type Person } from '@/lib/scheduling'
import { getWorkspaceTimezone } from '@/lib/timezone'

import { StatusBadge } from './bits'
import { whenLabel } from './requests'
import { SessionDrawer, type DrawerTarget } from './session-drawer'

const DAY = 86_400_000
const SHOWN = 5

/**
 * A client's or an engagement's sessions: the next ones and the latest that were held or counted, with "Schedule
 * session" opening the drawer prefilled. `hideEmpty` leaves the panel out while there are none (client detail).
 */
export function SessionsPanel({
  client,
  engagement,
  hideEmpty = false,
  now: fixedNow,
}: {
  client: Person
  engagement?: { id: string; title: string }
  hideEmpty?: boolean
  now?: Date
}) {
  const [now] = useState(() => fixedNow ?? new Date())
  const lock = useFeatureLock('scheduling')
  const canRead = useCan('read:scheduling')
  const canWrite = useCan('write:scheduling') && !lock
  const me = useSession().data?.user.id
  const zone = getWorkspaceTimezone()
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null)
  const scope = engagement ? { engagement_id: engagement.id } : { client_id: client.id }
  // The API answers at most 100 days per call: the coming ones and the latest ones.
  const upcoming = useOccurrences(
    { from: now.toISOString(), to: new Date(now.getTime() + 100 * DAY).toISOString(), ...scope },
    canRead && !lock,
  )
  const past = useOccurrences(
    { from: new Date(now.getTime() - 100 * DAY).toISOString(), to: now.toISOString(), ...scope },
    canRead && !lock,
  )
  if (!canRead || lock) return null
  const next = (upcoming.data ?? []).filter((entry) => isOpen(entry.status)).slice(0, SHOWN)
  const held = (past.data ?? [])
    .filter((entry) => entry.status === 'attended' || entry.counts)
    .toReversed()
    .slice(0, SHOWN)
  if (hideEmpty && next.length === 0 && held.length === 0) return null

  const schedule = () =>
    me &&
    setDrawer({
      kind: 'create',
      start: {
        date: zoned(now, zone).date,
        minutes: 9 * 60,
        hostId: me,
        client,
        engagementId: engagement?.id,
        title: engagement?.title,
      },
    })

  return (
    <Panel
      title={translate('schedSessions')}
      action={
        canWrite && (
          <Button type="button" variant="ghost" size="sm" onClick={schedule}>
            <CalendarPlus />
            {translate('schedScheduleSession')}
          </Button>
        )
      }
    >
      {next.length === 0 && held.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{translate('schedNoSessionsYet')}</p>
      ) : (
        <div className="grid gap-3">
          <SessionList
            title={translate('schedUpcoming')}
            rows={next}
            zone={zone}
            onOpen={(id) => setDrawer({ kind: 'view', id })}
          />
          <SessionList
            title={translate('schedHeld')}
            rows={held}
            zone={zone}
            onOpen={(id) => setDrawer({ kind: 'view', id })}
          />
        </div>
      )}
      {drawer && (
        <SessionDrawer
          target={drawer}
          zone={zone}
          now={now}
          onClose={() => setDrawer(null)}
          onView={(id) => setDrawer({ kind: 'view', id })}
        />
      )}
    </Panel>
  )
}

function SessionList({
  title,
  rows,
  zone,
  onOpen,
}: {
  title: string
  rows: Occurrence[]
  zone: string
  onOpen: (id: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <section className="grid gap-1">
      <h4 className="text-caption text-muted-foreground">{title}</h4>
      <ul className="grid">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
            >
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-body-sm">{row.title}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {whenLabel(row.starts_at, zone)}
                  {row.participant && ` · ${row.participant.name}`}
                </span>
              </span>
              {row.late && row.counts ? (
                <span className="text-caption text-warning">{translate('schedCountedLate')}</span>
              ) : null}
              <StatusBadge status={row.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
