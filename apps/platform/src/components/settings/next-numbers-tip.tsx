'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Info } from 'lucide-react'
import { useState } from 'react'

import { translate } from '@/lib/i18n'

/** An (i) listing the next number of every document type: opens on hover, focus and tap. */
export function NextNumbersTip({ items }: { items: { label: string; value: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={translate('nextNumbers')}
          className="inline-flex shrink-0 rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
          onPointerLeave={(event) => event.pointerType === 'mouse' && setOpen(false)}
          onFocus={() => setOpen(true)}
          onClick={(event) => {
            event.preventDefault() // a click after the hover must not toggle it shut again
            setOpen(true)
          }}
        >
          <Info className="size-4 stroke-[1.75]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={translate('nextNumbers')}
        className="w-auto max-w-[calc(100vw-2rem)] gap-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p className="px-1 font-medium">{translate('nextNumbers')}</p>
        <ul data-slot="next-numbers-list">
          {items.map((item) => (
            <li
              key={item.label}
              className="flex items-baseline justify-between gap-6 border-t px-1 py-1.5 text-body-sm"
            >
              <span className="whitespace-nowrap text-muted-foreground">{item.label}</span>
              <span className="font-code whitespace-nowrap text-foreground">{item.value}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
