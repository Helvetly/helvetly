import { Meter } from '@helvetly/ui/components/meter'
import { cn } from '@helvetly/ui/lib/utils'

import { formatLimit, meterState, type UsageItem } from '@/lib/billing'
import { translate } from '@/lib/i18n'

const STATE = {
  near: { text: translate('almostAtLimit'), className: 'text-warning' },
  full: { text: translate('limitReached'), className: 'text-destructive' },
  off: { text: translate('notIncluded'), className: 'text-muted-foreground' },
}

/**
 * "Clients · 8 of 10" over a thin bar: the brand colour while there is room, orange from 75 % with
 * "Almost at limit", red from 90 % and "Limit reached" at the limit (the shared Meter's thresholds).
 * An empty track when unlimited.
 */
export function UsageMeter({
  item,
  label,
  className,
}: {
  item: UsageItem
  label: string
  className?: string
}) {
  const used = item.used === null ? '—' : formatLimit(item.limit, item.used)
  const state = meterState(item)
  const note = state === 'ok' ? null : STATE[state]
  return (
    <div data-slot="usage-meter" data-state={state} className={cn('grid gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3 text-body-sm">
        <span className="min-w-0 text-pretty text-foreground">{label}</span>
        <span className="flex shrink-0 items-baseline gap-2 text-muted-foreground tabular-nums">
          {note && (
            <span className={cn('text-caption font-medium', note.className)}>{note.text}</span>
          )}
          {item.max === null ? (
            <span>
              {used}
              {translate('unlimited3')}
            </span>
          ) : (
            <span>
              <span className={cn(state !== 'ok' && 'font-medium text-foreground')}>{used}</span>
              {translate('of3')} {formatLimit(item.limit, item.max)}
            </span>
          )}
        </span>
      </div>
      {item.max === null || item.max === 0 || item.used === null ? (
        <div aria-hidden className="h-1.5 rounded-full bg-muted" />
      ) : (
        <Meter
          label={translate('of2', {
            label: label,
            used: used,
            value3: formatLimit(item.limit, item.max),
            value4: note ? `, ${note.text.toLowerCase()}` : '',
          })}
          value={item.used}
          max={item.max}
        />
      )}
    </div>
  )
}
