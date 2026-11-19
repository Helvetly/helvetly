'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { LoaderCircle } from 'lucide-react'

import { translate } from '@/lib/i18n'
import type { PortalTicketPeek } from '@/lib/portal'

import { LoginAvatar } from './portal-bits'

/**
 * The last step from the shared portal's account choice, on the supplier's own address: whom the sign-in continues as,
 * confirmed before anything is opened. With `current` (a session this browser already has here) it says who that is,
 * and Cancel keeps them signed in.
 */
export function PortalTicketConfirm({
  ticket,
  current,
  pending,
  failed,
  onContinue,
  onCancel,
}: {
  ticket: PortalTicketPeek
  current?: { email: string; clientName: string }
  pending: boolean
  failed: boolean
  onContinue: () => void
  onCancel: () => void
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5 text-center">
        <h1 className="text-page font-semibold tracking-tight">
          {translate('continueWithThisAccount')}
        </h1>
        <p className="text-body text-balance text-muted-foreground">
          {translate('onlyContinueIfYouChoseIt')}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-3">
        <LoginAvatar name={ticket.email} src="" />
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-body-sm font-medium">{ticket.email}</span>
          <span className="truncate text-body-sm text-muted-foreground">
            {translate('clientAtSupplier', {
              client: ticket.client_name,
              supplier: ticket.workspace_name,
            })}
          </span>
        </span>
      </div>
      {current && (
        <Callout tone="neutral" title={translate('alreadySignedInHere')}>
          {translate('continuingSignsOut', { email: current.email, client: current.clientName })}
        </Callout>
      )}
      {failed && <InlineError>{translate('thatSignInHasExpired')}</InlineError>}
      <div className="grid gap-2">
        <Button disabled={pending} onClick={onContinue}>
          {pending && (
            <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
          )}
          {translate('continue')}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          {current ? translate('staySignedIn') : translate('cancel')}
        </Button>
      </div>
    </div>
  )
}
