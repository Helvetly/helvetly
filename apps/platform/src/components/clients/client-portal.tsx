'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import {
  AtSign,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'
import { toast } from 'sonner'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { useResendPortalInvite, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { usePortalAddress } from '@/lib/workspaces'

/** The address a client signs in to the portal with: its email, else its billing email ('' for none). */
export function portalLogin(client: { email: string | null; billing_email: string | null }) {
  return (client.email?.trim() || client.billing_email?.trim() || '').toLowerCase()
}

export type InvitationStatus = { label: string; tone: Tone; action: 'Send invitation' | 'Resend' }

/** Where the invitation stands: signed in beats sent beats not sent. */
export function invitationStatus(
  client: Pick<Client, 'portal_invited_at' | 'portal_signed_in_at'>,
): InvitationStatus {
  if (client.portal_signed_in_at)
    return {
      label: translate('signedIn2', { value1: formatDate(client.portal_signed_in_at) }),
      tone: STATUS_TONES.invitation.signed_in,
      action: 'Resend',
    }
  if (client.portal_invited_at)
    return {
      label: translate('sent', { value1: formatDate(client.portal_invited_at) }),
      tone: STATUS_TONES.invitation.sent,
      action: 'Resend',
    }
  return {
    label: translate('notSent'),
    tone: STATUS_TONES.invitation.not_sent,
    action: 'Send invitation',
  }
}

/** The invitation line in the client form, for a saved client. */
export const invitationText = (invitedAt: string | null | undefined) =>
  invitedAt
    ? translate('invitationSent', { value1: formatDate(invitedAt) })
    : translate('noInvitationSentYet')

/** An icon-only control with its name in a tooltip. */
function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** One status row, laid out like the drawer's other label/value rows. */
function StatusRow({
  icon: Icon,
  label,
  children,
  action,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-border/60 py-1.5">
      <Icon
        aria-hidden
        className="size-4 shrink-0 stroke-[1.5] text-muted-foreground max-sm:hidden"
      />
      <span className="w-28 shrink-0 text-body-sm text-muted-foreground max-sm:w-24">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-body">
        {children}
      </span>
      {action && <span className="flex shrink-0 items-center gap-0.5">{action}</span>}
    </div>
  )
}

/**
 * The drawer's "Client portal" card body: access, the sign-in address, the invitation with its action, and the
 * portal link, one status row each.
 */
export function PortalAccess({
  client,
  canWrite,
  onAddEmail,
}: {
  client: Client
  canWrite: boolean
  /** Opens the client's details to add an email. */
  onAddEmail: () => void
}) {
  const resend = useResendPortalInvite()
  const portalLock = useFeatureLock('client_portal')
  const on = Boolean(client.portal_enabled)
  const login = portalLogin(client)
  const invitation = invitationStatus(client)
  // The whole workspace's portal is off: this client's switch is kept but lets nobody in.
  const workspaceOff = usePortalAddress().data?.enabled === false
  const offNote = workspaceOff && <WorkspacePortalOff />

  if (!on)
    return (
      <div className="grid">
        {offNote}
        <StatusRow icon={KeyRound} label={translate('access')}>
          <Badge>{translate('off')}</Badge>
          <span className="text-body-sm text-muted-foreground">
            {translate('turnItOnToLetTheClientSignIn')}
          </span>
        </StatusRow>
      </div>
    )

  return (
    <div className="grid">
      {offNote}
      <StatusRow icon={KeyRound} label={translate('access')}>
        <Badge tone="green">{translate('on')}</Badge>
        <span className="text-body-sm text-muted-foreground max-sm:hidden">
          {translate('seesItsInvoicesEngagementsAndSharedDocuments')}
        </span>
      </StatusRow>
      {login ? (
        <>
          <StatusRow icon={AtSign} label={translate('signsInWith2')}>
            <span className="truncate">{login}</span>
            {!client.email && (
              <span className="text-body-sm text-muted-foreground">
                {translate('billingEmail2')}
              </span>
            )}
          </StatusRow>
          <StatusRow
            icon={Send}
            label={translate('invitation')}
            action={
              canWrite && (
                <Tip
                  label={
                    portalLock
                      ? `${portalLock.hint}.`
                      : invitation.action === 'Resend'
                        ? translate('emailThePortalLinkAgain', { login: login })
                        : translate('emailThePortalLink', { login: login })
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resend.isPending || Boolean(portalLock) || workspaceOff}
                    onClick={() =>
                      resend.mutate(client.id, {
                        onSuccess: () =>
                          toast.success(translate('invitationSentTo', { login: login })),
                        onError: toastError,
                      })
                    }
                  >
                    <Send />
                    <span className="max-sm:sr-only">
                      {resend.isPending ? 'Sending…' : invitation.action}
                    </span>
                  </Button>
                </Tip>
              )
            }
          >
            <Badge tone={invitation.tone}>{invitation.label}</Badge>
          </StatusRow>
        </>
      ) : (
        <div className="pt-1 pb-2">
          <NoAddressWarning onAddEmail={onAddEmail} />
        </div>
      )}
      <PortalLinkRow />
    </div>
  )
}

/** The workspace turned its whole portal off: why this client cannot sign in, and where to turn it on. */
function WorkspacePortalOff() {
  return (
    <div className="pt-1 pb-2">
      <Callout tone="warning" icon={TriangleAlert} className="rounded-lg px-3 py-2.5">
        {translate('portalOffForWorkspace')}{' '}
        <Link
          href="/settings/workspace#portal-address"
          className="underline underline-offset-2 hover:no-underline"
        >
          {translate('turnOnInSettings')}
        </Link>
      </Callout>
    </div>
  )
}

function NoAddressWarning({ onAddEmail }: { onAddEmail?: () => void }) {
  return (
    <Callout role="alert" tone="warning" icon={TriangleAlert} className="rounded-lg px-3 py-2.5">
      <span>
        {onAddEmail ? (
          <button
            type="button"
            onClick={onAddEmail}
            className="cursor-pointer underline underline-offset-2 hover:no-underline"
          >
            {translate('addAnEmail')}
          </button>
        ) : (
          translate('addAnEmail')
        )}{' '}
        {translate('toLetThisClientSignIn')}
      </span>
    </Callout>
  )
}

/**
 * Who signs in to the portal and where, in the client form with the portal on: its address (or the warning that
 * it has none), what saving does about the invitation, and the portal link.
 */
export function PortalStatus({
  login,
  fallback,
  invitation,
  onAddEmail,
}: {
  login: string
  /** The login is the billing email, as there is no email. */
  fallback: boolean
  invitation: ReactNode
  /** Where "Add an email" goes; none: plain text. */
  onAddEmail?: () => void
}) {
  return (
    <div className="grid gap-2">
      {login ? (
        <p className="text-body">
          {translate('signsInWith')}
          <strong className="font-medium">{login}</strong>
          {fallback && (
            <span className="text-muted-foreground">{translate('theBillingEmail')}</span>
          )}
        </p>
      ) : (
        <NoAddressWarning onAddEmail={onAddEmail} />
      )}
      {login && <p className="text-caption text-muted-foreground">{invitation}</p>}
      <PortalLink />
    </div>
  )
}

/** Copy and open buttons for the portal's address. */
function PortalLinkActions({ url }: { url: string }) {
  return (
    <>
      <Tip label={translate('copyPortalLink')}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={translate('copyPortalLink')}
          className="text-muted-foreground"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => toast.success(translate('portalLinkCopied')))
          }
        >
          <Copy />
        </Button>
      </Tip>
      <Tip label={translate('openThePortal')}>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label={translate('openThePortal')}
          className="text-muted-foreground"
        >
          <a href={localizedHref(url)} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </Tip>
    </>
  )
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** The drawer's "Portal" row; nothing until the API says where the portal is. */
function PortalLinkRow() {
  const url = usePortalAddress().data?.url
  if (!url) return null
  return (
    <StatusRow icon={Globe} label={translate('portal')} action={<PortalLinkActions url={url} />}>
      <a
        href={localizedHref(url)}
        target="_blank"
        rel="noreferrer"
        className="truncate underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground"
      >
        {host(url)}
      </a>
    </StatusRow>
  )
}

/** Where clients sign in, with copy and open buttons; nothing until the API says. */
export function PortalLink() {
  const url = usePortalAddress().data?.url
  if (!url) return null
  return (
    <p className="flex min-w-0 items-center gap-1 text-body-sm text-muted-foreground">
      <span className="shrink-0">{translate('clientsSignInAt')}</span>
      <a
        href={localizedHref(url)}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate text-foreground underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground"
      >
        {host(url)}
      </a>
      <PortalLinkActions url={url} />
    </p>
  )
}
