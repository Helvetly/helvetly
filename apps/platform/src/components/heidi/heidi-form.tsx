'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@helvetly/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, ChevronsUpDown, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { handOffImport } from '@/components/import/hand-off'
import { useClientSearch } from '@/lib/clients'
import type { HeidiField, HeidiForm } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { IMPORT_KINDS, importKindByLabel } from '@/lib/imports'
import { DEFAULT_PARAMS, useInvoiceList } from '@/lib/invoices'

type Values = Record<string, string[]>

/** "Label: value" lines, the way a filled-in form is sent to Heidi (and read back). */
export function formAnswer(form: HeidiForm, values: Values) {
  return form.fields
    .filter((field) => values[field.name]?.length)
    .map((field) => `${field.label}: ${values[field.name]?.join(', ')}`)
    .join('\n')
}

function parseAnswer(form: HeidiForm, answer: string): Values {
  const values: Values = {}
  for (const line of answer.split('\n')) {
    const field = form.fields.find((entry) => line.startsWith(`${entry.label}: `))
    if (field) values[field.name] = line.slice(field.label.length + 2).split(', ')
  }
  return values
}

const pill =
  'h-8 rounded-full px-3 text-[13.5px] shadow-elevation-1 transition-[background-color,color,box-shadow] duration-150 enabled:hover:bg-muted aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:shadow-none disabled:opacity-60 bg-card'

function Choice({
  field,
  value,
  locked,
  onChange,
}: {
  field: Extract<HeidiField, { kind: 'choice' | 'multichoice' }>
  value: string[]
  locked: boolean
  onChange: (value: string[]) => void
}) {
  const many = field.kind === 'multichoice'
  return (
    <div
      role={many ? 'group' : 'radiogroup'}
      aria-label={field.label}
      className="flex flex-wrap gap-1.5"
    >
      {field.options.map((option) => {
        const checked = value.includes(option)
        return (
          <button
            key={option}
            type="button"
            role={many ? 'checkbox' : 'radio'}
            aria-checked={checked}
            disabled={locked}
            className={pill}
            onClick={() =>
              onChange(
                many
                  ? checked
                    ? value.filter((entry) => entry !== option)
                    : [...value, option]
                  : [option],
              )
            }
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function RecordPicker({
  field,
  value,
  locked,
  onChange,
}: {
  field: Extract<HeidiField, { kind: 'record' }>
  value: string[]
  locked: boolean
  onChange: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  // Clients are searched on the server as you type, so a picker is never capped at a page.
  const clients = useClientSearch(term, open && field.record === 'client')
  const invoices = useInvoiceList({ ...DEFAULT_PARAMS, search: term })
  const options =
    field.record === 'client'
      ? (clients.data?.data ?? []).map((client) => `${client.name} · #${client.number}`)
      : (invoices.data?.data ?? []).map(
          (invoice) => `${invoice.number ?? translate('draft')} · ${invoice.client.name}`,
        )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="lg"
          variant="outline"
          disabled={locked}
          aria-label={field.label}
          className="w-full justify-between bg-card font-normal shadow-elevation-1"
        >
          <span className={cn('truncate', !value[0] && 'text-muted-foreground')}>
            {value[0] ?? translate('chooseA', { record: field.record })}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput
            placeholder={translate('searchS', { record: field.record })}
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            <CommandEmpty>{translate('nothingFound')}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option}
                onSelect={() => {
                  onChange([option])
                  setOpen(false)
                }}
              >
                <Check className={cn(value[0] === option ? 'opacity-100' : 'opacity-0')} />
                {option}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function FileDrop({
  field,
  value,
  locked,
  onFiles,
}: {
  field: Extract<HeidiField, { kind: 'file' }>
  value: string[]
  locked: boolean
  onFiles: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)
  // The file input covers the zone, so dropping a file on it is the browser's own behaviour.
  return (
    <div
      data-over={over || undefined}
      className={cn(
        'relative flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-card/60 px-4 py-5 text-center text-[13px] text-muted-foreground transition-colors duration-150 has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-heidi data-over:bg-heidi-soft/40',
        locked && 'opacity-70',
      )}
    >
      <Upload className="size-4 stroke-[1.5]" />
      {value.length ? (
        <span className="text-foreground">{value.join(', ')}</span>
      ) : (
        <span>{translate('dropAFileHereOrClickToChoose')}</span>
      )}
      <input
        type="file"
        aria-label={field.label}
        accept={field.accept.join(',')}
        disabled={locked}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        onChange={(event) => onFiles([...(event.target.files ?? [])])}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  )
}

/** A question inside an answer. Once answered (or superseded) it shows the answer and locks. */
export function HeidiFormView({
  form,
  answer,
  disabled,
  attachments,
  onSubmit,
}: {
  form: HeidiForm
  /** The message that answered it, if any. */
  answer?: string
  disabled: boolean
  /** The files attached to the question this form answers; an import form hands them over. */
  attachments?: File[]
  onSubmit: (text: string, files: File[]) => void
}) {
  const router = useRouter()
  const [values, setValues] = useState<Values>({})
  const [files, setFiles] = useState<File[]>([])
  const locked = answer !== undefined
  const shown = locked ? parseAnswer(form, answer) : values
  const set = (name: string, value: string[]) =>
    setValues((current) => ({ ...current, [name]: value }))
  const filled = Object.values(values).some((value) => value.length)

  return (
    <form
      aria-label={form.question}
      className="mt-3 grid gap-4 rounded-xl bg-muted/50 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (locked || !filled) return
        onSubmit(formAnswer(form, values), files)
        // "Import as: Clients" opens that page's import drawer with the files from this turn.
        const choice = form.fields.find((field) => field.kind === 'choice')
        const kind =
          form.intent === 'import' && choice
            ? importKindByLabel(values[choice.name]?.[0] ?? '')
            : null
        if (kind) {
          handOffImport(kind, attachments ?? [])
          router.push(`${IMPORT_KINDS[kind].path}?import=1`)
        }
      }}
    >
      <p className="text-[14px]">{form.question}</p>
      {form.fields.map((field) => (
        <div key={field.name} className="grid gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">{field.label}</span>
          {field.kind === 'record' ? (
            <RecordPicker
              field={field}
              value={shown[field.name] ?? []}
              locked={locked}
              onChange={(value) => set(field.name, value)}
            />
          ) : field.kind === 'file' ? (
            <FileDrop
              field={field}
              value={shown[field.name] ?? []}
              locked={locked}
              onFiles={(picked) => {
                setFiles(picked)
                set(
                  field.name,
                  picked.map((file) => file.name),
                )
              }}
            />
          ) : (
            <Choice
              field={field}
              value={shown[field.name] ?? []}
              locked={locked}
              onChange={(value) => set(field.name, value)}
            />
          )}
        </div>
      ))}
      {locked ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Check className="size-3.5" />
          {translate('answered')}
        </p>
      ) : (
        <Button type="submit" className="w-fit" disabled={disabled || !filled}>
          {translate('continue')}
        </Button>
      )}
    </form>
  )
}
