'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@helvetly/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

export const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30'

/** `group` puts the option under that heading, in the order groups first appear. */
export type Option = { value: string; label: string; hint?: string; group?: string }

/** A searchable select: a button that opens a filterable list. */
export function Combobox({
  id,
  value,
  options,
  onChange,
  placeholder,
  invalid,
  label,
  className,
  renderValue,
  contentClassName,
  disabled,
}: {
  id?: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  placeholder: string
  invalid?: boolean
  /** The accessible name when no <label> points at `id`. */
  label?: string
  className?: string
  renderValue?: (option: Option) => ReactNode
  /** E.g. a width for lists whose labels are longer than the trigger. */
  contentClassName?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const valueId = useId()
  const selected = options.find((option) => option.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="lg"
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-labelledby={label ? `${labelId} ${valueId}` : undefined}
          // Styled as a field, not a button: same border, background and shadow as inputClass.
          className={cn(
            'w-full justify-between rounded-md border-input bg-card px-3 font-normal shadow-xs hover:border-input hover:bg-card aria-expanded:border-ring aria-expanded:bg-card aria-invalid:border-destructive dark:bg-input/30',
            className,
          )}
        >
          {label && (
            <span id={labelId} className="sr-only">
              {label}
            </span>
          )}
          <span id={valueId} className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? (renderValue?.(selected) ?? selected.label) : placeholder}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          'w-max max-w-[min(32rem,var(--radix-popover-content-available-width))] min-w-[max(16rem,var(--radix-popover-trigger-width))] p-0',
          contentClassName,
        )}
      >
        <Command>
          <CommandInput placeholder={translate('search')} />
          <CommandList>
            <CommandEmpty>{translate('nothingFound')}</CommandEmpty>
            {[...new Set(options.map((option) => option.group))].map((group) => (
              <CommandGroup key={group ?? ''} heading={group}>
                {options
                  .filter((option) => option.group === group)
                  .map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value} ${option.hint ?? ''}`}
                      onSelect={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                    >
                      <Check className={cn(option.value === value ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0 flex-1 truncate" title={option.label}>
                        {option.label}
                      </span>
                      {option.hint && (
                        <CommandShortcut className="shrink-0 tracking-normal tabular-nums">
                          {option.hint}
                        </CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
