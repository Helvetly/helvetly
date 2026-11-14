import { Meter } from '@helvetly/ui/components/meter'
import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Repeat } from 'lucide-react'
import type { ReactNode } from 'react'

import { type Attention, type Engagement, type PeriodSummary } from '@/lib/engagements'
import { UNITS } from '@/lib/invoices'

const ATTENTION: Record<Attention, { label: string; tone: Tone }> = {
  to_invoice: { label: 'Needs invoicing', tone: 'blue' },
  overage: { label: 'Overage', tone: 'red' },
  under_pace: { label: 'Behind pace', tone: 'amber' },
  ending_soon: { label: 'Ending soon', tone: 'gray' },
}

const STATUS: Record<Engagement['status'], { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'gray' },
  active: { label: 'Active', tone: 'green' },
  ended: { label: 'Ended', tone: 'gray' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}

export function EngagementStatusBadge({ status }: { status: Engagement['status'] }) {
  return <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>
}

export function AttentionBadges({ attention }: { attention: Engagement['attention'] }) {
  if (attention.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {attention.map((item) => (
        <StatusBadge key={item} tone={ATTENTION[item].tone}>
          {ATTENTION[item].label}
        </StatusBadge>
      ))}
    </span>
  )
}

/** "Advance" or "Arrears", with a repeat mark when the engagement recurs. */
export function BillingLabel({
  engagement,
}: {
  engagement: Pick<Engagement, 'billing' | 'recurrence'>
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {engagement.billing === 'advance' ? 'Advance' : 'Arrears'}
      {engagement.recurrence !== 'none' && (
        <Repeat aria-label="Recurring" className="size-3.5 text-muted-foreground" />
      )}
    </span>
  )
}

export const unitShort = (unit: Engagement['unit']) =>
  UNITS.find((entry) => entry.value === unit)?.short ?? ''

export const unitLabel = (unit: Engagement['unit']) =>
  UNITS.find((entry) => entry.value === unit)?.label ?? null

/** "10", "9.5": decimals as the server sent them, without trailing zeros. */
export const plain = (decimal: string) => String(Number(decimal))

/** A display-only estimate ("0.652") to one decimal ("0.7"). */
export const approx = (decimal: string) => String(Math.round(Number(decimal) * 10) / 10)

/** "6.5 h", or "6.5" when the engagement has no unit. */
export const withUnit = (amount: string, unit: Engagement['unit']) =>
  [plain(amount), unitShort(unit)].filter(Boolean).join(' ')

/** The sum of decimal quantities, in thousandths so floats add no noise. */
export const sumQuantities = (quantities: string[]) =>
  String(quantities.reduce((sum, value) => sum + Math.round(Number(value) * 1000), 0) / 1000)

/** A tooltip around one trigger, for icon-only buttons. */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The most the overage segment may take of the bar, so a wild overrun cannot crush the rest. */
const MAX_OVER_SHARE = 0.5

/** Used against committed, a tick where the use should be by now, and the overage in a danger tone. */
export function ProgressBar({
  period,
  unit,
  size = 'sm',
  caption = true,
}: {
  period: PeriodSummary
  unit: Engagement['unit']
  size?: 'sm' | 'lg'
  /** False when the numbers already stand next to the bar. */
  caption?: boolean
}) {
  const available = Number(period.available)
  const used = Number(period.used)
  const expected = Number(period.expected)
  const label = `${plain(period.used)} of ${withUnit(period.quantity, unit)} used`
  const text =
    Number(period.overage) > 0 ? `${label}, ${withUnit(period.overage, unit)} over` : label
  const showTick = period.state === 'open' && expected > 0 && expected < available

  return (
    <div className="grid gap-1">
      <Meter
        label={text}
        // Capped so a wild overrun cannot crush the rest of the bar.
        value={Math.min(used, available * (1 + MAX_OVER_SHARE))}
        max={available}
        marker={showTick ? expected : undefined}
        size={size}
      />
      {caption && <span className="text-caption text-muted-foreground tabular-nums">{text}</span>}
    </div>
  )
}
