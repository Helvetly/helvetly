import { Badge } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'

import { streetLine, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

export function ClientStatusBadge({ client }: { client: Pick<Client, 'is_draft' | 'is_active'> }) {
  if (client.is_draft) return <Badge tone={STATUS_TONES.client.draft}>{translate('draft')}</Badge>
  return client.is_active ? (
    <Badge tone={STATUS_TONES.client.active}>{translate('active')}</Badge>
  ) : (
    <Badge tone={STATUS_TONES.client.inactive}>{translate('inactive')}</Badge>
  )
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
