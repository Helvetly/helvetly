'use client'
import { Button } from '@helvetly/ui/components/button'
import { Command, CommandInput, CommandItem, CommandList } from '@helvetly/ui/components/command'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  Check,
  ChevronsUpDown,
  LayoutTemplate,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'

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

type PickerItem = { id: string; name: string; hint: string }

function FillPicker({
  label,
  placeholder,
  icon: Icon,
  selected,
  options,
  onPick,
  error,
  search,
  empty,
}: {
  label: string
  placeholder: string
  icon: LucideIcon
  selected: PickerItem | null
  options: PickerItem[]
  onPick: (id: string) => void
  error?: string
  search?: { label: string; term: string; setTerm: (term: string) => void }
  empty: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const commandRef = useRef<HTMLDivElement>(null)

  return (
    <FormField
      id={id}
      label={label}
      labelNode={<span id={`${id}-label`}>{label}</span>}
      required
      error={error}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) search?.setTerm('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-labelledby={`${id}-label ${id}-value`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={cn(
              fieldSurface,
              'h-auto min-h-10 w-full cursor-pointer gap-2 rounded-lg px-2.5 py-1 text-left font-normal aria-invalid:border-destructive',
            )}
          >
            <span id={`${id}-value`} className="flex min-w-0 flex-1 items-center gap-2">
              {selected ? (
                <PickerRow icon={Icon} item={selected} />
              ) : (
                <span className="text-body">{placeholder}</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={label}
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onOpenAutoFocus={(event) => {
            if (search) return
            event.preventDefault()
            commandRef.current?.focus()
          }}
        >
          <Command ref={commandRef} shouldFilter={false} aria-label={label} tabIndex={-1}>
            {search && (
              <CommandInput
                aria-label={search.label}
                placeholder={search.label}
                value={search.term}
                onValueChange={search.setTerm}
              />
            )}
            <CommandList>
              {options.length === 0 && (
                <CommandItem
                  value="empty"
                  disabled
                  className="px-3 py-3 data-[disabled=true]:opacity-100"
                >
                  {empty}
                </CommandItem>
              )}
              {options.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  data-current={item.id === selected?.id ? 'true' : undefined}
                  className="mx-1 min-h-12 gap-3 rounded-lg px-2.5 py-1.5 data-[current=true]:bg-brand-solid/[0.08]"
                  onSelect={() => {
                    onPick(item.id)
                    setOpen(false)
                    search?.setTerm('')
                  }}
                >
                  <PickerRow icon={Icon} item={item} />
                  {item.id === selected?.id && <Check className="size-4 shrink-0 text-brand" />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FormField>
  )
}

function PickerRow({ icon: Icon, item }: { icon: LucideIcon; item: PickerItem }) {
  return (
    <>
      <Icon className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{item.name}</span>
        <span className="block truncate text-caption text-muted-foreground">{item.hint}</span>
      </span>
    </>
  )
}

function templateItem(template: Template): PickerItem {
  const signature = translate(template.signers.length ? 'asksForSignatures' : 'noSignatures')
  const used = template.last_used_at
    ? translate('used', { value1: formatRelative(template.last_used_at) })
    : ''
  return {
    id: template.id,
    name: template.name,
    hint: [signature, used].filter(Boolean).join(' · '),
  }
}

function clientItem(client: Client): PickerItem {
  return {
    id: client.id,
    name: client.name,
    hint: [`#${client.number}`, client.city, client.email].filter(Boolean).join(' · '),
  }
}

export function TemplatePicker({
  selected,
  onPick,
  error,
}: {
  selected: Template | null
  onPick: (template: Template) => void
  error?: string
}) {
  const list = useTemplates()
  const [term, setTerm] = useState('')
  const templates = pickableTemplates(list.data ?? [], term)

  return (
    <FillPicker
      label={translate('template2')}
      placeholder={translate('templateChoosePlaceholder')}
      icon={LayoutTemplate}
      selected={selected && templateItem(selected)}
      options={templates.map(templateItem)}
      onPick={(id) => {
        const template = templates.find((one) => one.id === id)
        if (template) onPick(template)
      }}
      error={error}
      search={
        (list.data?.length ?? 0) > 5
          ? { label: translate('searchTemplates'), term, setTerm }
          : undefined
      }
      empty={
        list.isPending
          ? translate('loading')
          : term
            ? translate('noTemplateMatches')
            : translate('noTemplatesYetMakeOneInDocumentsTemplates')
      }
    />
  )
}

export function ClientPicker({
  selected,
  onPick,
  error,
}: {
  selected: Client | null
  onPick: (client: Client) => void
  error?: string
}) {
  const [term, setTerm] = useState('')
  const search = useClientSearch(term)
  const matches = search.data?.data ?? []
  const clients =
    !term && selected && !matches.some((one) => one.id === selected.id)
      ? [selected, ...matches]
      : matches

  return (
    <FillPicker
      label={translate('client')}
      placeholder={translate('chooseAClient')}
      icon={Building2}
      selected={selected && clientItem(selected)}
      options={clients.map(clientItem)}
      onPick={(id) => {
        const client = clients.find((one) => one.id === id)
        if (client) onPick(client)
      }}
      error={error}
      search={{ label: translate('searchClients'), term, setTerm }}
      empty={search.isPending ? translate('searching') : translate('noClientMatches')}
    />
  )
}

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
