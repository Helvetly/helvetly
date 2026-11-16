import { StatusBadge } from '@helvetly/ui/components/status-badge'

import { streetLine, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

export function ClientStatusBadge({ client }: { client: Pick<Client, 'is_draft' | 'is_active'> }) {
  if (client.is_draft) return <StatusBadge tone="amber">{translate('draft')}</StatusBadge>
  return client.is_active ? (
    <StatusBadge tone="green">{translate('active')}</StatusBadge>
  ) : (
    <StatusBadge tone="gray">{translate('inactive')}</StatusBadge>
  )
}

/** The client asked in the portal to change its details; an owner or admin decides in the client's drawer. */
export function ChangesPendingBadge({
  client,
}: {
  client: Pick<Client, 'pending_change_request'>
}) {
  return client.pending_change_request ? (
    <StatusBadge tone="blue">{translate('changesPending')}</StatusBadge>
  ) : null
}

export function ClientTypeBadge({ company }: { company: boolean }) {
  return (
    <StatusBadge tone="blue">{company ? translate('company') : translate('person')}</StatusBadge>
  )
}

/** "Bahnhofstrasse 1, Apt 3" / "8001 Zürich" — what there is of the address. */
export function addressLines(client: Client): string[] {
  const line1 = streetLine(client)
  const line2 = [client.zip, client.city].filter(Boolean).join(' ')
  return [line1, line2].filter(Boolean)
}
