import { Badge } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'

import { streetLine, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

export function ClientStatusBadge({
  client,
}: {
  client: Pick<Client, 'is_draft' | 'is_active' | 'archived_at'>
}) {
  if (client.archived_at) return <Badge tone="amber">{translate('archived')}</Badge>
  if (client.is_draft) return <Badge tone={STATUS_TONES.client.draft}>{translate('draft')}</Badge>
  return client.is_active ? (
    <Badge tone={STATUS_TONES.client.active}>{translate('active')}</Badge>
  ) : (
    <Badge tone={STATUS_TONES.client.inactive}>{translate('inactive')}</Badge>
  )
}

/** What invoicing needs and the client lacks: the address (nothing can be issued) and an email (nothing can be sent). */
export function missingData(
  client: Pick<Client, 'is_draft' | 'email' | 'billing_email'>,
): ('address' | 'email')[] {
  return [
    ...(client.is_draft ? (['address'] as const) : []),
    ...(client.email || client.billing_email ? [] : (['email'] as const)),
  ]
}

/** A calm chip per thing invoicing needs and the client lacks. */
export function MissingDataBadges({
  client,
  only,
}: {
  client: Pick<Client, 'is_draft' | 'email' | 'billing_email'>
  /** Only the first, where there is room for one chip. */
  only?: boolean
}) {
  const missing = missingData(client)
  return (only ? missing.slice(0, 1) : missing).map((what) => (
    <Badge key={what} tone={STATUS_TONES.client.draft}>
      {what === 'address' ? translate('missingAddress') : translate('missingEmail')}
    </Badge>
  ))
}

/** A list row's one chip: inactive, else what invoicing lacks, else active. */
export function ClientRowStatus({
  client,
}: {
  client: Pick<Client, 'is_draft' | 'is_active' | 'archived_at' | 'email' | 'billing_email'>
}) {
  if (!client.archived_at && client.is_active && missingData(client).length)
    return <MissingDataBadges client={client} only />
  return <ClientStatusBadge client={{ ...client, is_draft: false }} />
}

/** The client asked in the portal to change its details; an owner or admin decides in the client's drawer. */
export function ChangesPendingBadge({
  client,
}: {
  client: Pick<Client, 'pending_change_request'>
}) {
  return client.pending_change_request ? (
    <Badge tone={STATUS_TONES.client.changes_pending}>{translate('changesPending')}</Badge>
  ) : null
}

export function ClientTypeBadge({ company }: { company: boolean }) {
  return <Badge tone="blue">{company ? translate('company') : translate('person')}</Badge>
}

/** "Bahnhofstrasse 1, Apt 3" / "8001 Zürich" — what there is of the address. */
export function addressLines(
  client: Pick<Client, 'street' | 'street_number' | 'apt' | 'country' | 'zip' | 'city'>,
): string[] {
  const line1 = streetLine(client)
  const line2 = [client.zip, client.city].filter(Boolean).join(' ')
  return [line1, line2].filter(Boolean)
}
