'use client'
import { HelpTip } from '@helvetly/ui/components/form-field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@helvetly/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Minus,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import { FONT_SIZES, type PrintSettings, type TextAlign } from '@/lib/templates'

const ALIGNS: { value: TextAlign; label: () => string; icon: LucideIcon }[] = [
  { value: 'left', label: () => translate('alignLeft'), icon: AlignLeft },
  { value: 'center', label: () => translate('alignCenter'), icon: AlignCenter },
  { value: 'right', label: () => translate('alignRight'), icon: AlignRight },
]

export const FONT_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 24] as const

/** A typed size as whole points within the bounds, or null while it is not a number. */
export function clampPoints(text: string): number | null {
  const points = Math.round(Number(text.trim()))
  if (!text.trim() || !Number.isFinite(points)) return null
  return Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, points))
}

/**
 * How a client data field's value is printed: its size (one for every value, 10 pt by default), its
 * alignment, whether it shrinks to fit its box, and a sample of the result.
 */
export function PrintSettingsFields({
  value,
  sample,
  onChange,
}: {
  value: PrintSettings
  /** What the field would print, shown at the chosen size and alignment. */
  sample: string
  onChange: (change: PrintSettings) => void
}) {
  const size = value.font_size ?? FONT_SIZES.default
  const align = value.align ?? 'left'
  // What is typed, until it is a size: "1" on the way to "12" is not clamped to 8 yet.
  const [typed, setTyped] = useState<string | null>(null)
  const [presets, setPresets] = useState(false)
  const setSize = (points: number) => {
    setTyped(null)
    onChange({ font_size: Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, points)) })
  }
  const commit = () => {
    const points = typed === null ? null : clampPoints(typed)
    if (points !== null) setSize(points)
    else setTyped(null)
  }

  return (
    <section aria-labelledby="print-heading" className="grid gap-2.5">
      <h4 id="print-heading" className="text-caption font-medium text-muted-foreground">
        {translate('text')}
      </h4>
      <div className="flex items-center gap-2">
        <InputGroup className="w-auto min-w-0 flex-1">
          <InputGroupAddon>
            <InputGroupButton
              size="icon-xs"
              aria-label={translate('smallerFont')}
              disabled={size <= FONT_SIZES.min}
              onClick={() => setSize(size - 1)}
            >
              <Minus />
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupInput
            inputMode="numeric"
            aria-label={translate('fontSize')}
            value={typed ?? String(size)}
            className="min-w-0 px-0 text-center tabular-nums"
            onChange={(event) => {
              setTyped(event.target.value)
              const points = Number(event.target.value)
              if (Number.isInteger(points) && points >= FONT_SIZES.min && points <= FONT_SIZES.max)
                onChange({ font_size: points })
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                setSize(size + (event.key === 'ArrowUp' ? 1 : -1))
              }
            }}
          />
          <InputGroupAddon align="inline-end" className="gap-0.5">
            <span aria-hidden className="text-caption">
              pt
            </span>
            <InputGroupButton
              size="icon-xs"
              aria-label={translate('largerFont')}
              disabled={size >= FONT_SIZES.max}
              onClick={() => setSize(size + 1)}
            >
              <Plus />
            </InputGroupButton>
            <Popover open={presets} onOpenChange={setPresets}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <InputGroupButton size="icon-xs" aria-label={translate('fontSizePresets')}>
                      <ChevronDown />
                    </InputGroupButton>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{translate('fontSizePresets')}</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="grid w-auto grid-cols-3 gap-1 p-1.5">
                {FONT_PRESETS.map((points) => (
                  <button
                    key={points}
                    type="button"
                    aria-pressed={points === size}
                    onClick={() => {
                      setSize(points)
                      setPresets(false)
                    }}
                    className="h-8 min-w-12 cursor-pointer rounded-md px-2 text-body-sm tabular-nums transition-colors hover:bg-muted aria-pressed:bg-muted aria-pressed:font-semibold"
                  >
                    {translate('pointsValue', { points })}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </InputGroupAddon>
        </InputGroup>
        <fieldset className={cn(segmentTrack, 'flex h-9')}>
          <legend className="sr-only">{translate('alignment')}</legend>
          {ALIGNS.map((option) => (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={align === option.value}
                  aria-label={option.label()}
                  onClick={() => onChange({ align: option.value })}
                  className={cn(segmentItem, 'px-1.5')}
                >
                  <option.icon />
                </button>
              </TooltipTrigger>
              <TooltipContent>{option.label()}</TooltipContent>
            </Tooltip>
          ))}
        </fieldset>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="print-auto-fit" className="text-body-sm">
          {translate('autoFit')}
        </label>
        <HelpTip label={translate('autoFit')}>{translate('autoFitHint')}</HelpTip>
        <Switch
          id="print-auto-fit"
          className="ml-auto"
          checked={!!value.auto_fit}
          onCheckedChange={(checked) => onChange({ auto_fit: checked })}
        />
      </div>
      <p
        className="truncate rounded-lg bg-muted px-2.5 py-1.5 leading-tight text-foreground"
        // The size in points, as the PDF prints it.
        style={{ fontSize: `${size}pt`, textAlign: align }}
      >
        <span className="sr-only">{translate('preview')}: </span>
        {sample}
      </p>
    </section>
  )
}
