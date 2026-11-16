'use client'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { inputClass } from '@/components/clients/fields'
import { ClientSearch } from '@/components/invoices/client-search'
import { errorMessage } from '@/lib/api'
import { useSaveClient, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

/** An imported record's client, chosen among the existing ones (the name the document gave can become a new client in one click). */
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
  const create = useSaveClient()
  const documentName = clientName.trim()
  return (
    <FormField id={id} label={translate('client')} error={error} required className="sm:col-span-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            {...describedBy(id, error)}
            className={cn(inputClass, 'flex items-center justify-between text-left')}
          >
            <span className={cn('truncate', !clientId && 'text-muted-foreground')}>
              {clientId
                ? clientName || translate('selectedClient')
                : translate('chooseAClient2', {
                    value1: clientName ? translate('document2', { clientName: clientName }) : '',
                  })}
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
      {!clientId && documentName && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={create.isPending}
            onClick={() => create.mutate({ input: { name: documentName } }, { onSuccess: onPick })}
          >
            <UserPlus />
            {create.isPending
              ? translate('saving')
              : translate('importCreateClient', { name: documentName })}
          </Button>
          {create.error && (
            <span role="alert" className="text-body-sm text-destructive">
              {errorMessage(create.error)}
            </span>
          )}
        </div>
      )}
    </FormField>
  )
}
