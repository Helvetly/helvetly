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
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export { inputClass }

/** `group` puts the option under that heading, in the order groups first appear. */
export type Option = { value: string; label: string; hint?: string; group?: string }

/** More options than this get a search box in the list; fewer are a plain list with type-ahead. */
const SEARCH_FROM = 8

/**
 * A select: a button that opens a list, with a search box once the list is long (or `searchable`). With `values`
 * it picks many: the chips sit inside the field (as many as fit, then "+N"), the list stays open and an option
 * toggles. `onClear` adds a clear "×" before the chevron, shown while something is chosen.
 */
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
  values,
  onClear,
  clearLabel,
  searchable,
}: {
  id?: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  /** Many choices: `onChange` then toggles one value and the list stays open. */
  values?: string[]
  onClear?: () => void
  /** The clear button's accessible name. */
  clearLabel?: string
  /** Forces the search box on (remote or async lists) or off; by default it shows for long lists. */
  searchable?: boolean
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
  const multiple = values !== undefined
  const chosen = multiple ? values : value === '' ? [] : [value]
  const selected = multiple ? undefined : options.find((option) => option.value === value)
  const showSearch = searchable ?? (options.length >= SEARCH_FROM || onCreate !== undefined)
  const keyOf = (option: Option) => `${option.label} ${option.value} ${option.hint ?? ''}`
  const [active, setActive] = useState('')
  const typed = useRef({ text: '', at: 0 })
  const commandRef = useRef<HTMLDivElement>(null)
  const clearable = onClear !== undefined && chosen.length > 0 && !disabled
  const typeAhead = (key: string) => {
    if (showSearch || key.length !== 1 || key === ' ') return
    const now = Date.now()
    typed.current = {
      text: (now - typed.current.at > 700 ? '' : typed.current.text) + key.toLowerCase(),
      at: now,
    }
    const hit = options.find((option) => option.label.toLowerCase().startsWith(typed.current.text))
    if (hit) setActive(keyOf(hit))
  }
  return (
    // `contents`: without a clear button the wrapper must not touch the caller's layout classes.
    <div className={onClear ? 'relative' : 'contents'}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          setSearch('')
          const first = options.find((option) => chosen.includes(option.value)) ?? options[0]
          if (next && first) setActive(keyOf(first))
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
            {multiple && chosen.length > 0 ? (
              <Chips
                room={clearable}
                id={valueId}
                chips={chosen.map((entry) => ({
                  key: entry,
                  label: options.find((option) => option.value === entry)?.label || entry,
                }))}
              />
            ) : (
              <span
                id={valueId}
                className={cn(
                  'min-w-0 flex-1 truncate text-left',
                  // The clear button sits over this gap, just before the chevron.
                  clearable && 'mr-5',
                  !selected && 'text-muted-foreground',
                )}
              >
                {selected ? (renderValue?.(selected) ?? selected.label) : placeholder}
              </span>
            )}
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
          onOpenAutoFocus={(event) => {
            // A plain list has no input to take focus: the list itself does, so the arrows and type-ahead work.
            if (showSearch) return
            event.preventDefault()
            commandRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (!creating.current) return
            creating.current = false
            event.preventDefault()
          }}
        >
          <Command
            ref={commandRef}
            tabIndex={-1}
            className="outline-none"
            {...(showSearch ? {} : { value: active, onValueChange: setActive })}
            onKeyDown={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.altKey) typeAhead(event.key)
            }}
          >
            {showSearch && (
              <CommandInput
                placeholder={translate('search')}
                value={search}
                onValueChange={setSearch}
              />
            )}
            <CommandList>
              <CommandEmpty>{translate('nothingFound')}</CommandEmpty>
              {[...new Set(options.map((option) => option.group))].map((group) => (
                <CommandGroup key={group ?? ''} heading={group}>
                  {options
                    .filter((option) => option.group === group)
                    .map((option) => (
                      <CommandItem
                        key={option.value}
                        value={keyOf(option)}
                        onSelect={() => {
                          onChange(option.value)
                          if (!multiple) setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            chosen.includes(option.value) ? 'opacity-100' : 'opacity-0',
                          )}
                        />
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
      {clearable && (
        <button
          type="button"
          aria-label={clearLabel ?? label ?? placeholder}
          onClick={onClear}
          className="absolute top-1/2 right-[1.875rem] flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Compact chips on one line: the first that fit, then a "+N" chip. A hidden twin measures them all. */
function Chips({
  id,
  chips: all,
  room,
}: {
  id: string
  chips: { key: string; label: string }[]
  room: boolean
}) {
  const box = useRef<HTMLSpanElement>(null)
  const twin = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState(all.length)
  useLayoutEffect(() => {
    const measure = () => {
      const width = box.current?.clientWidth ?? 0
      const nodes = [...(twin.current?.children ?? [])] as HTMLElement[]
      if (width === 0 || nodes.length === 0) return setFit(all.length)
      // The "+N" chip is about 2.25 rem wide, plus its gap.
      const counter = 40
      let count = 0
      for (const [index, chip] of nodes.entries()) {
        const right = chip.offsetLeft + chip.offsetWidth
        if (right <= width - (index < nodes.length - 1 ? counter : 0)) count = index + 1
      }
      setFit(Math.max(1, count))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (box.current) observer.observe(box.current)
    return () => observer.disconnect()
  }, [all])
  const shown = all.slice(0, fit)
  const look =
    'flex h-6 shrink-0 items-center rounded-md bg-muted px-2 text-body-sm max-w-40 truncate'
  return (
    <span
      id={id}
      ref={box}
      className={cn('relative flex min-w-0 flex-1 gap-1 overflow-hidden', room && 'mr-5')}
    >
      {shown.map(({ key, label }) => (
        <span key={key} className={cn(look, shown.length === 1 && 'shrink')}>
          {label}
        </span>
      ))}
      {all.length > fit && <span className={look}>+{all.length - fit}</span>}
      <span
        ref={twin}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 gap-1 overflow-hidden"
      >
        {all.map(({ key, label }) => (
          <span key={key} className={look}>
            {label}
          </span>
        ))}
      </span>
    </span>
  )
}
