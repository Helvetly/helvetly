'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandCreateItem,
  CommandList,
  CommandShortcut,
} from '@helvetly/ui/components/command'
import { inputClass } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'

export { inputClass }

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
  onCreate,
  createLabel,
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
  /**
   * Adds an option the list lacks: the list's last row, always in view, opens the caller's add flow with what was
   * typed, or '' (the row then says `createLabel`; with a term that matches no option it says Add "term").
   */
  onCreate?: (term: string) => void
  createLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // The add flow takes focus next; the closing list must not hand it back to the trigger.
  const creating = useRef(false)
  const term = search.trim()
  const named =
    term !== '' && !options.some((option) => option.label.toLowerCase() === term.toLowerCase())
  const labelId = useId()
  const valueId = useId()
  const selected = options.find((option) => option.value === value)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="ghost"
          data-slot="combobox-trigger"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-labelledby={label ? `${labelId} ${valueId}` : undefined}
          // A field, not a button: the shared field look, without a button's hover tint or weight.
          className={cn(
            inputClass,
            'justify-between gap-1.5 bg-clip-border text-left font-normal hover:bg-card aria-expanded:border-ring aria-expanded:bg-card dark:hover:bg-input/30 dark:aria-expanded:bg-input/30',
            className,
          )}
        >
          {label && (
            <span id={labelId} className="sr-only">
              {label}
            </span>
          )}
          <span
            id={valueId}
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              !selected && 'text-muted-foreground',
            )}
          >
            {selected ? (renderValue?.(selected) ?? selected.label) : placeholder}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={label ?? placeholder}
        align="start"
        className={cn(
          'w-max max-w-[min(32rem,var(--radix-popover-content-available-width))] min-w-[max(16rem,var(--radix-popover-trigger-width))] p-0',
          contentClassName,
        )}
        onCloseAutoFocus={(event) => {
          if (!creating.current) return
          creating.current = false
          event.preventDefault()
        }}
      >
        <Command>
          <CommandInput
            placeholder={translate('search')}
            value={search}
            onValueChange={setSearch}
          />
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
            {onCreate && (
              <CommandCreateItem
                onSelect={() => {
                  creating.current = true
                  setOpen(false)
                  setSearch('')
                  onCreate(named ? term : '')
                }}
              >
                <Plus />
                <span className="truncate">
                  {named ? translate('addNamed', { name: term }) : createLabel}
                </span>
              </CommandCreateItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
