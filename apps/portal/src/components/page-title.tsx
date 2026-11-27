'use client'

import { useQuery } from '@tanstack/react-query'

import { translate } from '@/lib/i18n'
import { portalScopeQuery } from '@/lib/portal'
import type en from '@/messages/en.json'

export function PageTitle({ message }: { message: keyof typeof en }) {
  const scope = useQuery({ ...portalScopeQuery, enabled: false })
  const title = `${translate(message)} · ${translate('clientPortal')}`
  return <title>{scope.isSuccess && scope.data ? `${title} · ${scope.data.name}` : title}</title>
}
