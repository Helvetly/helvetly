import { Button } from '@helvetly/ui/components/button'
import { Command, CommandItem, CommandList } from '@helvetly/ui/components/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Search, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { translate } from '@/lib/i18n'
import {
  changeFor,
  formatTerm,
  inQuote,
  parseQuery,
  resolveValue,
  splitTerm,
  termLabel,
  termsOf,
  tokenize,
  type QueryField,
  type QueryTerm,
} from '@/lib/list-query'

/** The bar above a list: filters, search and view controls on one vertically centred row. */
export function ListToolbar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('flex min-h-12 shrink-0 items-center gap-1 border-b px-2 md:px-3', className)}
    >
      {children}
    </div>
  )
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="dialog"]')))

/** Field terms typed into the search, kept in the list's own params (and so in its URL). */
export type ListQuery<P> = {
  fields: readonly QueryField<P>[]
  params: P
  onChange: (change: Partial<P>) => void
}

type SearchProps<P> = {
  label: string
  placeholder: string
  /** The free text, without field terms. */
  value: string
  onChange: (value: string) => void
  query?: ListQuery<P>
  className?: string
}

type Suggestion<P> =
  | { kind: 'field'; field: QueryField<P> }
  | { kind: 'value'; field: QueryField<P>; value: string; label: string }

const MAX_SUGGESTIONS = 8

/** What the token being typed could become: a field name, or one of a field's values. */
function suggestionsFor<P>(token: string, fields: readonly QueryField<P>[], all: boolean) {
  const term = splitTerm(token, fields)
  if (term) {
    const typed = term.raw.trim().toLowerCase()
    const known = (term.field.values ?? [])
      .filter(
        (option) =>
          option.label.toLowerCase().includes(typed) || option.value.toLowerCase().includes(typed),
      )
      .map((option): Suggestion<P> => ({ kind: 'value', field: term.field, ...option }))
    const own = term.field.type !== 'enum' && resolveValue(term.field, term.raw)
    const exact = known.some((option) => option.kind === 'value' && option.value === own)
    const typedOwn: Suggestion<P>[] =
      own && !exact ? [{ kind: 'value', field: term.field, value: own, label: own }] : []
    return [...known, ...typedOwn].slice(0, MAX_SUGGESTIONS)
  }
  if (token.includes(':') || (!token && !all)) return []
  const lower = token.toLowerCase()
  return fields
    .filter(
      (field) =>
        field.id.toLowerCase().startsWith(lower) || field.label.toLowerCase().startsWith(lower),
    )
    .map((field): Suggestion<P> => ({ kind: 'field', field }))
}

/** The input split into the text before the token being typed, and that token. */
function splitTrailing(input: string) {
  if (!input || (/\s$/.test(input) && !inQuote(input))) return { before: input, token: '' }
  const tokens = tokenize(input)
  const token = tokens.at(-1) ?? ''
  return { before: input.slice(0, input.length - token.length), token }
}

/** The free text to search for: everything but terms, and the field term still being typed. */
function freeText<P>(input: string, fields: readonly QueryField<P>[]) {
  const { before, token } = splitTrailing(input)
  return parseQuery(splitTerm(token, fields) ? before : input, fields).text
}

/**
 * The search's field: chips for the field terms, the free text, and a list of suggestions for the
 * field name or value being typed. A term turns into a chip once a space or Enter follows it.
 */
