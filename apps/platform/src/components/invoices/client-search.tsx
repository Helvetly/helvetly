'use client'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandCreateItem,
  CommandItem,
  CommandList,
} from '@helvetly/ui/components/command'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, Plus } from 'lucide-react'
import { useState } from 'react'

import { Initials } from '@/components/initials'
import { useClientSearch, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

/** Clients searched on the server, in a command list (for pickers inside a popover). */
export function ClientSearch({
  selectedId,
  onSelect,
  onCreate,
}: {
  selectedId: string | null
  onSelect: (client: Client) => void
  /** Offers "New client" at the bottom. */
  onCreate?: () => void
}) {
  const [term, setTerm] = useState('')
  const search = useClientSearch(term)
  const clients = search.data?.data ?? []
  return (
    // The server filters, so cmdk must not filter again.
    <Command shouldFilter={false}>
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder={translate('searchClientsByNameCityOrNumber')}
      />
      <CommandList className="max-h-80">
        <CommandEmpty>
          {search.isFetching ? translate('searching') : translate('noClientFound')}
        </CommandEmpty>
        <CommandGroup heading={term ? translate('results') : translate('activeClients')}>
          {clients.map((client) => (
            <CommandItem
              key={client.id}
              value={client.id}
              onSelect={() => onSelect(client)}
              className="gap-2.5 py-2"
            >
              <Initials name={client.name} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate">{client.name}</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  #{client.number}
                  {client.city && ` · ${client.city}`}
                  {client.currency && ` · ${client.currency}`}
                </span>
              </span>
              {client.is_draft && <StatusBadge tone="amber">{translate('draft')}</StatusBadge>}
              <Check
                className={cn('size-4', client.id === selectedId ? 'opacity-100' : 'opacity-0')}
              />
            </CommandItem>
          ))}
        </CommandGroup>
        {onCreate && (
          <CommandCreateItem value="__new" onSelect={onCreate}>
            <Plus />
            {translate('newClient2')}
          </CommandCreateItem>
        )}
      </CommandList>
    </Command>
  )
}
