'use client'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { Building2, ChevronsUpDown, ScanSearch, Search, UserPlus, UserRound } from 'lucide-react'
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
    is_company:
      typeof data.client_is_company === 'boolean'
        ? data.client_is_company
        : looksLikeCompany(
            displayValue(data.client_name),
            text('vat_number'),
            text('registration_number'),
          ),
  }
  // Only what the document carried: an empty value would wipe a default (the country) for nothing.
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value !== ''))
}

const LEGAL_FORM =
  /\b(ag|gmbh|sàrl|sarl|sa|sagl|ltd|llc|inc|plc|kg|ohg|gbr|ug|bv|nv|srl|spa|sas|sp\. ?z ?o\.? ?o\.?|s\.a\.|e\.v\.|verein|stiftung|genossenschaft|holding|group|gruppe)\b/i

/**
 * Whether a party the model did not classify is a business: a legal form or a VAT/registration number says so; a
 * plain first and last name is a person.
 */
export const looksLikeCompany = (name: string, vat: string, registration: string) =>
  LEGAL_FORM.test(name) || vat !== '' || registration !== '' || name.trim().split(/\s+/).length > 3

/** What the document says about the party, as labelled rows, each only when found. */
const detailRows = (found: Partial<FormValues>): [string, string][] =>
  (
    [
      [
        translate('address'),
        [
          [found.street, found.street_number].filter(Boolean).join(' '),
          [found.zip, found.city].filter(Boolean).join(' '),
          found.country,
        ]
          .filter(Boolean)
          .join(', '),
      ],
      [translate('importClientVat'), found.vat_number ?? ''],
      [translate('email'), found.email ?? ''],
    ] as [string, string][]
  ).filter(([, value]) => value !== '')

/** "MV" for Melanie Vala, "MA" for Muster AG. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

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
  const details = detailRows(found)
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
          className="overflow-hidden rounded-xl border bg-card"
        >
          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
            <p className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <ScanSearch aria-hidden className="size-3.5" />
              {translate('importFoundOnDocument')}
            </p>
            <span className="rounded-full bg-warning-surface px-2 py-0.5 text-caption font-medium text-warning ring-1 ring-warning-border ring-inset">
              {translate('importNotInClients')}
            </span>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-surface text-body-sm font-semibold text-brand"
            >
              {initials(documentName)}
            </span>
            <div className="grid min-w-0 flex-1 gap-1.5">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate text-body font-semibold">{documentName}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                  {found.is_company === false ? (
                    <UserRound aria-hidden className="size-3" />
                  ) : (
                    <Building2 aria-hidden className="size-3" />
                  )}
                  {found.is_company === false ? translate('person') : translate('company')}
                </span>
              </p>
              {details.length > 0 ? (
                <dl className="grid gap-x-4 gap-y-1 text-caption sm:grid-cols-[auto_minmax(0,1fr)]">
                  {details.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="truncate">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-caption text-muted-foreground">
                  {translate('importOnlyNameFound')}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-4 py-2.5">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
              <Search />
              {translate('importPickAnother')}
            </Button>
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <UserPlus />
              {translate('importCreateClient', { name: documentName })}
            </Button>
          </div>
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
