import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'

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

/**
 * The list's search: a magnifier button that opens into a field ("/" opens it too). It stays open
 * while it holds a query; Escape clears the query, then closes it. Its slot keeps the same width
 * either way and the field grows leftwards inside it, so the other toolbar controls never move.
 */
export function ListSearch({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const focusInput = useRef(false)
  const returnFocus = useRef(false)
  const expanded = open || value !== ''

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

  return (
    <div className={cn('flex min-w-0 flex-1 justify-end', className)}>
      <div
        className={cn(
          'flex h-8 max-w-full items-center transition-[width] duration-200 ease-out motion-reduce:transition-none',
          expanded ? 'w-[clamp(180px,26vw,320px)]' : 'w-8',
        )}
      >
        {expanded ? (
          // Quiet, no border: the toolbar row is its box (field-surface.spec.ts).
          <label className="field-quiet flex h-full w-full min-w-0 cursor-text items-center gap-2 rounded-md bg-muted/60 pr-1 pl-2 text-muted-foreground focus-within:text-foreground dark:bg-muted/40">
            <Search className="size-4 shrink-0 stroke-[1.5]" />
            <input
              ref={(node) => {
                input.current = node
                // Opened by a click or "/": the field opens to be typed in.
                if (node && focusInput.current) {
                  focusInput.current = false
                  node.focus()
                }
              }}
              type="search"
              aria-label={label}
              aria-keyshortcuts="/"
              placeholder={placeholder}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                if (value !== '') return onChange('')
                returnFocus.current = true
                setOpen(false)
              }}
              // A full-height input centres its text by the font box, which lands on the icons' centre without a nudge.
              className="h-full w-full min-w-0 bg-transparent text-title-sm text-foreground outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
            />
            {value !== '' && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={translate('clearSearch')}
                // Keeps the focus in the field, so clearing does not close it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange('')
                  setOpen(true)
                  input.current?.focus()
                }}
                className="text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <X />
              </Button>
            )}
          </label>
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
