'use client'
import { localizedHref } from '@helvetly/i18n'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { displayPhone } from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  ChevronDown,
  Ellipsis,
  FilePlus2,
  Globe,
  LayoutTemplate,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Power,
  PowerOff,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { useImportAction } from '@/components/import/import-button'
import { initialsOf } from '@/components/initials'
import { newInvoiceHref } from '@/components/invoices/compose'
import { RecordLink, RecordPageButton } from '@/components/record-link'
import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'

import { addressLines, ClientStatusBadge, MissingDataBadges } from './client-bits'
import { countryName } from './client-form-model'
import { UidVerifiedBadge } from './uid-register-fields'

export const websiteHref = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)
export const mapsHref = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`

export type HeaderFact = {
  label: string
  /** The same icon as the field's row in the Contact card. */
  icon: LucideIcon
  text: string
  href: string
  external?: boolean
}

/** The client's key facts under its name, each a link; a fact the client lacks is left out. */
export function headerFacts(client: Client): HeaderFact[] {
  const country = client.country ? countryName(client.country) : null
  const lines = addressLines(client)
  const place = [client.city, country].filter(Boolean).join(', ')
  const facts: (HeaderFact | null)[] = [
    client.email
      ? {
          label: translate('email'),
          icon: Mail,
          text: client.email,
          href: `mailto:${client.email}`,
        }
      : null,
    client.phone
      ? {
          label: translate('phone'),
          icon: Phone,
          text: displayPhone(client.phone),
          href: `tel:${client.phone}`,
        }
      : null,
    place
      ? {
          label: translate('location'),
          icon: MapPin,
          text: place,
          href: mapsHref([...lines, country].filter(Boolean).join(', ')),
          external: true,
        }
      : null,
    client.website
      ? {
          label: translate('website'),
          icon: Globe,
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
  onImportInvoices,
  tabs,
}: {
  client: Client
  canDelete: boolean
  onClose: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onFillTemplate: () => void
  /** Opens the invoice import for this client; without it (no right to write invoices) no menu. */
  onImportInvoices?: () => void
  tabs: ReactNode
}) {
  const facts = headerFacts(client)
  const importAction = useImportAction(translate('importInvoices'), () => onImportInvoices?.())
  return (
    <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
      <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
        <Badge size="sm" className="font-code ml-1">
          #{client.number}
        </Badge>
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
            <ActionMenuContent
              kind="dropdown"
              menu={{
                header: `#${client.number} · ${client.name}`,
                actions: [
                  {
                    id: 'toggle',
                    group: 'status',
                    icon: client.is_active ? <PowerOff /> : <Power />,
                    label: client.is_active ? translate('deactivate') : translate('activate'),
                    onSelect: onToggle,
                  },
                  {
                    id: 'edit',
                    group: 'edit',
                    icon: <Pencil />,
                    label: translate('editDetails'),
                    onSelect: onEdit,
                  },
                  canDelete && {
                    id: 'delete',
                    group: 'danger',
                    icon: <Trash2 />,
                    label: translate('delete'),
                    onSelect: onDelete,
                  },
                ],
              }}
            />
          </DropdownMenu>
          <Tip label={translate('newDocumentFromATemplate')}>
            <Button variant="outline" onClick={onFillTemplate}>
              <LayoutTemplate className="size-3.5" />
              <span className="max-sm:sr-only">{translate('document')}</span>
            </Button>
          </Tip>
          <div className="flex items-center">
            <Button asChild className={cn(onImportInvoices && 'rounded-r-none')}>
              <RecordLink href={newInvoiceHref(client.id)}>
                <FilePlus2 className="size-3.5" />
                {translate('newInvoice2')}
              </RecordLink>
            </Button>
            {onImportInvoices && (
              <DropdownMenu>
                <Tip label={translate('moreWaysToAddInvoices')}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      aria-label={translate('moreWaysToAddInvoices')}
                      className="rounded-l-none border-l border-primary-foreground/20"
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                </Tip>
                <ActionMenuContent
                  kind="dropdown"
                  menu={{ actions: [importAction] }}
                  className="min-w-48"
                />
              </DropdownMenu>
            )}
          </div>
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
              {/* Active is the normal state; only what invoicing lacks or an inactive client gets a badge. */}
              <MissingDataBadges client={client} />
              {!client.is_active && <ClientStatusBadge client={{ ...client, is_draft: false }} />}
              <UidVerifiedBadge client={client} />
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
  const Icon = fact.icon
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-caption text-muted-foreground">{fact.label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-body">
        <Icon aria-hidden className="size-3.5 shrink-0 stroke-[1.5] text-muted-foreground" />
        <a
          href={localizedHref(fact.href)}
          target={fact.external ? '_blank' : undefined}
          rel={fact.external ? 'noreferrer' : undefined}
          className={cn(
            'min-w-0 truncate underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground',
            fact.label === 'Phone' && 'tabular-nums',
          )}
        >
          {fact.text}
        </a>
      </dd>
    </div>
  )
}
