'use client'

import { cn } from 'cn'
import type { LucideIcon } from 'lucide-react'
import * as React from 'react'

import { Switch } from './switch'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

/**
 * A setting that is on or off: a card with a title, an optional description and a switch.
 * The whole card toggles; it looks the same on and off, only the switch shows the state. `disabledReason` locks it and
 * says why in a tooltip (and to screen readers).
 */
function SwitchRow({
  id: givenId,
  label,
  description,
  icon: Icon,
  checked,
  onCheckedChange,
  disabled,
  disabledReason,
  className,
}: {
  id?: string
  label: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  disabledReason?: string
  className?: string
}) {
  const fallbackId = React.useId()
  const [tipOpen, setTipOpen] = React.useState(false)
  const id = givenId ?? fallbackId
  const locked = disabled || Boolean(disabledReason)
  const describedBy =
    [description && `${id}-description`, disabledReason && `${id}-reason`]
      .filter(Boolean)
      .join(' ') || undefined

  const row = (
    <label
      htmlFor={id}
      data-slot="switch-row"
      data-disabled={locked || undefined}
      className={cn(
        'group/switch-row flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors',
        'not-data-disabled:hover:border-foreground/20',
        'has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        'data-disabled:cursor-not-allowed data-disabled:opacity-60',
        className,
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground ring-1 ring-border ring-inset"
        >
          <Icon className="size-4 stroke-[1.75]" />
        </span>
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        {description && (
          <span id={`${id}-description`} className="text-[13px] text-muted-foreground">
            {description}
          </span>
        )}
        {disabledReason && (
          <span id={`${id}-reason`} className="sr-only">
            {disabledReason}
          </span>
        )}
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={locked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        // The card shows focus and the disabled look; the switch must not do it twice.
        className="focus-visible:border-transparent focus-visible:ring-0 data-disabled:opacity-100"
      />
    </label>
  )

  // Always the same tree: a reason that arrives later (a plan or allowance loaded) must not remount the switch,
  // which would drop its focus and leave a stale node behind.
  return (
    <Tooltip open={Boolean(disabledReason) && tipOpen} onOpenChange={setTipOpen}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      {disabledReason && <TooltipContent>{disabledReason}</TooltipContent>}
    </Tooltip>
  )
}

export { SwitchRow }
