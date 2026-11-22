import { Button } from '@helvetly/ui/components/button'
import { inputClass } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown, X } from 'lucide-react'
import { useState } from 'react'

import { ClientSearch } from '@/components/invoices/client-search'
import { useClient } from '@/lib/clients'
import { translate } from '@/lib/i18n'

/** The Filters popover's client control: a field that opens a client search. */
export function ClientFilter({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const client = useClient(value).data
  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label={translate('client')}
            // The Combobox's field look, so it matches the popover's other controls.
            className={cn(
              inputClass,
              'justify-between gap-1.5 bg-clip-border text-left font-normal hover:bg-card aria-expanded:border-ring aria-expanded:bg-card dark:hover:bg-input/30 dark:aria-expanded:bg-input/30',
              value && 'pr-14',
            )}
          >
            <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
              {value ? (client?.name ?? translate('loading')) : `${translate('anyClient')}…`}
            </span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <ClientSearch
            selectedId={value}
            onSelect={(picked) => {
              onChange(picked.id)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          aria-label={translate('anyClient')}
          onClick={() => onChange(null)}
          className="absolute top-1/2 right-8 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
