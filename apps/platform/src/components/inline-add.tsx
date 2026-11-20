'use client'

import { Input } from '@helvetly/ui/components/input'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { errorMessage } from '@/lib/api'

/**
 * A surrounding dialog or sheet listens for Escape on document in the capture phase, before the field sees it;
 * marking it handled from window, which captures first, makes Escape close only the field inside `within`.
 */
export function useClaimEscape(within: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const claimEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        event.target instanceof Node &&
        within.current?.contains(event.target)
      )
        event.preventDefault()
    }
    window.addEventListener('keydown', claimEscape, { capture: true })
    return () => window.removeEventListener('keydown', claimEscape, { capture: true })
  }, [within])
}

/**
 * A value edited in place: saved on Enter (⌘/Ctrl+Enter when multiline) or when focus leaves; Escape, or an
 * unchanged value, closes it without saving. Clearing a value saves "", which the API stores as empty.
 * A failed save keeps the text and shows why.
 */
export function InlineTextEditor({
  label,
  initial = '',
  placeholder,
  mono = false,
  multiline = false,
  maxLength,
  pendingHint,
  save,
  onDone,
}: {
  label: string
  initial?: string
  placeholder?: string
  mono?: boolean
  multiline?: boolean
  /** The API's limit: no more can be typed, and a multiline field counts what is left. */
  maxLength?: number
  /** Shown under the field while a slow save runs, e.g. a website being checked. */
  pendingHint?: string
  save: (text: string) => Promise<unknown>
  onDone: () => void
}) {
  const [text, setText] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const wrapper = useRef<HTMLSpanElement>(null)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const closing = useRef(false)
  useClaimEscape(wrapper)

  useEffect(() => {
    const element = field.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const close = () => {
    closing.current = true
    onDone()
  }
  const commit = async () => {
    if (closing.current || pending) return
    const value = text.trim()
    if (value === initial.trim()) return close()
    setPending(true)
    setError('')
    try {
      await save(value)
      close()
    } catch (failure) {
      setError(errorMessage(failure))
      field.current?.focus()
    } finally {
      setPending(false)
    }
  }
  const shared = {
    ref: field,
    'aria-label': label,
    'aria-invalid': error ? true : undefined,
    'aria-busy': pending || undefined,
    value: text,
    readOnly: pending,
    placeholder,
    maxLength,
    onBlur: () => void commit(),
  }

  return (
    <span ref={wrapper} className="grid flex-1 gap-1 py-1">
      {multiline ? (
        <Textarea
          {...shared}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void commit()
            }
            if (event.key === 'Escape') close()
          }}
          // Grows with the text up to about ten lines, then scrolls: never a page-long box.
          className="max-h-60 min-h-20 resize-none overflow-y-auto text-body-sm leading-relaxed"
        />
      ) : (
        <Input
          {...shared}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            }
            if (event.key === 'Escape') close()
          }}
          className={cn('h-8', mono && 'font-code text-body-sm')}
        />
      )}
      {multiline && maxLength && (
        <span aria-hidden className="text-right text-caption text-muted-foreground tabular-nums">
          {text.length} / {maxLength}
        </span>
      )}
      {pending && pendingHint && (
        <output className="text-xs text-muted-foreground">{pendingHint}</output>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  )
}

/**
 * An empty value on a detail page: "Add …" becomes an input in place, saved on Enter or when focus leaves;
 * Escape (or leaving it empty) puts the link back. A failed save keeps the text and shows why.
 */
export function InlineAdd({
  label,
  ...editor
}: {
  label: string
  placeholder?: string
  mono?: boolean
  multiline?: boolean
  pendingHint?: string
  save: (text: string) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return <InlineTextEditor label={label} {...editor} onDone={() => setEditing(false)} />
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="cursor-pointer text-link underline underline-offset-2 hover:no-underline"
    >
      {label}
    </button>
  )
}

/** A value that opens its editor in place when clicked, with a pencil on hover and a tooltip. */
export function EditableValue({
  label,
  onEdit,
  className,
  pencilClassName,
  children,
}: {
  label: string
  onEdit: () => void
  className?: string
  /** Places the pencil, e.g. on the first line of a top-aligned block. */
  pencilClassName?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            'group/edit flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
            className,
          )}
        >
          <span className="min-w-0 flex-1">{children}</span>
          <Pencil
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100 max-sm:opacity-100',
              pencilClassName,
            )}
          />
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
