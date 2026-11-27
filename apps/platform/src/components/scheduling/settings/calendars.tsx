'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Combobox } from '@helvetly/ui/components/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { FormField, HelpTip } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { TruncatedText } from '@helvetly/ui/components/truncated-text'
import { CalendarSync, Lock, MoreHorizontal, RefreshCw, Unplug } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { SettingsEmpty, SettingsRow, SettingsSection } from '@/components/settings/layout'
import { ApiError, errorMessage } from '@/lib/api'
import { useLockedFeature } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  useCalendars,
  useDisconnectCalendar,
  usePatchCalendar,
  useSyncCalendar,
  syncedAgo,
  type Connection,
  type Provider,
} from '@/lib/scheduling-settings'

import { GoogleCalendarMark, OutlookMark } from './calendar-marks'
import { CalendarFeed } from './calendars-feed'
import { WeeklyHours } from './calendars-hours'

const PROVIDER_NAME: Record<Provider, () => string> = {
  google: () => translate('schedulingSettingsGoogleCalendar'),
  microsoft: () => translate('schedulingSettingsMicrosoftCalendar'),
}

const PROVIDER_MARK: Record<Provider, () => ReactNode> = {
  google: () => <GoogleCalendarMark />,
  microsoft: () => <OutlookMark />,
}

const CALLBACK_ERRORS: Record<string, () => string> = {
  cancelled: () => translate('schedulingSettingsConnectCancelled'),
  scopes_missing: () => translate('schedulingSettingsConnectScopesMissing'),
  account_in_use: () => translate('schedulingSettingsConnectAccountInUse'),
}

/** What the provider's redirect says (`?calendar=connected`, `?calendar_error=<code>`), as a toast; the address is then cleaned. */
export function useCalendarCallbackToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('calendar_error')
    if (params.get('calendar') !== 'connected' && !error) return
    if (error)
      toast.error(
        (CALLBACK_ERRORS[error] ?? (() => translate('schedulingSettingsConnectFailed')))(),
      )
    else toast.success(translate('schedulingSettingsConnected'))
    params.delete('calendar')
    params.delete('calendar_error')
    const rest = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
    )
  }, [])
}

/** Settings → Scheduling, your own part: the person's calendar connections, iCal feed and weekly hours in this workspace. */
export function Calendars({ userId }: { userId: string }) {
  useCalendarCallbackToast()
  const calendars = useCalendars()
  // Scheduling off for the plan, the role or the instance: the page has no such section.
  if (calendars.error instanceof ApiError && [402, 403, 404].includes(calendars.error.status))
    return null
  return (
    <>
      <SettingsSection
        id="calendars"
        icon={CalendarSync}
        title={translate('schedulingSettingsCalendars')}
        description={translate('schedulingSettingsCalendarsDescription')}
      >
        {calendars.error ? (
          <p className="text-body text-muted-foreground">{errorMessage(calendars.error)}</p>
        ) : !calendars.data ? (
          <Loader className="min-h-24" />
        ) : (
          <Providers providers={calendars.data.providers} connections={calendars.data.data} />
        )}
      </SettingsSection>
      <CalendarFeed />
      <WeeklyHours userId={userId} />
    </>
  )
}

const connectHref = (provider: Provider) => `/api/v1/scheduling/calendars/${provider}/connect`

