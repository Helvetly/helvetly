'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatAmount } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { CircleCheck, FileText, ListChecks, TriangleAlert, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { FormSection } from '@/components/form-section'
import { DateField } from '@/components/invoices/date-fields'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  displayValue,
  recordChanges,
  usePatchImportRecord,
  type ImportKindConfig,
  type ImportRecord,
  type ImportSection,
} from '@/lib/imports'

import { clientFromDocument, ImportClientField } from './import-client-field'

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Keeps what an amount can hold (digits, separators, a sign), so letters never reach the record. */
export const amountInput = (typed: string) => typed.replace(/[^\d.,'’\s-]/g, '')

/**
 * A typed amount as a plain decimal ("1’234,5" → "1234.5"), or null when it is not one. The last of "." and ","
 * is the decimal mark when both appear; a lone "," is one when two digits or fewer follow it.
 */
export function normalizeAmount(typed: string): string | null {
  let text = typed.replace(/[\s'’]/g, '')
  const dot = text.lastIndexOf('.')
  const comma = text.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) {
    const mark = dot > comma ? '.' : ','
    text = text.replaceAll(mark === '.' ? ',' : '.', '').replace(mark, '.')
  } else if (comma >= 0)
    text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replaceAll(',', '')
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null
}

/** A date picked from the calendar; a value the model could not read as a date shows as "Choose a date". */
export function ImportDateField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  value: string
  error?: string
  onChange: (date: string) => void
}) {
  return (
    // The clear button sits inside the field, so dated and other fields keep one width.
    <div className="relative">
      <DateField
        id={id}
        label={label}
        value={CIVIL_DATE.test(value) ? value : ''}
        invalid={Boolean(error)}
        onChange={onChange}
        className={cn(
          'h-9 w-full border border-input bg-card px-3 text-sm shadow-xs data-invalid:border-destructive',
          value && 'pr-9',
        )}
      />
      {value && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              aria-label={`${translate('clearDate')}: ${label}`}
              onClick={() => onChange('')}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translate('clearDate')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * An amount with its currency picker beside it (one currency per record: picking it beside any amount changes it
 * for all). Shown as money ("22’222.00") until focused; typed as plain digits.
 */
export function ImportAmountField({
  id,
  value,
  currency,
  error,
  onChange,
  onCurrency,
}: {
  id: string
  value: string
  currency: string
  error?: string
  onChange: (amount: string) => void
  onCurrency: (code: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const amount = normalizeAmount(value)
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <Combobox
        id={`${id}-currency`}
        label={translate('currency')}
        value={currency}
        options={CURRENCY_OPTIONS}
        renderValue={(option) => option.value}
        placeholder={translate('chooseACurrency2')}
        onChange={onCurrency}
      />
      <input
        {...describedBy(id, error)}
        inputMode="decimal"
        placeholder="0.00"
        value={editing || amount === null ? value : formatAmount(amount)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false)
          if (amount !== null && amount !== value) onChange(amount)
        }}
        onChange={(event) => onChange(amountInput(event.target.value))}
        className={cn(inputClass, 'text-right tabular-nums')}
      />
    </div>
  )
}

/** A small rounded label in the editor's header. */
export function HeaderBadge({
  tone,
  children,
}: {
  tone?: 'warning' | 'success'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ring-1 ring-inset [&_svg]:size-3 [&_svg]:shrink-0',
        tone === 'warning'
          ? 'bg-warning-surface text-warning ring-warning-border'
          : tone === 'success'
            ? 'bg-success-surface text-success ring-success/20'
            : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      {children}
    </span>
  )
}

/** The kind's sections, with every editable field no section names gathered in a last one. */
function sectionsOf(config: ImportKindConfig): ImportSection[] {
  const named = config.sections ?? []
  const placed = new Set(named.flatMap((section) => section.fields))
  const rest = config.editable.filter((field) => !placed.has(field))
  return rest.length
    ? [
        ...named,
        {
          title: translate('details'),
          description: translate('importSectionDetailsText'),
          icon: ListChecks,
          fields: rest,
        },
      ]
    : named
}

/**
 * Fixes one record in a second drawer over the import one, so closing it lands back on the list;
 * saving re-checks the record on the server.
 */
export function EditRecordDrawer({
  config,
  batchId,
  record,
  name,
  fileName,
  onDone,
}: {
  config: ImportKindConfig
  batchId: string
  record: ImportRecord
  name: string
  /** The file the record was read from. */
  fileName?: string
  onDone: (record: ImportRecord | null) => void
}) {
  const patch = usePatchImportRecord(batchId)
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      [...config.editable, ...(config.pickClient ? ['client_name'] : [])].map((field) => [
        field,
        displayValue(record.data[field]),
      ]),
    ),
  )
  const set = (field: string, value: string) =>
    setValues((current) => ({ ...current, [field]: value }))
  const issues = Object.entries(record.issues)
  const toggles = config.toggles ?? []
  const dates = config.dates ?? []
  const amounts = config.amounts ?? {}
  const currencies = new Set(Object.values(amounts))
  const required = new Set(config.required?.(values) ?? [])
  const fieldId = (field: string) => `import-${record.id}-${field}`
  const labelOf = (field: string) => config.labels?.[field] ?? config.fields[field] ?? field
  const save = () => {
    if (patch.isPending) return
    const changes = recordChanges(record.data, values, toggles)
    if (!Object.keys(changes).length) return onDone(null)
    patch.mutate(
      { recordId: record.id, data: changes },
      { onSuccess: (saved) => !Object.keys(saved.issues).length && onDone(saved) },
    )
  }

  const fieldFor = (field: string) => {
    const id = fieldId(field)
    const error = record.issues[field]
    const label = labelOf(field)
    if (config.pickClient && field === 'client_id')
      return (
        <ImportClientField
          key={field}
          id={id}
          clientId={values.client_id ?? ''}
          clientName={values.client_name ?? ''}
          found={clientFromDocument(record.data)}
          error={error}
          onPick={(client) =>
            setValues((current) => ({
              ...current,
              client_id: client.id,
              client_name: client.name,
            }))
          }
        />
      )
    if (toggles.includes(field))
      return (
        <SwitchRow
          key={field}
          id={id}
          label={label}
          description={config.tips?.[field]}
          checked={values[field] === translate('yes')}
          onCheckedChange={(on) => set(field, on ? translate('yes') : translate('no4'))}
          className="sm:col-span-2"
        />
      )
    // A record's currency is picked beside its amounts.
    if (currencies.has(field)) return null
    const currencyField = amounts[field]
    return (
      <FormField
        key={field}
        id={id}
        label={label}
        error={error ?? (currencyField ? record.issues[currencyField] : undefined)}
        tip={config.tips?.[field]}
        required={
          required.has(field) || (currencyField !== undefined && required.has(currencyField))
        }
      >
        {dates.includes(field) ? (
          <ImportDateField
            id={id}
            label={label}
            value={values[field] ?? ''}
            error={error}
            onChange={(date) => set(field, date)}
          />
        ) : currencyField ? (
          <ImportAmountField
            id={id}
            value={values[field] ?? ''}
            currency={values[currencyField] ?? ''}
            error={error ?? record.issues[currencyField]}
            onChange={(amount) => set(field, amount)}
            onCurrency={(code) => set(currencyField, code)}
          />
        ) : (
          <input
            {...describedBy(id, error)}
            value={values[field] ?? ''}
            onChange={(event) => set(field, event.target.value)}
            className={inputClass}
          />
        )}
      </FormField>
    )
  }

  return (
    <Sheet open onOpenChange={(next) => !next && onDone(null)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(880px,calc(100vw-4rem))]! dark:bg-card"
      >
        <form
          noValidate
          aria-label={translate('editRecord')}
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-8">
            <div className="grid min-w-0 gap-1.5">
              {/* Inner spans: the sheet's own title and description classes would override these sizes. */}
              <SheetTitle>
                <span className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
                  {translate('editRecord')}
                </span>
              </SheetTitle>
              <p className="truncate text-title font-semibold">{name}</p>
              <SheetDescription className="sr-only">{name}</SheetDescription>
              <div className="flex flex-wrap items-center gap-1.5">
                {config.noun && <HeaderBadge>{config.noun}</HeaderBadge>}
                {fileName && (
                  <HeaderBadge>
                    <FileText aria-hidden />
                    <span className="truncate">{fileName}</span>
                  </HeaderBadge>
                )}
                {issues.length > 0 ? (
                  <HeaderBadge tone="warning">
                    <TriangleAlert aria-hidden />
                    {translate('importFieldsToFix', { count: issues.length })}
                  </HeaderBadge>
                ) : (
                  <HeaderBadge tone="success">
                    <CircleCheck aria-hidden />
                    {translate('importReadyBadge')}
                  </HeaderBadge>
                )}
                {record.duplicate && (
                  <HeaderBadge tone="warning">{translate('importPossibleDuplicate')}</HeaderBadge>
                )}
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('close')}
                  onClick={() => onDone(null)}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('close')}</TooltipContent>
            </Tooltip>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-3 px-5 pt-6 md:px-8">
              {issues.length > 0 ? (
                <Callout
                  tone="warning"
                  title={translate('importFixBeforeImport', { count: issues.length })}
                >
                  <ul className="grid gap-1">
                    {issues.map(([field, message]) => (
                      <li key={field}>
                        <button
                          type="button"
                          onClick={() => document.getElementById(fieldId(field))?.focus()}
                          className="text-left underline-offset-2 hover:underline"
                        >
                          <span className="font-medium">{labelOf(field)}</span>
                          <span className="text-muted-foreground">: {message}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Callout>
              ) : (
                <Callout tone="success">{translate('importRecordLooksGood')}</Callout>
              )}
              {record.duplicate && (
                <Callout tone="warning">
                  {translate('possibleDuplicate')}
                  {record.duplicate.label} ({record.duplicate.reason}).
                </Callout>
              )}
              {patch.error && (
                <p role="alert" className="text-caption text-destructive">
                  {errorMessage(patch.error)}
                </p>
              )}
            </div>
            {sectionsOf(config).map((section) => (
              <FormSection
                key={section.title}
                icon={section.icon}
                title={section.title}
                description={section.description}
              >
                <div className="grid gap-4 sm:grid-cols-2">{section.fields.map(fieldFor)}</div>
              </FormSection>
            ))}
          </div>

          <footer className="flex min-h-14 shrink-0 items-center justify-end gap-2 border-t px-5 py-2.5 md:px-8">
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={patch.isPending}>
              {translate('save2')}
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  )
}
