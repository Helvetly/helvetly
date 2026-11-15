import {
  Building2,
  CalendarDays,
  Hash,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Receipt,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

import { FIELD_ICONS } from '@/components/signatures/parts'
import type { Palette } from '@/components/signatures/placement'
import { translate } from '@/lib/i18n'
import { FIELD_LABELS } from '@/lib/signatures'
import {
  DATA_LABELS,
  isDataKind,
  laneKinds,
  type DataKind,
  type SignerRole,
  type TemplateKind,
} from '@/lib/templates'

const DATA_ICONS: Record<DataKind, LucideIcon> = {
  'client.name': Building2,
  'client.address': MapPin,
  'client.email': Mail,
  'client.phone': Phone,
  'client.number': Hash,
  'client.vat_number': Receipt,
  'contact.name': UserRound,
  today: CalendarDays,
  custom: MessageSquareText,
}

export const kindLabel = (kind: TemplateKind) =>
  isDataKind(kind) ? DATA_LABELS[kind] : FIELD_LABELS[kind]

export const kindIcon = (kind: TemplateKind) =>
  isDataKind(kind) ? DATA_ICONS[kind] : FIELD_ICONS[kind]

/** Lane 0 is the client's data, lane 1 custom fields, then one lane per signing role. */
export const templatePalette = (roles: (SignerRole & { id: string })[]): Palette<TemplateKind> => ({
  lanes: [
    { id: 'client-data', name: translate('clientData') },
    { id: 'custom-fields', name: translate('customFields') },
    ...roles.map((role, index) => ({
      id: role.id,
      name: role.label.trim() || translate('signer', { value1: index + 1 }),
    })),
  ],
  kinds: laneKinds,
  label: kindLabel,
  icon: kindIcon,
  prompt: (kind) =>
    kind === 'text'
      ? translate('whatToEnter')
      : kind === 'custom'
        ? translate('whatToAskFor')
        : null,
  hint: translate('orClickOneThenClickWhereItGoesClient'),
})
