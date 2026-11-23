'use client'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Building2, Check, LayoutTemplate, Search, Sparkles, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { useClientSearch, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { FIELD_LABELS } from '@/lib/signatures'
import {
  DATA_LABELS,
  isDataKind,
  useTemplates,
  valueKey,
  type ContractDraft,
  type Template,
  type TemplateDraftField,
} from '@/lib/templates'

// The template fill flow's parts, shared by "New document from a template" and "Send for signature".

/** What a box says before a client fills it: the field's kind or label. */
export function templateCaption(field: TemplateDraftField) {
  if (field.kind === 'signature' || field.kind === 'date' || field.kind === 'name')
    return FIELD_LABELS[field.kind]
  if (field.kind === 'text') return field.label || translate('text')
  return field.kind === 'custom' ? field.label : DATA_LABELS[field.kind]
}

const pickRow =
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.04] aria-pressed:bg-brand-solid/[0.08]'

export function TemplatePicker({
  selected,
  onPick,
}: {
  selected: Template | null
  onPick: (template: Template) => void
}) {
  const list = useTemplates()
  const [term, setTerm] = useState('')
  const templates = pickableTemplates(list.data ?? [], term)
  return (
    <section className="grid gap-2">
      <h3 className="text-body-sm font-medium">{translate('template2')}</h3>
      {(list.data?.length ?? 0) > 5 && (
        <label
          data-field-surface
          className={cn(
            fieldSurface,
            'flex h-9 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground',
          )}
        >
          <Search className="size-4 shrink-0 stroke-[1.5]" />
          <input
            type="search"
            aria-label={translate('searchTemplates')}
            placeholder={translate('searchTemplates')}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-placeholder"
          />
        </label>
      )}
      <div
        aria-label={translate('templates')}
        className="grid max-h-64 overflow-y-auto rounded-xl border p-1"
      >
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-pressed={template.id === selected?.id}
            onClick={() => onPick(template)}
            className={pickRow}
          >
            <LayoutTemplate className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body">{template.name}</span>
              <span className="block truncate text-caption text-muted-foreground">
                {template.signers.length > 0
                  ? translate('asksForSignatures')
                  : translate('noSignatures')}
                {template.last_used_at &&
                  translate('used', { value1: formatRelative(template.last_used_at) })}
              </span>
            </span>
            {template.id === selected?.id && <Check className="size-4 text-brand" />}
          </button>
        ))}
        {templates.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
            {list.isPending
              ? translate('loading')
              : term
                ? translate('noTemplateMatches')
                : translate('noTemplatesYetMakeOneInDocumentsTemplates')}
          </p>
        )}
      </div>
    </section>
  )
}

export function ClientPicker({
  selected,
  onPick,
}: {
  selected: Client | null
  onPick: (client: Client) => void
}) {
  const [term, setTerm] = useState('')
  const search = useClientSearch(term)
  const clients = search.data?.data ?? []
  return (
    <section className="grid gap-2">
      <h3 className="text-body-sm font-medium">{translate('client')}</h3>
      <label
        data-field-surface
        className={cn(
          fieldSurface,
          'flex h-9 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground',
        )}
      >
        <Search className="size-4 shrink-0 stroke-[1.5]" />
        <input
          type="search"
          aria-label={translate('searchClients')}
          placeholder={translate('searchClients')}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-placeholder"
        />
      </label>
      <div
        aria-label={translate('clients')}
        className="grid max-h-64 overflow-y-auto rounded-xl border p-1"
      >
        {selected && !clients.some((client) => client.id === selected.id) && (
          <ClientRow client={selected} selected onPick={() => {}} />
        )}
        {clients.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            selected={client.id === selected?.id}
            onPick={() => onPick(client)}
          />
        ))}
        {clients.length === 0 && !selected && (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
            {search.isPending ? translate('searching') : translate('noClientMatches')}
          </p>
        )}
      </div>
    </section>
  )
}