function QueryInput<P>({
  label,
  placeholder,
  value,
  onChange,
  query,
  className,
  inputRef,
  shortcut,
  onFocus,
  onBlur,
  onEscape,
}: SearchProps<P> & {
  inputRef?: RefObject<HTMLInputElement | null>
  shortcut?: string
  onFocus?: () => void
  onBlur?: () => void
  /** Escape in an empty field with no suggestions open. */
  onEscape?: () => void
}) {
  const fields = query?.fields ?? []
  const terms = query ? termsOf(fields, query.params) : []
  const [input, setInput] = useState(value)
  const [shown, setShown] = useState(value)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [active, setActive] = useState(0)
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const inputId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  // The free text was changed elsewhere ("Clear search and filters"): show it.
  if (value !== shown) {
    setShown(value)
    if (value !== freeText(input, fields)) setInput(value)
  }

  const { before, token } = splitTrailing(input)
  const suggestions = open && query ? suggestionsFor(token, fields, all) : []
  const current = Math.min(active, suggestions.length - 1)
  const keys = suggestions.map(suggestionKey)

  // cmdk names the list and its options; the field points at them for screen readers.
  useEffect(() => {
    const field = ref.current
    if (!field) return
    const list = listRef.current?.querySelector('[cmdk-list]')
    const selected = list?.querySelector('[cmdk-item][aria-selected="true"]')
    for (const [name, id] of [
      ['aria-controls', list?.id],
      ['aria-activedescendant', suggestions.length ? selected?.id : undefined],
    ] as const)
      if (id) field.setAttribute(name, id)
      else field.removeAttribute(name)
  })

  const setTerms = (next: QueryTerm[]) => query?.onChange(changeFor(fields, next, query.params))
  const show = (next: string) => {
    setInput(next)
    setActive(0)
    onChange(freeText(next, fields))
  }

  /** Turns the input's finished terms (every one with `all`) into chips. */
  const commit = (next: string, everything: boolean) => {
    const { before: done, token: pending } = everything
      ? { before: next, token: '' }
      : splitTrailing(next)
    const parsed = parseQuery(done, fields)
    if (parsed.terms.length === 0) return show(next)
    setTerms([...terms, ...parsed.terms])
    const rest = [parsed.text, pending].filter(Boolean).join(' ')
    show(rest && !pending ? `${rest} ` : rest)
  }

  const accept = (suggestion: Suggestion<P>) => {
    setAll(false)
    if (suggestion.kind === 'field') return show(`${before}${suggestion.field.id}:`)
    setTerms([...terms, { id: suggestion.field.id, value: suggestion.value }])
    show(before)
    setOpen(false)
  }

  const remove = (index: number) => setTerms(terms.filter((_, at) => at !== index))
  const edit = (index: number) => {
    const term = terms[index]
    if (!term) return
    remove(index)
    show(`${input && !/\s$/.test(input) ? `${input} ` : input}${formatTerm(term)}`)
    setOpen(true)
    ref.current?.focus()
  }

  const clear = () => {
    show('')
    if (terms.length) setTerms([])
    ref.current?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const choice = suggestions[current]
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!query) return
      event.preventDefault()
      if (!suggestions.length) {
        setOpen(true)
        setAll(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + suggestions.length) % suggestions.length)
    } else if ((event.key === 'Enter' || event.key === 'Tab') && choice) {
      event.preventDefault()
      accept(choice)
    } else if (event.key === 'Enter' && query) {
      commit(input, true)
    } else if (event.key === 'Backspace' && input === '' && terms.length) {
      event.preventDefault()
      remove(terms.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (suggestions.length) return setOpen(false)
      if (input) return show('')
      onEscape?.()
    }
  }

  return (
    // Quiet, no border: the toolbar row is its box (field-surface.spec.ts).
    <label
      htmlFor={inputId}
      className={cn(
        'field-quiet relative flex h-8 min-w-0 cursor-text items-center gap-2 rounded-md pr-1 pl-2 text-muted-foreground focus-within:text-foreground',
        className,
      )}
    >
      <Search className="pointer-events-none size-4 shrink-0 stroke-[1.5]" />
      <div className="flex h-full min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto">
        {terms.map((term, index) => {
          const text = termLabel(fields, term)
          return (
            <span
              key={`${term.id}:${term.value}`}
              className="flex h-6 shrink-0 items-center rounded-md bg-muted text-body-sm text-foreground"
            >
              <button
                type="button"
                aria-label={translate('editFilter', { label: text })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => edit(index)}
                className="h-full rounded-l-md pl-2 hover:text-muted-foreground"
              >
                {text}
              </button>
              <button
                type="button"
                aria-label={translate('removeFilter', { label: text })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => remove(index)}
                className="flex size-6 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          ref={ref}
          id={inputId}
          type="search"
          // Stays a searchbox (a textbox, which takes these too); a combobox role would rename it for every test.
          aria-autocomplete={query ? 'list' : undefined}
          aria-label={label}
          aria-keyshortcuts={shortcut}
          placeholder={terms.length ? undefined : placeholder}
          value={input}
          onChange={(event) => {
            setOpen(true)
            setAll(false)
            commit(event.target.value, false)
          }}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={() => {
            setOpen(false)
            setAll(false)
            onBlur?.()
          }}
          // A full-height input centres its text by the font box, which lands on the icons' centre without a nudge.
          className="h-full w-full min-w-24 flex-1 bg-transparent text-title-sm text-foreground outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      {(input !== '' || terms.length > 0) && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('clearSearch')}
          // Keeps the focus in the field, so clearing does not close it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
          className="text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          <X />
        </Button>
      )}
      {suggestions.length > 0 && (
        // Only a picture of the choices, mounted only while there are some: the field keeps the focus and the keys.
        <Command
          ref={listRef}
          shouldFilter={false}
          value={keys[current] ?? ''}
          onValueChange={(key) => setActive(Math.max(0, keys.indexOf(key)))}
          className="absolute top-full left-0 z-50 mt-1 size-auto w-64 shadow-elevation-2"
        >
          <CommandList label={translate('searchSuggestions')}>
            {suggestions.map((suggestion, index) => (
              <CommandItem
                key={keys[index]}
                value={keys[index]}
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => accept(suggestion)}
                className="h-8"
              >
                {suggestion.kind === 'field' ? (
                  <>
                    <span className="truncate">{suggestion.field.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {suggestion.field.id}:
                    </span>
                  </>
                ) : (
                  <>
                    <span className="shrink-0 text-muted-foreground">
                      {suggestion.field.label}:
                    </span>
                    <span className="truncate">{suggestion.label}</span>
                  </>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </label>
  )
}

const suggestionKey = <P,>(suggestion: Suggestion<P>) =>
  `${suggestion.kind}:${suggestion.field.id}:${suggestion.kind === 'value' ? suggestion.value : ''}`

/**
 * The list's search: a magnifier button that opens into a field ("/" opens it too). It stays open
 * while it holds a query; Escape clears the query, then closes it. Its slot keeps the same width
 * either way and the field grows leftwards inside it, so the other toolbar controls never move.
 */
function CollapsibleSearch<P>(props: SearchProps<P>) {
  const { label, value, query, className } = props
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const focusInput = useRef(false)
  const returnFocus = useRef(false)
  const terms = query ? termsOf(query.fields, query.params) : []
  const expanded = open || value !== '' || terms.length > 0

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey) return
      if (event.altKey || typing(event.target)) return
      event.preventDefault()
      if (input.current) return input.current.focus()
      focusInput.current = true
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Opened by a click or "/": the field opens to be typed in.
  useEffect(() => {
    if (!expanded || !focusInput.current) return
    focusInput.current = false
    input.current?.focus()
  }, [expanded])

  return (
    <div className={cn('flex min-w-0 flex-1 justify-end', className)}>
      <div
        className={cn(
          'flex h-8 max-w-full items-center',
          expanded ? 'w-[clamp(180px,26vw,320px)]' : 'w-8',
        )}
      >
        {expanded ? (
          <QueryInput
            {...props}
            inputRef={input}
            shortcut="/"
            className="w-full bg-muted/60 dark:bg-muted/40"
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onEscape={() => {
              returnFocus.current = true
              setOpen(false)
              input.current?.blur()
            }}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={(node) => {
                  if (node && returnFocus.current) {
                    returnFocus.current = false
                    node.focus()
                  }
                }}
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-keyshortcuts="/"
                onClick={() => {
                  focusInput.current = true
                  setOpen(true)
                }}
                className="text-muted-foreground"
              >
                <Search className="stroke-[1.5]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('search')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/**
 * The list's search field: grows to fill the toolbar between its other controls. With `query` it
 * also takes field terms (`status:paid`, `name:"Acme AG"`), shown as chips inside it.
 */
export function ListSearch<P>({
  collapsible,
  ...props
}: SearchProps<P> & {
  /** Fold into a magnifier button until asked for (the Documents page). */
  collapsible?: boolean
}) {
  if (collapsible) return <CollapsibleSearch {...props} />
  return <QueryInput {...props} className={cn('flex-1', props.className)} />
}
