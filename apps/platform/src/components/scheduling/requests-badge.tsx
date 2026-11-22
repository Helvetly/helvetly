'use client'
import { cn } from '@helvetly/ui/lib/utils'

import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { useRequests } from '@/lib/scheduling'

/** The menu's count of requests waiting for the business; nothing while there are none. */
export function RequestsBadge({ className }: { className?: string }) {
  const waiting = useRequests(useCan('read:scheduling')).data?.length ?? 0
  if (waiting === 0) return null
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-brand/10 px-1.5 text-caption font-medium text-brand tabular-nums',
        className,
      )}
    >
      {waiting}
      <span className="sr-only"> {translate('schedRequestsWaiting', { count: waiting })}</span>
    </span>
  )
}