function Providers({
  providers,
  connections,
}: {
  providers: Provider[]
  connections: Connection[]
}) {
  // Free schedules sessions without Google or Microsoft calendars (the API refuses the connection).
  const locked = useLockedFeature('calendar_sync')
  if (providers.length === 0 && connections.length === 0)
    return (
      <SettingsEmpty icon={<CalendarSync />} title={translate('schedulingSettingsNoProviders')}>
        {translate('schedulingSettingsNoProvidersBody')}
      </SettingsEmpty>
    )
  const open = providers.filter(
    (provider) => !connections.some((connection) => connection.provider === provider),
  )
  return (
    <div className="grid max-w-[var(--settings-form,44rem)] gap-4">
      {locked?.plan && open.length > 0 && (
        <Callout
          icon={Lock}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/billing/plans">{translate('seePlans')}</Link>
            </Button>
          }
        >
          {translate('calendarSyncComesWithThePlan', { name: locked.plan.name })}
        </Callout>
      )}
      {connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      {open.length > 0 && (
        <ul className="grid divide-y rounded-xl border px-4">
          {open.map((provider) => (
            <SettingsRow
              key={provider}
              icon={PROVIDER_MARK[provider]()}
              title={PROVIDER_NAME[provider]()}
              meta={translate('schedulingSettingsNotConnected')}
            >
              {locked ? (
                <Button variant="outline" disabled>
                  {translate('schedulingSettingsConnect')}
                </Button>
              ) : (
                <Button asChild variant="outline">
                  {/* A full page load: the provider's consent screen follows. */}
                  <a href={connectHref(provider)}>{translate('schedulingSettingsConnect')}</a>
                </Button>
              )}
            </SettingsRow>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The calendar's own colour as a dot, or a neutral one when the provider gave none. */
function CalendarDot({ color }: { color?: string | null }) {
  return (
    <span
      aria-hidden
      data-slot="calendar-dot"
      className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  if (connection.status === 'active')
    return (
      <span className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
        <span
          aria-hidden
          className={
            connection.last_synced_at
              ? 'size-2 rounded-full bg-success-solid'
              : 'size-2 rounded-full bg-muted-foreground/40'
          }
        />
        {connection.last_synced_at
          ? translate('schedulingSettingsSynced', { time: syncedAgo(connection.last_synced_at) })
          : translate('schedulingSettingsNeverSynced')}
      </span>
    )
  return (
    <span role="alert" className="flex items-center gap-1.5 text-body-sm text-destructive">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-destructive" />
      {connection.status === 'revoked'
        ? translate('schedulingSettingsRevoked')
        : translate('schedulingSettingsProblem', {
            error: connection.error ?? translate('schedulingSettingsConnectFailed'),
          })}
    </span>
  )
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const patch = usePatchCalendar()
  const sync = useSyncCalendar()
  const [disconnecting, setDisconnecting] = useState(false)
  const name = PROVIDER_NAME[connection.provider]()
  const active = connection.status === 'active'
  const change = (input: { push_calendar_id?: string | null; busy_calendar_ids?: string[] }) =>
    patch.mutate({ id: connection.id, ...input }, { onError: toastError })
  return (
    <section
      aria-label={name}
      className="overflow-hidden rounded-xl border"
      data-slot="calendar-connection"
    >
      <header className="flex items-center gap-3 p-4">
        <span
          data-slot="row-icon"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-5"
        >
          {PROVIDER_MARK[connection.provider]()}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{name}</span>
            <TruncatedText className="text-body-sm text-muted-foreground">
              {connection.account_email}
            </TruncatedText>
          </span>
          <ConnectionStatus connection={connection} />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {connection.status === 'revoked' ? (
            <Button asChild variant="outline">
              <a href={connectHref(connection.provider)}>
                {translate('schedulingSettingsReconnect')}
              </a>
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label={translate('schedulingSettingsSyncNow')}
                  disabled={sync.isPending}
                  onClick={() =>
                    sync.mutate(connection.id, {
                      onSuccess: () => toast.success(translate('schedulingSettingsSyncStarted')),
                      onError: toastError,
                    })
                  }
                >
                  <RefreshCw className={sync.isPending ? 'animate-spin' : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('schedulingSettingsSyncNow')}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    aria-label={translate('schedulingSettingsMoreFor', { name })}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{translate('moreActions')}</TooltipContent>
            </Tooltip>
            <ActionMenuContent
              kind="dropdown"
              menu={{
                header: connection.account_email,
                actions: [
                  {
                    id: 'disconnect',
                    group: 'danger',
                    icon: <Unplug />,
                    label: translate('schedulingSettingsDisconnect'),
                    onSelect: () => setDisconnecting(true),
                  },
                ],
              }}
            />
          </DropdownMenu>
        </span>
      </header>
      {active && (
        <div className="grid gap-5 border-t bg-muted/30 p-4">
          <FormField
            id={`push-${connection.id}`}
            label={translate('schedulingSettingsPushCalendar')}
            tip={translate('schedulingSettingsPushCalendarTip')}
          >
            <Combobox
              id={`push-${connection.id}`}
              value={connection.push_calendar_id ?? ''}
              placeholder={translate('schedulingSettingsChooseCalendar')}
              disabled={patch.isPending || connection.calendars.length === 0}
              options={connection.calendars.map((calendar) => ({
                value: calendar.id,
                label: calendar.name,
                adornment: <CalendarDot color={calendar.color} />,
              }))}
              onChange={(id) => change({ push_calendar_id: id })}
            />
          </FormField>
          <fieldset className="grid w-full min-w-0 gap-1.5">
            <legend className="mb-1 flex items-center gap-1.5 text-body-sm font-medium">
              {translate('schedulingSettingsBusyCalendars')}
              <HelpTip label={translate('schedulingSettingsBusyCalendars')}>
                {translate('schedulingSettingsBusyCalendarsHint')}
              </HelpTip>
            </legend>
            <ul className="grid w-full divide-y rounded-lg border bg-card">
              {connection.calendars.map((calendar) => {
                const on = connection.busy_calendar_ids.includes(calendar.id)
                const id = `busy-${connection.id}-${calendar.id}`
                return (
                  <li key={calendar.id}>
                    <label
                      htmlFor={id}
                      className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        id={id}
                        checked={on}
                        disabled={patch.isPending}
                        onCheckedChange={() =>
                          change({
                            busy_calendar_ids: on
                              ? connection.busy_calendar_ids.filter((one) => one !== calendar.id)
                              : [...connection.busy_calendar_ids, calendar.id],
                          })
                        }
                      />
                      <CalendarDot color={calendar.color} />
                      <TruncatedText className="flex-1 text-sm">{calendar.name}</TruncatedText>
                      {calendar.primary && (
                        <Badge variant="outline" size="sm" tone="neutral">
                          {translate('schedulingSettingsPrimaryCalendar')}
                        </Badge>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        </div>
      )}
      {disconnecting && (
        <DisconnectDialog
          connection={connection}
          name={name}
          onClose={() => setDisconnecting(false)}
        />
      )}
    </section>
  )
}

/** Disconnecting asks what happens to the sessions already in the person's calendar. */
function DisconnectDialog({
  connection,
  name,
  onClose,
}: {
  connection: Connection
  name: string
  onClose: () => void
}) {
  const disconnect = useDisconnectCalendar()
  const go = (keepEvents: boolean) =>
    disconnect.mutate(
      { id: connection.id, keepEvents },
      {
        onSuccess: () => {
          toast.success(translate('schedulingSettingsDisconnected'))
          onClose()
        },
        onError: toastError,
      },
    )
  return (
    <Dialog open onOpenChange={(open) => !open && !disconnect.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('schedulingSettingsDisconnectTitle', { name })}</DialogTitle>
          <DialogDescription>{translate('schedulingSettingsDisconnectBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <Button variant="outline" disabled={disconnect.isPending} onClick={() => go(true)}>
            {translate('schedulingSettingsKeepEvents')}
          </Button>
          <Button variant="destructive" disabled={disconnect.isPending} onClick={() => go(false)}>
            {translate('schedulingSettingsRemoveEvents')}
          </Button>
          <Button variant="ghost" disabled={disconnect.isPending} onClick={onClose}>
            {translate('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
