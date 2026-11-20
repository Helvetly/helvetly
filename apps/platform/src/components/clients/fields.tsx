'use client'
import { Combobox, inputClass, type Option } from '@helvetly/ui/components/combobox'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown, X } from 'lucide-react'
import { useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent } from 'react'

import { useClientTags } from '@/lib/clients'
import { translate } from '@/lib/i18n'

export { COUNTRY_OPTIONS } from '@helvetly/ui/lib/countries'
export { Combobox, inputClass, type Option }

import { addTag, CURRENCIES, typedTag } from './client-form-model'

const COMMON_CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP']
/** Currencies by name with the code as hint: the usual four first, then all of them. */
export const CURRENCY_OPTIONS: Option[] = [
  ...COMMON_CURRENCIES.map((code) => ({
    value: code,
    label: CURRENCIES.find((currency) => currency.code === code)?.name ?? code,
    hint: code,
    group: translate('common'),
  })),
  ...CURRENCIES.filter(({ code }) => !COMMON_CURRENCIES.includes(code)).map(({ code, name }) => ({
    value: code,
    label: name,
    hint: code,
    group: translate('allCurrencies'),
  })),
]

export const selectClass = cn(inputClass, 'appearance-none pr-9')

/** A native <select> with the Combobox's chevrons instead of the browser's, inset like theirs. */
export function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: ComponentProps<'select'> & { wrapperClassName?: string }) {
  return (
    <span className={cn('relative block min-w-0', wrapperClassName)}>
      <select {...props} className={cn(selectClass, className)}>
        {children}
      </select>
      <ChevronsUpDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
}

export type KnownTag = { name: string; count: number }

/** Chips for tags, with suggestions from the tags already in use (the workspace's client tags by default). */
export function TagsInput({
  id,
  value,
  onChange,
  invalid,
  label,
  onInputKeyDown,
  onLeave,
  known,
}: {
  id: string
  value: string[]
  onChange: (tags: string[]) => void
  invalid?: boolean
  /** The input's accessible name when no <label> points at `id`. */
  label?: string
  /** After the input's own keys (Enter adding a tag marks the event handled). */
  onInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  /** Focus left the field and its suggestions, after typed text became a tag. */
  onLeave?: () => void
  /** The tags to suggest, instead of the clients' ones. */
  known?: KnownTag[]
}) {
  const root = useRef<HTMLDivElement>(null)
  const leave = (event: FocusEvent) => {
    if (!root.current?.contains(event.relatedTarget)) onLeave?.()
  }
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const clientTags = useClientTags(!known)
  const needle = draft.trim().toLowerCase()
  const suggestions = (known ?? clientTags.data ?? [])
    .filter(
      (tag) =>
        tag.name.toLowerCase().includes(needle) &&
        !value.some((existing) => existing.toLowerCase() === tag.name.toLowerCase()),
    )
    .slice(0, 6)

  const add = (input: string) => {
    const result = addTag(value, input)
    setError(result.error ?? '')
    if (result.tags !== value) onChange(result.tags)
    if (!result.error) setDraft('')
  }

  return (
    <div ref={root} className="grid gap-1.5">
      <div
        data-field-surface
        className={cn(fieldSurface, 'flex min-h-9 flex-wrap items-center gap-1 px-1.5 py-0.5')}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex h-6 items-center gap-1 rounded-[5px] bg-muted pr-0.5 pl-2 text-[13px]"
          >
            {tag}
            <button
              type="button"
              aria-label={translate('remove5', { tag: tag })}
              // Keeps focus in the field, so an inline editor around it does not see it leave.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(value.filter((entry) => entry !== tag))}
              onBlur={leave}
              className="flex size-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={label}
          aria-invalid={invalid || undefined}
          value={draft}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            const typed = event.target.value
            // A comma ends a tag, as in most tag inputs.
            if (typed.endsWith(',')) add(typed.slice(0, -1))
            else setDraft(typedTag(typed))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              event.preventDefault()
              add(draft)
            }
            if (event.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
            onInputKeyDown?.(event)
          }}
          onBlur={(event) => {
            if (draft.trim()) add(draft)
            leave(event)
          }}
          placeholder={value.length ? '' : translate('addTagsEGVIP')}
          className="h-7 min-w-24 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-placeholder"
        />
      </div>
      {needle && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={translate('suggestedTags')}>
          {suggestions.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(tag.name)}
              onBlur={leave}
              className="h-6 rounded-[5px] px-2 text-[12.5px] text-muted-foreground ring-1 ring-border ring-inset hover:bg-muted hover:text-foreground"
            >
              {tag.name} <span className="tabular-nums opacity-60">{tag.count}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
