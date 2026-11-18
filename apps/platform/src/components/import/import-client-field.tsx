'use client'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { ClientForm } from '@/components/clients/client-form'
import { inputClass } from '@/components/clients/fields'
import { ClientSearch } from '@/components/invoices/client-search'
import type { Client } from '@/lib/clients'
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
  const [creating, setCreating] = useState(false)
  const documentName = clientName.trim()
  return (
    <div className="grid gap-2 sm:col-span-2">
      <FormField id={id} label={translate('client')} error={error} required>
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
        {creating && (
          <ClientForm
            prefillName={documentName}
            onClose={() => setCreating(false)}
            onSaved={(created) => {
              setCreating(false)
              onPick(created)
            }}
          />
        )}
      </FormField>
      {!clientId && documentName && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2">
          <p className="min-w-0 text-caption text-muted-foreground">
            {translate('importDocumentNames')}{' '}
            <span className="font-medium text-foreground">{documentName}</span>
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
            <UserPlus />
            {translate('importCreateClient', { name: documentName })}
          </Button>
        </div>
      )}
    </div>
  )
}
