'use client'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { Building2, ChevronsUpDown, ScanSearch, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { ClientForm } from '@/components/clients/client-form'
import type { FormValues } from '@/components/clients/client-form-model'
import { inputClass } from '@/components/clients/fields'
import { ClientSearch } from '@/components/invoices/client-search'
import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { displayValue, type ImportRecord } from '@/lib/imports'

/** The billed party's details the AI read from the document, as a new client's starting values. */
export function clientFromDocument(data: ImportRecord['data']): Partial<FormValues> {
  const text = (field: string) => displayValue(data[`client_${field}`]).trim()
  const country = text('country').toUpperCase()
  const found: Partial<FormValues> = {
    name: displayValue(data.client_name).trim(),
    email: text('email'),
    street: text('street'),
    street_number: text('street_number'),
    zip: text('zip'),
    city: text('city'),
    vat_number: text('vat_number'),
    registration_number: text('registration_number'),
    ...(/^[A-Z]{2}$/.test(country) && { country }),
    ...(typeof data.client_is_company === 'boolean' && { is_company: data.client_is_company }),
  }
  // Only what the document carried: an empty value would wipe a default (the country) for nothing.
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value !== ''))
}

/** "Bahnhofstrasse 12, 8001 Zürich, CH", then the VAT number and email, each only when found. */
const detailLines = (found: Partial<FormValues>) =>
  [
    [
      [found.street, found.street_number].filter(Boolean).join(' '),
      [found.zip, found.city].filter(Boolean).join(' '),
      found.country,
    ]
      .filter(Boolean)
      .join(', '),
    found.vat_number && `${translate('importClientVat')} ${found.vat_number}`,
    found.email,
  ].filter((line): line is string => Boolean(line))

/**
 * An imported record's client, chosen among the existing ones. When the document's client is not one of them,
 * what the document says about it is shown with a way to create it from those details.
 */
export function ImportClientField({
  id,
  clientId,
  clientName,
  found,
  error,
  onPick,
}: {
  id: string
  clientId: string
  /** The chosen client's name, or the name the document gave. */
  clientName: string
  /** The billed party as the document describes it. */
  found: Partial<FormValues>
  error?: string
  onPick: (client: Client) => void
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const documentName = clientName.trim()
  const lines = detailLines(found)
  return (
    <div className="grid gap-3 sm:col-span-2">
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
      </FormField>
      {!clientId && documentName && (
        <section
          aria-label={translate('importFoundOnDocument')}
          className="grid gap-3 rounded-lg border bg-muted/30 p-3"
        >
          <p className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
            <ScanSearch aria-hidden className="size-3.5" />
            {translate('importFoundOnDocument')}
          </p>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground ring-1 ring-border">
              <Building2 aria-hidden className="size-4" />
            </span>
            <div className="grid min-w-0 gap-0.5">
              <p className="truncate text-body-sm font-medium">{documentName}</p>
              {lines.map((line) => (
                <p key={line} className="truncate text-caption text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          </div>
          <p className="text-caption text-pretty text-muted-foreground">
            {translate('importClientNotYours')}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => setCreating(true)}
          >
            <UserPlus />
            {translate('importCreateClient', { name: documentName })}
          </Button>
        </section>
      )}
      {creating && (
        <ClientForm
          prefill={found}
          onClose={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false)
            onPick(created)
          }}
        />
      )}
    </div>
  )
}
