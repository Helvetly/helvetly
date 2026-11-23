'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
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
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { CalendarSync, RefreshCw, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { SettingsEmpty, SettingsRow, SettingsSection } from '@/components/settings/layout'
import { ApiError, errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  useCalendars,
  useDisconnectCalendar,
  usePatchCalendar,
  useSyncCalendar,
  type Connection,
  type Provider,
} from '@/lib/scheduling-settings'

import { CalendarFeed } from './calendars-feed'
import { WeeklyHours } from './calendars-hours'

const PROVIDER_NAME: Record<Provider, () => string> = {
  google: () => translate('schedulingSettingsGoogleCalendar'),
  microsoft: () => translate('schedulingSettingsMicrosoftCalendar'),
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

/** Account → Calendars and availability: the person's calendar connections, iCal feed and weekly hours. */
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
      {connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      {open.length > 0 && (
        <ul className="grid divide-y">
          {open.map((provider) => (
            <SettingsRow
              key={provider}
              icon={<CalendarSync />}
              title={PROVIDER_NAME[provider]()}
              meta={translate('schedulingSettingsNotConnected')}
            >
              <Button asChild size="sm" variant="outline">
                {/* A full page load: the provider's consent screen follows. */}
                <a href={connectHref(provider)}>{translate('schedulingSettingsConnect')}</a>
              </Button>
            </SettingsRow>
          ))}
        </ul>
      )}
    </div>
  )
}

const lastSynced = (at: string | null) =>
  at
    ? translate('schedulingSettingsLastSynced', {
        time: new Intl.DateTimeFormat(languageTag, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(at)),
      })
    : translate('schedulingSettingsNeverSynced')

function ConnectionCard({ connection }: { connection: Connection }) {
  const patch = usePatchCalendar()
  const sync = useSyncCalendar()
  const [disconnecting, setDisconnecting] = useState(false)
  const name = PROVIDER_NAME[connection.provider]()
  const broken = connection.status !== 'active'
  const change = (input: { push_calendar_id?: string | null; busy_calendar_ids?: string[] }) =>
    patch.mutate({ id: connection.id, ...input }, { onError: toastError })
  return (
    <div className="grid gap-4 rounded-xl border p-4" data-slot="calendar-connection">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="text-body font-medium">{name}</p>
          <p className="text-body-sm text-muted-foreground">{connection.account_email}</p>
          <p
            role={broken ? 'alert' : undefined}
            className={
              broken ? 'text-body-sm text-destructive' : 'text-body-sm text-muted-foreground'
            }
          >
            {connection.status === 'revoked'
              ? translate('schedulingSettingsRevoked')
              : connection.status === 'error'
                ? translate('schedulingSettingsProblem', {
                    error: connection.error ?? translate('schedulingSettingsConnectFailed'),
                  })
                : lastSynced(connection.last_synced_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {connection.status === 'revoked' ? (
            <Button asChild size="sm">
              <a href={connectHref(connection.provider)}>
                {translate('schedulingSettingsReconnect')}
              </a>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={sync.isPending}
              onClick={() =>
                sync.mutate(connection.id, {
                  onSuccess: () => toast.success(translate('schedulingSettingsSyncStarted')),
                  onError: toastError,
                })
              }
            >
              <RefreshCw />
              {translate('schedulingSettingsSyncNow')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDisconnecting(true)}>
            <Unplug />
            {translate('schedulingSettingsDisconnect')}
          </Button>
        </div>
      </div>
      {!broken && (
        <>
          <FormField
            id={`push-${connection.id}`}
            label={translate('schedulingSettingsPushCalendar')}
            width="md"
            tip={translate('schedulingSettingsPushCalendarTip')}
          >
            <Combobox
              id={`push-${connection.id}`}
              value={connection.push_calendar_id ?? ''}
              placeholder={translate('schedulingSettingsChooseCalendar')}
              disabled={patch.isPending}
              options={connection.calendars.map((calendar) => ({
                value: calendar.id,
                label: calendar.name,
              }))}
              onChange={(id) => change({ push_calendar_id: id })}
            />
          </FormField>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 flex items-center gap-1.5 text-body-sm font-medium">
              {translate('schedulingSettingsBusyCalendars')}
            </legend>
            <p className="text-body-sm text-muted-foreground">
              {translate('schedulingSettingsBusyCalendarsHint')}
            </p>
            <ul className="grid gap-0.5">
              {connection.calendars.map((calendar) => {
                const on = connection.busy_calendar_ids.includes(calendar.id)
                const id = `busy-${connection.id}-${calendar.id}`
                return (
                  <li key={calendar.id}>
                    <label
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
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
                      <span className="truncate text-sm">{calendar.name}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        </>
      )}
      {disconnecting && (
        <DisconnectDialog
          connection={connection}
          name={name}
          onClose={() => setDisconnecting(false)}
        />
      )}
    </div>
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
