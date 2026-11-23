'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { MapPin, MapPinned } from 'lucide-react'
import { useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent } from 'react'

import {
  addressHeadline,
  addressPlace,
  mapsHref,
  MIN_ADDRESS_CHARS,
  useAddressSuggestions,
  type Address,
} from '@/lib/addresses'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

/**
 * A location field that suggests addresses (OpenStreetMap, through the API) as one types, biased to the
 * workspace's country. Free text always stays: suggestions only offer, so "Room 3, 2nd floor" is fine. The
 * list floats over the form, so nothing below moves; Arrow down moves into it, Escape returns to the field.
 * A filled field shows a map link inside its right edge.
 */
export function AddressInput({
  value,
  onChange,
  className,
  ...input
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}) {
  const country = useSession().data?.workspace.country ?? 'CH'
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const search = useAddressSuggestions(value, country, open)
  const found = search.data ?? []
  const showing = open && value.trim().length >= MIN_ADDRESS_CHARS && found.length > 0

  const close = () => {
    setOpen(false)
    field.current?.focus()
  }
  const pick = (address: Address) => {
    onChange(address.label)
    close()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!showing) return
    const list = [...(root.current?.querySelectorAll<HTMLButtonElement>('li > button') ?? [])]
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = at + (event.key === 'ArrowDown' ? 1 : -1)
      if (next < 0) field.current?.focus()
      else list[Math.min(next, list.length - 1)]?.focus()
    } else if (event.key === 'Escape') {
      // Closes the list, not the drawer.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }
  // Leaving the field and its list closes the list; moving between them doesn't.
  const onBlur = (event: FocusEvent) => {
    if (!root.current?.contains(event.relatedTarget)) setOpen(false)
  }

  return (
    <div ref={root} className="relative">
      <input
        {...input}
        ref={field}
        autoComplete="off"
        value={value}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        className={cn(className, value.trim() && 'pr-9')}
      />
      {value.trim() && <MapLink location={value} className="absolute inset-y-0 right-0 w-9" />}
      {showing && (
        <div className="absolute top-full left-0 z-30 mt-1 w-[max(100%,22rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-elevation-2">
          <ul aria-label={translate('addressSuggestions')}>
            {found.map((address) => (
              <li key={address.label}>
                <button
                  type="button"
                  // Keeps the focus where it is, so the field's blur doesn't close the list first.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(address)}
                  onKeyDown={onKeyDown}
                  onBlur={onBlur}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{addressHeadline(address)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {addressPlace(address, country)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-2 pt-1 pb-0.5 text-right text-caption text-muted-foreground">
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              tabIndex={-1}
              className="underline underline-offset-2 hover:no-underline"
            >
              {translate('osmAttribution')}
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

/** An icon link that opens a location on OpenStreetMap, with its name in a tooltip. */
export function MapLink({ location, className }: { location: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={mapsHref(location)}
          target="_blank"
          rel="noreferrer"
          aria-label={translate('openInMaps')}
          className={cn(
            'inline-flex items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            className,
          )}
        >
          <MapPinned aria-hidden className="size-4" />
        </a>
      </TooltipTrigger>
      <TooltipContent>{translate('openInMaps')}</TooltipContent>
    </Tooltip>
  )
}
