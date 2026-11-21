'use client'
import { Callout } from '@helvetly/ui/components/callout'
import { MailX } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useClient, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

import { ClientForm, type ClientFormFocus } from './client-form'

/**
 * Opens the client's form in place, on the field issuing or sending needs (no page change); saving closes it, and
 * the person tries again where they were.
 */
export function ClientFixButton({
  clientId,
  focus,
  className,
  children,
}: {
  clientId: string
  focus: ClientFormFocus
  className: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const client = useClient(open ? clientId : null)
  return (
    <>
      <button
        type="button"
        aria-busy={(open && client.isPending) || undefined}
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      {open && client.data && (
        <ClientForm
          client={client.data}
          focus={focus}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** In a send dialog, when the client has no address to send to: the way to add one without leaving. */
export function NoClientEmail({ client }: { client?: Client }) {
  if (!client || client.email || client.billing_email) return null
  return (
    <Callout tone="warning" icon={MailX}>
      <span>
        {translate('theClientHasNoEmailAddress')}{' '}
        <ClientFixButton
          clientId={client.id}
          focus="email"
          className="font-medium underline underline-offset-4 hover:no-underline"
        >
          {translate('addTheClientsEmail')}
        </ClientFixButton>
      </span>
    </Callout>
  )
}
