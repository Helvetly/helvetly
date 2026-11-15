'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { displayPhone } from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  Ellipsis,
  FilePlus2,
  LayoutTemplate,
  Pencil,
  Power,
  Trash2,
  X,
} from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { initialsOf } from '@/components/initials'
import { newInvoiceHref } from '@/components/invoices/client-invoices'
import { RecordPageButton } from '@/components/record-link'
import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

import { addressLines, ClientStatusBadge } from './client-bits'
import { countryName } from './client-form-model'

export const websiteHref = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)
export const mapsHref = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`

export type HeaderFact = { label: string; text: string; href: string; external?: boolean }

/** The client's key facts under its name, each a link; a fact the client lacks is left out. */
export function headerFacts(client: Client): HeaderFact[] {
  const country = client.country ? countryName(client.country) : null
  const lines = addressLines(client)
  const place = [client.city, country].filter(Boolean).join(', ')
  const facts: (HeaderFact | null)[] = [
    client.email
      ? { label: translate('email'), text: client.email, href: `mailto:${client.email}` }
      : null,
    client.phone
      ? { label: translate('phone'), text: displayPhone(client.phone), href: `tel:${client.phone}` }
      : null,
    place
      ? {
          label: translate('location'),
          text: place,
          href: mapsHref([...lines, country].filter(Boolean).join(', ')),
          external: true,
        }
      : null,
    client.website
      ? {
          label: translate('website'),
          text: client.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
          href: websiteHref(client.website),
          external: true,
        }
      : null,
  ]
  return facts.filter((fact) => fact !== null)
}

/** "Person · goes by Anna" / "Company · contact Anna Muster". */
export function clientKind(client: Pick<Client, 'is_company' | 'preferred_name'>): string {
  const kind = client.is_company ? translate('company') : translate('person')
  if (!client.preferred_name) return kind
  return `${kind} · ${client.is_company ? 'contact' : translate('goesBy')} ${client.preferred_name}`
}

/** An icon-only control with its name in a tooltip. */
function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The client drawer's sticky header: the toolbar (number, actions, close), then who the client is
 * and how to reach it, then the tabs.
 */
export function ClientHeader({
  client,
  canDelete,
  onClose,
  onEdit,
  onToggle,
  onDelete,
  onFillTemplate,
  tabs,
}: {
  client: Client
  canDelete: boolean
  onClose: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onFillTemplate: () => void
  tabs: ReactNode
}) {
  const facts = headerFacts(client)
  return (
    <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
      <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
        <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground tabular-nums">
          #{client.number}
        </span>
        <span className="ml-1.5 text-body-sm text-muted-foreground max-sm:sr-only">
          {translate('client')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <Tip label={translate('moreActions')}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={translate('moreActions')}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil />
                {translate('editDetails')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onToggle}>
                <Power /> {client.is_active ? translate('deactivate') : translate('activate')}
              </DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 />
                    {translate('delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tip label={translate('newDocumentFromATemplate')}>
            <Button variant="outline" onClick={onFillTemplate}>
              <LayoutTemplate className="size-3.5" />
              <span className="max-sm:sr-only">{translate('document')}</span>
            </Button>
          </Tip>
          <Button asChild>
            <a href={localizedHref(newInvoiceHref(client.id))}>
              <FilePlus2 className="size-3.5" />
              {translate('newInvoice2')}
            </a>
          </Button>
          <RecordPageButton />
          <Tip label={translate('close')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={translate('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-5 sm:px-6">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden
            className={cn(
              'flex size-12 shrink-0 items-center justify-center bg-muted text-title-sm font-semibold text-muted-foreground shadow-elevation-1',
              client.is_company ? 'rounded-xl' : 'rounded-full',
            )}
          >
            {client.is_company ? (
              <Building2 className="size-5 stroke-[1.5]" />
            ) : (
              initialsOf(client.name)
            )}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-page leading-tight font-medium tracking-[-0.02em] break-words">
                {client.name}
              </h2>
              {/* Active is the normal state; only a draft or an inactive client gets a badge. */}
              {(client.is_draft || !client.is_active) && <ClientStatusBadge client={client} />}
              {client.is_draft && !client.is_active && (
                <ClientStatusBadge client={{ ...client, is_draft: false }} />
              )}
            </div>
            <p className="text-body-sm text-muted-foreground">{clientKind(client)}</p>
          </div>
        </div>

        {facts.length > 0 && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
            {facts.map((fact) => (
              <Fact key={fact.label} fact={fact} />
            ))}
          </dl>
        )}

        {tabs}
      </div>
      <div className="border-b border-border/60" />
    </header>
  )
}

function Fact({ fact }: { fact: HeaderFact }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-caption text-muted-foreground">{fact.label}</dt>
      <dd className="min-w-0 truncate text-body">
        <a
          href={localizedHref(fact.href)}
          target={fact.external ? '_blank' : undefined}
          rel={fact.external ? 'noreferrer' : undefined}
          className={cn(
            'underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground',
            fact.label === 'Phone' && 'tabular-nums',
          )}
        >
          {fact.text}
        </a>
      </dd>
    </div>
  )
}
