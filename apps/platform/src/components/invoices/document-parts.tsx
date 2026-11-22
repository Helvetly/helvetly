'use client'
import { Callout } from '@helvetly/ui/components/callout'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowUpRight, CircleAlert, CircleHelp, Plus } from 'lucide-react'
import Link from 'next/link'
import { type ComponentProps, type ReactNode, useState } from 'react'

import { addressLines } from '@/components/clients/client-bits'
import { ClientFixButton } from '@/components/clients/client-fix'
import { ClientForm } from '@/components/clients/client-form'
import { countryName } from '@/components/clients/client-form-model'
import { type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { type InvoiceSettings } from '@/lib/invoices'

import { ClientSearch } from './client-search'

// The printed-page parts the invoice and quote editors share.

export const PARTY_LABEL =
  'text-caption font-medium tracking-[0.04em] text-muted-foreground uppercase'

/** The longest intro or footer text, in characters (the API refuses more: invoices.MaxDocumentText). */
export const DOCUMENT_TEXT_MAX = 800

// The paper is its box: quiet like the meta values (`field-quiet`, e2e/visual/field-surface.spec.ts). It grows
// with its text up to 8 lines (`lh` is the field's own line height), then scrolls inside.
export const proseInput =
  'field-quiet w-full resize-none overflow-y-auto rounded-md bg-transparent px-2 py-1.5 -mx-2 max-h-[calc(8lh+0.75rem)] text-body leading-relaxed outline-none transition-colors [field-sizing:content] placeholder:text-placeholder hover:bg-muted/50 focus:bg-card focus:ring-2 focus:ring-ring/40'

/**
 * A paper text (intro or footer) limited to DOCUMENT_TEXT_MAX characters, with its count at the bottom right: shown
 * while the field is focused and from 90% of the limit on, red past it (an older, longer text must be shortened
 * before saving). The count floats over the field, so showing it never moves anything.
 */
export function ProseField({
  className,
  wrapperClassName,
  value,
  ...props
}: Omit<ComponentProps<'textarea'>, 'value'> & { value: string; wrapperClassName?: string }) {
  const length = [...value].length
  const over = length > DOCUMENT_TEXT_MAX
  return (
    <div className={cn('group relative', wrapperClassName)}>
      <textarea
        {...props}
        value={value}
        maxLength={DOCUMENT_TEXT_MAX}
        rows={1}
        className={className}
      />
      <span
        data-slot="textarea-count"
        className={cn(
          'pointer-events-none absolute right-3 bottom-1 rounded bg-card/90 px-1 text-caption text-muted-foreground tabular-nums',
          over
            ? 'text-destructive'
            : length < DOCUMENT_TEXT_MAX * 0.9 && 'hidden group-focus-within:block',
        )}
      >
        {length} / {DOCUMENT_TEXT_MAX}
      </span>
    </div>
  )
}

/** The paper's closing text: pinned to the bottom of the page, or after the content when that is longer. */
export function PaperFooter({ children }: { children: ReactNode }) {
  // The padding keeps the gap after the totals; the rule sits outside the field, so focus outlines only the text.
  return (
    <div className="mt-auto pt-10">
      <div className="border-t border-border/70 pt-4">{children}</div>
    </div>
  )
}

/** Name, address lines, country and VAT number, set the same way for seller and client. */
function PartyLines({
  party,
}: {
  party: Pick<
    Client,
    'name' | 'street' | 'street_number' | 'apt' | 'zip' | 'city' | 'country' | 'vat_number'
  >
}) {
  return (
    <>
      <span className="pr-14 text-title-sm font-medium">{party.name}</span>
      {addressLines(party).map((line) => (
        <span key={line} className="text-body leading-relaxed">
          {line}
        </span>
      ))}
      {party.country && (
        <span className="text-body leading-relaxed text-muted-foreground">
          {countryName(party.country)}
        </span>
      )}
      {party.vat_number && (
        <span className="font-code mt-0.5 text-caption text-muted-foreground">
          {party.vat_number}
        </span>
      )}
    </>
  )
}

/** The workspace's company, as it prints ("Billed by" on an invoice). */
export function SellerBlock({ settings, label }: { settings: InvoiceSettings; label: string }) {
  return (
    <div className="grid content-start gap-2">
      <span className={PARTY_LABEL}>{label}</span>
      {/* mt-1: level with the client's name, which sits inside its padded picker button */}
      <div className="mt-1 grid">
        <PartyLines
          party={{
            ...settings.seller,
            name: settings.seller.name || translate('yourCompany'),
          }}
        />
      </div>
      {!settings.is_complete && (
        <Link
          href="/settings/company"
          className="inline-flex w-fit items-center gap-1 text-caption text-link underline underline-offset-2 hover:no-underline"
        >
          {translate('completeYourCompanyDetails')}
          <ArrowUpRight className="size-3" />
        </Link>
      )}
    </div>
  )
}

/** The client (with its address as it will print) or the picker ("Billed to" on an invoice). */
export function ClientBlock({
  label,
  missing,
  client,
  open,
  locked,
  invalid,
  onOpenChange,
  onPick,
}: {
  label: string
  /** Shown under an empty picker once the document was tried without a client. */
  missing: string
  client: Client | null
  open: boolean
  locked: boolean
  invalid: boolean
  onOpenChange: (open: boolean) => void
  onPick: (client: Client) => void
}) {
  const [creating, setCreating] = useState(false)
  return (
    <div className="grid content-start gap-2">
      <span className={cn(PARTY_LABEL, invalid && 'text-destructive')}>
        {label}
        <span aria-hidden className="ml-0.5 text-destructive">
          *
        </span>
      </span>
      <Popover open={open && !locked} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild disabled={locked}>
          {client ? (
            <button
              type="button"
              className="group relative -mx-3 -my-2 grid w-[calc(100%+24px)] max-w-[344px] rounded-lg p-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:hover:bg-transparent"
            >
              {!locked && (
                // Hidden from the name: it starts with what the button shows (the client), Change last.
                <span
                  aria-hidden
                  className="absolute top-3 right-3 text-caption text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {translate('change')}
                </span>
              )}
              <PartyLines party={client} />
              {!locked && <span className="sr-only">{translate('change')}</span>}
            </button>
          ) : (
            <button
              type="button"
              data-invalid={invalid || undefined}
              className="flex h-[92px] w-full max-w-[320px] items-center justify-center gap-2 rounded-xl border border-dashed border-border text-body text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground data-invalid:border-destructive/60 data-invalid:text-destructive"
            >
              <Plus className="size-4" />
              {translate('chooseAClient3')}
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] p-0">
          <ClientSearch
            selectedId={client?.id ?? null}
            onSelect={onPick}
            onCreate={() => {
              onOpenChange(false)
              setCreating(true)
            }}
          />
        </PopoverContent>
      </Popover>
      {creating && (
        <ClientForm
          onClose={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false)
            onPick(created)
          }}
        />
      )}
      {invalid && <span className="text-caption text-destructive">{missing}</span>}
      {client?.is_draft && (
        <Callout tone="warning" icon={CircleAlert} className="max-w-sm rounded-lg px-3 py-2">
          <span>
            {translate('theAddressIsIncompleteSoThisCanBeDrafted')}{' '}
            <ClientFixButton
              clientId={client.id}
              focus="address"
              className="font-medium underline underline-offset-4 hover:no-underline"
            >
              {translate('completeIt')}
            </ClientFixButton>
          </span>
        </Callout>
      )}
    </div>
  )
}

export function MetaLabel({
  htmlFor,
  error,
  tip,
  children,
}: {
  htmlFor: string
  error: string | undefined
  tip?: string
  children: string
}) {
  return (
    <dt className="flex h-8 items-center gap-1">
      <label htmlFor={htmlFor} className={cn('text-muted-foreground', error && 'text-destructive')}>
        {children}
      </label>
      {tip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={-1} // Tab goes field to field, not through every (?)
              aria-label={translate('about', { children: children })}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              <CircleHelp className="size-3.5 stroke-[1.75]" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{tip}</TooltipContent>
        </Tooltip>
      )}
    </dt>
  )
}

export function TotalLine({
  label,
  value,
  muted,
  failed,
}: {
  label: string
  value: string | null
  muted?: boolean
  /** The figure could not be loaded: a dash instead of a spinner. */
  failed?: boolean
}) {
  return (
    <div className={cn('flex justify-between gap-3', muted && 'text-muted-foreground')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {value ??
          (failed ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Loader className="inline-flex min-h-0 w-auto" />
          ))}
      </dd>
    </div>
  )
}