function ClientRow({
  client,
  selected,
  onPick,
}: {
  client: Client
  selected: boolean
  onPick: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick} className={pickRow}>
      <Building2 className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{client.name}</span>
        <span className="block truncate text-caption text-muted-foreground">
          <span className="font-code">#{client.number}</span>
          {client.city && ` · ${client.city}`}
          {client.email && ` · ${client.email}`}
        </span>
      </span>
      {selected && <Check className="size-4 text-brand" />}
    </button>
  )
}

/** Templates matching the search, the most recently used first, then by name. */
export function pickableTemplates(templates: Template[], term: string) {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return templates
    .filter((template) => {
      const text = `${template.name} ${template.description ?? ''}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .toSorted(
      (a, b) =>
        (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '') || a.name.localeCompare(b.name),
    )
}

/** A field filled from the quote: a small sparkle, its source in a tooltip. */
function FilledMark({
  source,
  quoteNumber,
}: {
  source: 'quote' | 'ai'
  quoteNumber: string | null
}) {
  const text = translate(source === 'ai' ? 'filledByAIFromQuote' : 'filledFromQuote', {
    number: quoteNumber ?? translate('draft'),
  })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-source={source}
          className="inline-flex items-center gap-0.5 text-caption text-brand"
        >
          <Sparkles aria-label={text} className="size-3" />
          {source === 'ai' && <span aria-hidden>AI</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

const NO_SOURCES: ContractDraft['sources'] = {}

/** One input per kind of client data the template uses, and one per question it asks. */
export function ValueFields({
  template,
  values,
  sources = NO_SOURCES,
  quoteNumber = null,
  tried,
  onChange,
}: {
  template: Template
  values: Record<string, string>
  /** A contract's fields filled from its quote, by field id. */
  sources?: ContractDraft['sources']
  quoteNumber?: string | null
  tried: boolean
  onChange: (key: string, value: string) => void
}) {
  const entries = template.fields
    .filter((field) => isDataKind(field.kind))
    .filter(
      (field, index, all) =>
        all.findIndex((other) => valueKey(other) === valueKey(field)) === index,
    )
  if (entries.length === 0)
    return (
      <p className="text-body-sm text-muted-foreground">
        {translate('thisTemplateHasNoClientFieldsTheDocumentIs')}
      </p>
    )
  return (
    <div className="grid gap-4">
      {entries.map((field) => {
        const key = valueKey(field)
        const custom = field.kind === 'custom'
        const label = custom
          ? (field.label ?? translate('text'))
          : isDataKind(field.kind)
            ? DATA_LABELS[field.kind]
            : ''
        const value = values[key] ?? ''
        const source = sources[field.id]
        const id = `fill-${key.replace(/\W/g, '-')}`
        return (
          <FormField
            key={key}
            id={id}
            label={label}
            mark={
              custom && source ? (
                <FilledMark source={source} quoteNumber={quoteNumber} />
              ) : undefined
            }
            required={custom}
            error={custom && tried && !value.trim() ? translate('fillThisIn') : undefined}
            status={
              !custom && !value.trim() ? translate('theClientHasNoneTheBoxStaysEmpty') : undefined
            }
          >
            {field.kind === 'client.address' ? (
              <Textarea
                id={id}
                value={value}
                rows={2}
                onChange={(event) => onChange(key, event.target.value)}
              />
            ) : (
              <Input
                id={id}
                value={value}
                onChange={(event) => onChange(key, event.target.value)}
              />
            )}
          </FormField>
        )
      })}
    </div>
  )
}

/** One choice among a few, as a card: icon, label and a short line, the chosen one tinted. */
export function Choice({
  icon: Icon,
  label,
  text,
  badge,
  selected,
  disabled,
  onPick,
}: {
  icon: LucideIcon
  label: string
  text: string
  /** A short mark beside the label, e.g. "Recommended". */
  badge?: string
  selected: boolean
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-brand-solid/60 aria-pressed:bg-brand-solid/[0.06]',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-muted-foreground" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2 text-body font-medium">
          {label}
          {badge && (
            <span className="rounded-full bg-brand-solid/10 px-2 py-px text-caption font-medium text-brand">
              {badge}
            </span>
          )}
        </span>
        <span className="text-body-sm text-muted-foreground">{text}</span>
      </span>
      {selected && <Check className="mt-0.5 size-4 text-brand" />}
    </button>
  )
}
