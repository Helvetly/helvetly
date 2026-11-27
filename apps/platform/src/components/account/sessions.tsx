'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Loader } from '@helvetly/ui/components/loader'
import { MetaDot, MetaItem, MetaList } from '@helvetly/ui/components/meta-list'
import { TruncatedText } from '@helvetly/ui/components/truncated-text'
import { formatDate } from '@helvetly/ui/lib/format'
import {
  Building2,
  Clock,
  Globe,
  LogIn,
  LogOut,
  MapPin,
  Monitor,
  MonitorSmartphone,
  Smartphone,
  Tablet,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadError } from '@/components/load-error'
import { SettingsRow, SettingsSection } from '@/components/settings/layout'
import {
  lastActive,
  useAccountSessions,
  useRevokeSession,
  type AccountSession,
  type DeviceKind,
} from '@/lib/account'
import { translate } from '@/lib/i18n'

const ICONS: Record<DeviceKind, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
}

/** A session's facts, each its own item, on two lines: activity (green while active), place and workspace; then since when and the address. */
function SessionFacts({ session }: { session: AccountSession }) {
  const when = session.current ? translate('activeNow') : lastActive(session.last_active_at)
  const active = when === translate('activeNow')
  return (
    <div className="grid gap-0.5">
      <MetaList>
        {active ? (
          <MetaItem tone="success" icon={<MetaDot />}>
            {when}
          </MetaItem>
        ) : (
          <MetaItem icon={<Clock />}>{when}</MetaItem>
        )}
        <MetaItem icon={<MapPin />}>
          {session.location ?? translate('sessionLocationUnknown')}
        </MetaItem>
        <MetaItem icon={<Building2 />}>
          <TruncatedText>{session.workspace_name}</TruncatedText>
        </MetaItem>
      </MetaList>
      <MetaList>
        <MetaItem icon={<LogIn />}>
          {translate('sessionSignedInOn', { date: formatDate(session.created_at) })}
        </MetaItem>
        <MetaItem icon={<Globe />} className="font-code text-caption">
          <span className="sr-only">{translate('sessionIpAddress')} </span>
          <TruncatedText className="max-w-[18ch]">{session.ip}</TruncatedText>
        </MetaItem>
      </MetaList>
    </div>
  )
}

/** Where the person is signed in, newest first, with this browser on top. */
export function Sessions() {
  const sessions = useAccountSessions()
  const revoke = useRevokeSession()
  const [confirming, setConfirming] = useState(false)
  const list = (sessions.data ?? []).toSorted(
    (a, b) =>
      Number(b.current) - Number(a.current) || b.last_active_at.localeCompare(a.last_active_at),
  )
  const others = list.filter((session) => !session.current).length
  const signOut = (id: string | null) =>
    revoke.mutate(id, {
      onSuccess: () =>
        toast.success(
          id ? translate('signedOutOfThatDevice') : translate('signedOutEverywhereElse'),
        ),
      onError: toastError,
    })

  return (
    <SettingsSection
      id="sessions"
      icon={MonitorSmartphone}
      title={translate('activeSessions')}
      description={translate('theBrowsersAndDevicesSignedInToYourAccount')}
    >
      {sessions.isPending ? (
        <Loader />
      ) : sessions.error ? (
        <LoadError
          what={translate('yourSessions')}
          error={sessions.error}
          onRetry={() => sessions.refetch()}
        />
      ) : (
        <div>
          <ul className="grid">
            {list.map((session) => {
              const Icon = ICONS[session.device]
              const label = translate('dynamicOn', { browser: session.browser, os: session.os })
              return (
                <SettingsRow
                  key={session.id}
                  icon={<Icon />}
                  title={
                    <>
                      {label}
                      {session.current && <Badge tone="green">{translate('thisDevice')}</Badge>}
                    </>
                  }
                  meta={<SessionFacts session={session} />}
                >
                  {!session.current && (
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      aria-label={translate('signOut3', { label: label })}
                      disabled={revoke.isPending && revoke.variables === session.id}
                      onClick={() => signOut(session.id)}
                    >
                      <LogOut />
                      {translate('signOut2')}
                    </Button>
                  )}
                </SettingsRow>
              )
            })}
          </ul>
          {others > 0 && (
            <div
              data-slot="sessions-footer"
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-3.5"
            >
              <p className="text-body-sm text-muted-foreground">
                {others === 1
                  ? translate('message1OtherSession')
                  : translate('otherSessions', { others: others })}
                {translate('signedIn')}
              </p>
              <Button
                variant="destructive-outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => setConfirming(true)}
              >
                <LogOut />
                {translate('signOutOfAllOtherSessions2')}
              </Button>
            </div>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          tone="destructive"
          title={translate('signOutOfAllOtherSessions')}
          body={translate('willNeedToSignInAgainYouStaySigned', {
            value1:
              others === 1
                ? translate('theOtherBrowserOrDevice')
                : translate('theOtherBrowsersAndDevices', { others: others }),
          })}
          confirmLabel={translate('signOut')}
          cancelLabel={translate('cancel')}
          confirmIcon={<LogOut />}
          onDecide={(approved) => {
            setConfirming(false)
            if (approved) signOut(null)
          }}
        />
      )}
    </SettingsSection>
  )
}
