import { StatusBadge } from '@helvetly/ui/components/status-badge'

import type { Client } from '@/lib/clients'

export function ClientStatusBadge({ client }: { client: Pick<Client, 'is_draft' | 'is_active'> }) {
  if (client.is_draft) return <StatusBadge tone="amber">Draft</StatusBadge>
  return client.is_active ? (
    <StatusBadge tone="green">Active</StatusBadge>
  ) : (
    <StatusBadge tone="gray">Inactive</StatusBadge>
  )
}

/** The client asked in the portal to change its details; an owner or admin decides in the client's drawer. */
export function ChangesPendingBadge({
  client,
}: {
  client: Pick<Client, 'pending_change_request'>
}) {
  return client.pending_change_request ? (
    <StatusBadge tone="blue">Changes pending</StatusBadge>
  ) : null
}

export function ClientTypeBadge({ company }: { company: boolean }) {
  return <StatusBadge tone="blue">{company ? 'Company' : 'Person'}</StatusBadge>
}

/** "Bahnhofstrasse 1, Apt 3" / "8001 Zürich" — what there is of the address. */
export function addressLines(client: Client): string[] {
  const street = [client.street, client.street_number].filter(Boolean).join(' ')
  const line1 = [street, client.apt].filter(Boolean).join(', ')
  const line2 = [client.zip, client.city].filter(Boolean).join(' ')
  return [line1, line2].filter(Boolean)
}
