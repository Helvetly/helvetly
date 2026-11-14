'use client'

import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'

import { inputClass } from '@/components/clients/fields'
import { ClientSearch } from '@/components/invoices/client-search'
import type { Client } from '@/lib/clients'

/** An imported record's client, chosen among the existing ones (an import never creates clients). */
export function ImportClientField({
  id,
  clientId,
  clientName,
  error,
  onPick,
}: {
  id: string
  clientId: string
  /** The chosen client's name, or the name the document gave. */
  clientName: string
  error?: string
  onPick: (client: Client) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <FormField id={id} label="Client" error={error} required className="sm:col-span-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            {...describedBy(id, error)}
            className={cn(inputClass, 'flex items-center justify-between text-left')}
          >
            <span className={cn('truncate', !clientId && 'text-muted-foreground')}>
              {clientId
                ? clientName || 'Selected client'
                : `Choose a client${clientName ? ` (document: ${clientName})` : ''}`}
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] p-0">
          <ClientSearch
            selectedId={clientId || null}
            onSelect={(client) => {
              onPick(client)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </FormField>
  )
}
