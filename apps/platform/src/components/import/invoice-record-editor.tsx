'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Switch } from '@helvetly/ui/components/switch'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Banknote,
  CalendarClock,
  CircleCheck,
  FileText,
  ListOrdered,
  Plus,
  TriangleAlert,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState, type ReactNode } from 'react'

import { inputClass } from '@/components/clients/fields'
import { isBlankLine, newLine, type EditorLine } from '@/components/invoices/editor-model'
import { LinesEditor } from '@/components/invoices/lines-editor'
import { PdfView } from '@/components/invoices/pdf-view'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  displayValue,
  recordChanges,
  usePatchImportRecord,
  type ImportKindConfig,
  type ImportLine,
  type ImportRecord,
  type RecordChanges,
} from '@/lib/imports'
import {
  today as todayDate,
  UNITS,
  useInvoicePreview,
  useInvoiceSettings,
  VAT_CATEGORIES,
  type InvoiceInput,
  type InvoiceSettings,
  type Unit,
  type VatCategory,
  type VatMode,
} from '@/lib/invoices'

import { clientFromDocument, ImportClientField } from './import-client-field'
import {
  HeaderBadge,
  ImportAmountField,
  ImportDateField,
  normalizeAmount,
} from './import-edit-drawer'

/** The record's scalar fields this editor changes; lines and instalments are lists, sent whole. */
const SCALARS = [
  'client_id',
  'client_name',
  'number',
  'reference',
  'contract_reference',
  'issue_date',
  'due_date',
  'service_date',
  'service_date_end',
  'currency',
  'total',
  'discount_percent',
  'issued_elsewhere',
  'paid_amount',
  'paid_on',
]

/** `key` stays put while rows are added and removed; it is never sent. */
type Instalment = { key: string; due_date: string; amount: string; paid: boolean; paid_on: string }

let instalmentKeys = 0
const instalmentKey = () => `instalment-${++instalmentKeys}`

const text = (row: ImportLine, field: string) => {
  const value = row[field]
  return value === undefined || typeof value === 'boolean' ? '' : String(value)
}
const rowsOf = (value: ImportRecord['data'][string] | undefined) =>
  Array.isArray(value) ? value : []

/** The document's lines as the invoice editor's rows; what the AI left out falls back to the workspace's VAT. */
export function editorLinesOf(
  data: ImportRecord['data'],
  vatMode: VatMode,
  defaultRate: string,
): EditorLine[] {
  return rowsOf(data.lines).map((row) => {
    const unit = text(row, 'unit')
    const category = text(row, 'vat_category')
    const known = VAT_CATEGORIES.some((option) => option.value === category)
    return {
      ...newLine({ vat_mode: vatMode }, defaultRate),
      description: text(row, 'description'),
      quantity: text(row, 'quantity') || '1',
      unit: UNITS.some((option) => option.value === unit) ? (unit as Unit) : null,
      unit_price: text(row, 'unit_price'),
      discount_percent: text(row, 'discount_percent'),
      ...(known && vatMode !== 'none' && { vat_category: category as VatCategory }),
      ...(vatMode !== 'none' && text(row, 'vat_rate') && { vat_rate: text(row, 'vat_rate') }),
    }
  })
}

/** The editor's rows as the record's lines: only the fields the import reads, empty ones left out. */
export function importLinesOf(lines: EditorLine[]): Record<string, string | null>[] {
  return lines
    .filter((line) => !isBlankLine(line))
    .map((line) => ({
      description: line.description.trim() || null,
      quantity: line.quantity.trim() || null,
      unit: line.unit,
      unit_price: normalizeAmount(line.unit_price) ?? (line.unit_price.trim() || null),
      discount_percent: line.discount_percent.trim() || null,
      vat_category: line.vat_category,
      vat_rate: line.vat_rate.trim() || null,
    }))
}

/**
 * The document's instalments. An instalment already past due is history: paid on its due date, as the import counts
 * it too (unless the document says otherwise with a date of its own).
 */
export const instalmentsOf = (data: ImportRecord['data'], today: string): Instalment[] =>
  rowsOf(data.instalments).map((row) => {
    const due = text(row, 'due_date')
    const past = due !== '' && due < today
    return {
      key: instalmentKey(),
      due_date: due,
      amount: text(row, 'amount'),
      paid: row.paid === true || past,
      paid_on: text(row, 'paid_on') || (past ? due : ''),
    }
  })

const importInstalmentsOf = (rows: Instalment[]) =>
  rows
    .filter((row) => row.amount.trim() || row.due_date)
    .map((row) => ({
      due_date: row.due_date || null,
      amount: normalizeAmount(row.amount) ?? (row.amount.trim() || null),
      paid: row.paid,
      paid_on: row.paid ? row.paid_on || null : null,
    }))

/** Waits `ms` after the last change before passing a value on (the totals are asked of the server). */
function useSettled<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** A titled part of the editor: icon, name and one line of what it holds, then its fields. */
function Block({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="grid gap-4 border-t px-5 py-6 first:border-t-0 md:px-8">
      <header className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-surface text-brand">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="grid gap-0.5">
          <h3 className="text-title-sm font-semibold">{title}</h3>
          <span className="text-caption text-muted-foreground">{description}</span>
        </span>
      </header>
      {children}
    </section>
  )
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/** The uploaded original beside the editor: a PDF in the viewer, zoomed and scrolled at will; a photo as it is. */
function Original({ src, name }: { src: string; name: string }) {
  const pdf = /\.pdf$/i.test(name)
  const image = /\.(png|jpe?g|webp)$/i.test(name)
  const [zoom, setZoom] = useState(1)
  const at = ZOOMS.indexOf(zoom)
  const zoomButton = (label: string, icon: ReactNode, next: number | undefined) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={next === undefined}
          onClick={() => next !== undefined && setZoom(next)}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
  return (
    <aside
      aria-label={translate('importOriginal')}
      className="hidden min-h-0 flex-col border-r bg-muted/50 lg:flex dark:bg-background"
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-card py-1.5 pr-2 pl-4">
        <FileText aria-hidden className="size-3.5 text-muted-foreground" />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-caption font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {name}
        </a>
        {pdf && (
          <div className="flex items-center gap-0.5">
            {zoomButton(translate('importZoomOut'), <ZoomOut />, ZOOMS[at - 1])}
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="w-12 rounded-sm text-center text-caption text-muted-foreground tabular-nums hover:text-foreground"
              aria-label={translate('importZoomFit')}
            >
              {Math.round(zoom * 100)}%
            </button>
            {zoomButton(translate('importZoomIn'), <ZoomIn />, ZOOMS[at + 1])}
          </div>
        )}
      </div>
      {pdf ? (
        <PdfView src={src} title={name} zoom={zoom} className="min-h-0 flex-1" />
      ) : image ? (
        <div className="relative min-h-0 flex-1">
          <Image
            src={src}
            alt={name}
            fill
            unoptimized
            sizes="50vw"
            className="object-contain p-4"
          />
        </div>
      ) : (
        <p className="p-4 text-caption text-muted-foreground">{translate('importNoPreview')}</p>
      )}
    </aside>
  )
}

/**
 * An imported invoice, edited the way the invoice editor edits one: client, number and dates, its lines with
 * discounts and VAT, the totals worked out by the server, and what was already paid, beside the uploaded original.
 * Nothing is issued or generated here: saving re-checks the record, and Import keeps the file as the invoice.
 */
type EditorProps = {
  config: ImportKindConfig
  batchId: string
  record: ImportRecord
  name: string
  fileName?: string
  /** Where the uploaded original is read from. */
  fileSrc?: string
  onDone: (record: ImportRecord | null) => void
}

export function InvoiceRecordEditor(props: EditorProps) {
  const settings = useInvoiceSettings().data
  // The rows start from the workspace's VAT settings, so the form waits for them (they are almost always cached).
  return settings ? <InvoiceRecordForm {...props} settings={settings} /> : null
}

function InvoiceRecordForm({
  config,
  batchId,
  record,
  name,
  fileName,
  fileSrc,
  onDone,
  settings,
}: EditorProps & { settings: InvoiceSettings }) {
  const vatMode: VatMode = !settings.vat_registered
    ? 'none'
    : displayValue(record.data.price_basis) === 'gross'
      ? 'inclusive'
      : displayValue(record.data.price_basis) === 'net'
        ? 'exclusive'
        : (settings.default_vat_mode ?? 'exclusive')
  const defaultRate = settings.default_vat_rate
  const patch = usePatchImportRecord(batchId)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const read: Record<string, string> = Object.fromEntries(
      SCALARS.map((field) => [field, displayValue(record.data[field])]),
    )
    const due = read.due_date || read.issue_date
    // History, as the import counts it: past due and nothing said about payment means paid in full on the due date.
    return read.issued_elsewhere === translate('yes') &&
      !read.paid_amount &&
      !rowsOf(record.data.instalments).length &&
      due &&
      due < todayDate()
      ? { ...read, paid_amount: read.total ?? '', paid_on: due }
      : read
  })
  const [mode, setMode] = useState<VatMode>(vatMode)
  const [lines, setLines] = useState(() => editorLinesOf(record.data, vatMode, defaultRate))
  const [instalments, setInstalments] = useState(() => instalmentsOf(record.data, todayDate()))
  const set = (field: string, value: string) =>
    setValues((current) => ({ ...current, [field]: value }))
  const issues = Object.entries(record.issues)
  const required = new Set(config.required?.(values) ?? [])
  const fieldId = (field: string) => `import-${record.id}-${field}`
  const labelOf = (field: string) => config.labels?.[field] ?? config.fields[field] ?? field
  const currency = values.currency ?? ''
  const issued = values.issued_elsewhere === translate('yes')

  const filled = lines.filter((line) => !isBlankLine(line))
  const input = useSettled<Partial<InvoiceInput> | null>(
    filled.length && currency
      ? {
          ...(values.client_id && { client_id: values.client_id }),
          ...(values.issue_date && { issue_date: values.issue_date }),
          currency,
          vat_mode: mode,
          discount_percent: values.discount_percent?.trim() || '0',
          lines: filled.map((line) => ({
            description: line.description,
            quantity: line.quantity.trim() || '0',
            unit: line.unit,
            unit_price: normalizeAmount(line.unit_price) ?? '0',
            discount_percent: line.discount_percent.trim() || '0',
            vat_category: line.vat_category,
            vat_rate: line.vat_rate.trim() || '0',
            vat_exemption_code: line.vat_exemption_code,
            vat_exemption_reason: line.vat_exemption_reason || null,
          })),
        }
      : null,
  )
  const preview = useInvoicePreview(input)
  const totals = preview.data
  // The preview's amounts follow the filled rows; blank rows get none.
  const filledKeys = filled.map((line) => line.key)
  const amounts = totals
    ? lines.map((line) => totals.lines[filledKeys.indexOf(line.key)]?.amount ?? '')
    : undefined
  const stated = normalizeAmount(values.total ?? '')
  const mismatch = totals && stated !== null && Number(stated) !== Number(totals.payable_total)
  // A printed total below the lines with no invoice discount read: the discount the model missed, in percent.
  const suggested =
    mismatch && !values.discount_percent?.trim() && Number(stated) < Number(totals.payable_total)
      ? String(Math.round((1 - Number(stated) / Number(totals.payable_total)) * 10000) / 100)
      : null

  const save = () => {
    if (patch.isPending) return
    const changes: RecordChanges = recordChanges(record.data, values, config.toggles ?? [])
    const nextLines = importLinesOf(lines)
    if (
      JSON.stringify(nextLines) !==
      JSON.stringify(importLinesOf(editorLinesOf(record.data, vatMode, defaultRate)))
    )
      changes.lines = nextLines
    const nextInstalments = importInstalmentsOf(instalments)
    if (
      JSON.stringify(nextInstalments) !==
      JSON.stringify(importInstalmentsOf(instalmentsOf(record.data, todayDate())))
    )
      changes.instalments = nextInstalments
    if (mode !== vatMode && mode !== 'none')
      changes.price_basis = mode === 'inclusive' ? 'gross' : 'net'
    if (!Object.keys(changes).length) return onDone(null)
    patch.mutate(
      { recordId: record.id, data: changes },
      { onSuccess: (saved) => !Object.keys(saved.issues).length && onDone(saved) },
    )
  }

  const field = (key: string, control: ReactNode, className?: string) => (
    <FormField
      id={fieldId(key)}
      label={labelOf(key)}
      error={record.issues[key]}
      tip={config.tips?.[key]}
      required={required.has(key)}
      className={className}
    >
      {control}
    </FormField>
  )
  const textField = (key: string) =>
    field(
      key,
      <input
        {...describedBy(fieldId(key), record.issues[key])}
        value={values[key] ?? ''}
        onChange={(event) => set(key, event.target.value)}
        className={inputClass}
      />,
    )
  const dateField = (key: string) =>
    field(
      key,
      <ImportDateField
        id={fieldId(key)}
        label={labelOf(key)}
        value={values[key] ?? ''}
        error={record.issues[key]}
        onChange={(date) => set(key, date)}
      />,
    )

  return (
    <Sheet open onOpenChange={(next) => !next && onDone(null)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(1440px,calc(100vw-4rem))]! dark:bg-card"
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
          <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-3 md:px-8">
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-baseline gap-2">
                {/* Inner spans: the sheet's own title and description classes would override these sizes. */}
                <SheetTitle className="shrink-0">
                  <span className="text-caption font-medium text-muted-foreground">
                    {translate('editRecord')}
                  </span>
                </SheetTitle>
                <p className="truncate text-body font-semibold">{name}</p>
                <SheetDescription className="sr-only">{name}</SheetDescription>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {config.noun && <HeaderBadge>{config.noun}</HeaderBadge>}
                {fileName && (
                  <HeaderBadge>
                    <FileText aria-hidden />
                    <span className="truncate">{fileName}</span>
                  </HeaderBadge>
                )}
                {issued && <HeaderBadge>{translate('alreadyIssued')}</HeaderBadge>}
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

          <div
            className={cn(
              'grid min-h-0 flex-1',
              fileSrc && fileName && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
            )}
          >
            {fileSrc && fileName && <Original src={fileSrc} name={fileName} />}
            <div className="min-h-0 overflow-y-auto">
              <div className="grid gap-3 px-5 pt-6 pb-6 md:px-8">
                {issues.length > 0 ? (
                  <Callout
                    tone="warning"
                    title={translate('importFixBeforeImport', { count: issues.length })}
                  >
                    <ul className="grid gap-1">
                      {issues.map(([key, message]) => (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() =>
                              document.getElementById(fieldId(key.split('.')[0] ?? key))?.focus()
                            }
                            className="text-left underline-offset-2 hover:underline"
                          >
                            <span className="font-medium">{labelOf(key.split('.')[0] ?? key)}</span>
                            <span className="text-muted-foreground">: {message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Callout>
                ) : (
                  <Callout tone="success">{translate('importRecordLooksGood')}</Callout>
                )}
                {patch.error && (
                  <p role="alert" className="text-caption text-destructive">
                    {errorMessage(patch.error)}
                  </p>
                )}
              </div>

              <Block
                icon={UserRound}
                title={translate('client')}
                description={translate('importSectionClientText')}
              >
                <ImportClientField
                  id={fieldId('client_id')}
                  clientId={values.client_id ?? ''}
                  clientName={values.client_name ?? ''}
                  found={clientFromDocument(record.data)}
                  error={record.issues.client_id}
                  onPick={(client) =>
                    setValues((current) => ({
                      ...current,
                      client_id: client.id,
                      client_name: client.name,
                    }))
                  }
                />
              </Block>

              <Block
                icon={FileText}
                title={translate('importNounInvoice')}
                description={translate('importSectionInvoiceText')}
              >
                <SwitchRow
                  id={fieldId('issued_elsewhere')}
                  label={labelOf('issued_elsewhere')}
                  description={config.tips?.issued_elsewhere}
                  checked={issued}
                  onCheckedChange={(on) =>
                    set('issued_elsewhere', on ? translate('yes') : translate('no4'))
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  {textField('number')}
                  {textField('reference')}
                  {textField('contract_reference')}
                  {dateField('issue_date')}
                  {dateField('due_date')}
                  {dateField('service_date')}
                  {dateField('service_date_end')}
                </div>
              </Block>

              <Block
                icon={ListOrdered}
                title={translate('importSectionLines')}
                description={translate('importSectionLinesText')}
              >
                {settings.vat_registered && (
                  <Segmented
                    label={translate('priceBasis')}
                    value={mode}
                    options={[
                      { value: 'exclusive', label: translate('exclVAT') },
                      { value: 'inclusive', label: translate('inclVAT') },
                    ]}
                    onChange={(next) => setMode(next)}
                  />
                )}
                <LinesEditor
                  lines={lines}
                  vatMode={mode}
                  defaultRate={defaultRate}
                  amounts={amounts}
                  errors={{}}
                  onChange={setLines}
                  currency={currency}
                />
                {record.issues.lines && (
                  <p role="alert" className="text-caption text-destructive">
                    {record.issues.lines}
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {field(
                    'discount_percent',
                    <input
                      {...describedBy(fieldId('discount_percent'), record.issues.discount_percent)}
                      inputMode="decimal"
                      placeholder="0"
                      value={values.discount_percent ?? ''}
                      onChange={(event) =>
                        set('discount_percent', event.target.value.replace(/[^\d.,]/g, ''))
                      }
                      className={cn(inputClass, 'text-right tabular-nums')}
                    />,
                  )}
                  <dl className="grid content-start gap-1 rounded-lg bg-muted/40 p-3 text-body-sm">
                    {totals ? (
                      <>
                        <Total
                          label={translate('importNetTotal')}
                          value={formatMoney(totals.net_total, currency)}
                        />
                        <Total
                          label={translate('vat')}
                          value={formatMoney(totals.vat_total, currency)}
                        />
                        <Total
                          strong
                          label={translate('importTotalAmount')}
                          value={formatMoney(totals.payable_total, currency)}
                        />
                      </>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        {translate('importTotalsWaitForLines')}
                      </p>
                    )}
                  </dl>
                </div>
              </Block>

              <Block
                icon={Banknote}
                title={translate('importSectionAmounts')}
                description={translate('importSectionPaymentsText')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {field(
                    'total',
                    <ImportAmountField
                      id={fieldId('total')}
                      value={values.total ?? ''}
                      currency={currency}
                      error={record.issues.total ?? record.issues.currency}
                      onChange={(amount) => set('total', amount)}
                      onCurrency={(code) => set('currency', code)}
                    />,
                  )}
                </div>
                {mismatch && (
                  <Callout
                    tone="warning"
                    actions={
                      suggested && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => set('discount_percent', suggested)}
                        >
                          {translate('importApplyDiscount', { percent: suggested })}
                        </Button>
                      )
                    }
                  >
                    {translate('importTotalDiffers', {
                      lines: formatMoney(totals.payable_total, currency),
                    })}
                    {suggested && ` ${translate('importDiscountExplains', { percent: suggested })}`}
                  </Callout>
                )}
                {instalments.length > 0 ? (
                  <p className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-body-sm">
                    <CalendarClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    {translate('importPaidByInstalments', {
                      paid: formatMoney(
                        instalments
                          .filter((row) => row.paid)
                          .reduce((sum, row) => sum + Number(normalizeAmount(row.amount) ?? 0), 0)
                          .toFixed(2),
                        currency,
                      ),
                      count: instalments.filter((row) => row.paid).length,
                      total: instalments.length,
                    })}
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field(
                      'paid_amount',
                      <ImportAmountField
                        id={fieldId('paid_amount')}
                        value={values.paid_amount ?? ''}
                        currency={currency}
                        error={record.issues.paid_amount}
                        onChange={(amount) => set('paid_amount', amount)}
                        onCurrency={(code) => set('currency', code)}
                      />,
                    )}
                    {dateField('paid_on')}
                  </div>
                )}
              </Block>

              <Block
                icon={CalendarClock}
                title={translate('importInstalments')}
                description={translate('importSectionInstalmentsText')}
              >
                <InstalmentRows
                  rows={instalments}
                  currency={currency}
                  error={record.issues.instalments}
                  onChange={setInstalments}
                />
              </Block>
            </div>
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

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'border-t pt-1.5 font-semibold')}>
      <dt className={cn(!strong && 'text-muted-foreground')}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

/** The payment schedule printed on the invoice, as a table: due date, amount, and whether and when it was paid. */
function InstalmentRows({
  rows,
  currency,
  error,
  onChange,
}: {
  rows: Instalment[]
  currency: string
  error?: string
  onChange: (rows: Instalment[]) => void
}) {
  const update = (index: number, change: Partial<Instalment>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
  const sum = rows.reduce((total, row) => total + Number(normalizeAmount(row.amount) ?? 0), 0)
  const allPaid = rows.length > 0 && rows.every((row) => row.paid)
  const lastPaid = rows
    .map((row) => row.paid_on)
    .toSorted()
    .at(-1)
  const removeButton = (row: Instalment, label: string) => (
    <Button
      type="button"
      variant="destructive-ghost"
      size="icon-xs"
      aria-label={`${translate('remove7')}: ${label}`}
      onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
    >
      <X />
    </Button>
  )
  return (
    <div className="grid gap-3">
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table
            aria-label={translate('importInstalments')}
            className="w-full text-left text-body-sm"
          >
            <thead className="border-b bg-muted/40 text-caption text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 font-medium">
                  #
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {translate('importDueDate')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {translate('amount')}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {translate('paidOn')}
                </th>
                <th scope="col" className="w-14 px-2 py-2 font-medium">
                  {translate('importPaid')}
                </th>
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">{translate('remove7')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, index) => {
                const label = translate('importInstalmentN', { n: index + 1 })
                return (
                  <tr key={row.key} className="align-middle">
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{index + 1}</td>
                    <td className="min-w-40 px-2 py-1.5">
                      <ImportDateField
                        id={`${row.key}-due`}
                        label={`${label} · ${translate('importDueDate')}`}
                        value={row.due_date}
                        onChange={(due_date) => update(index, { due_date })}
                      />
                    </td>
                    <td className="min-w-32 px-2 py-1.5">
                      {/* The invoice's currency, fixed here: it is changed beside the total. */}
                      <div className="relative">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-px left-px grid w-14 place-items-center rounded-l-md border-r bg-muted/50 text-caption font-medium text-muted-foreground"
                        >
                          {currency || '—'}
                        </span>
                        <input
                          aria-label={`${label} · ${translate('amount')} (${currency})`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={row.amount}
                          onChange={(event) =>
                            update(index, { amount: event.target.value.replace(/[^\d.,'’-]/g, '') })
                          }
                          className={cn(inputClass, 'pl-17 text-right tabular-nums')}
                        />
                      </div>
                    </td>
                    <td className="min-w-40 px-2 py-1.5">
                      {row.paid ? (
                        <ImportDateField
                          id={`${row.key}-paid`}
                          label={`${label} · ${translate('paidOn')}`}
                          value={row.paid_on}
                          onChange={(paid_on) => update(index, { paid_on })}
                        />
                      ) : (
                        <span className="px-3 text-caption text-muted-foreground">
                          {translate('importOpen')}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Switch
                        aria-label={`${label} · ${translate('importPaid')}`}
                        checked={row.paid}
                        onCheckedChange={(paid) =>
                          update(index, { paid, paid_on: paid ? row.paid_on || row.due_date : '' })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">{removeButton(row, label)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t bg-muted/20 text-caption text-muted-foreground">
              <tr>
                <td colSpan={2} className="px-3 py-2">
                  {allPaid && lastPaid
                    ? translate('importPaidInFull', { date: formatDate(lastPaid) })
                    : translate('importInstalmentCount', { count: rows.length })}
                </td>
                <td className="px-2 py-2 text-right font-medium text-foreground tabular-nums">
                  {formatMoney(String(sum.toFixed(2)), currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() =>
          onChange([
            ...rows,
            { key: instalmentKey(), due_date: '', amount: '', paid: false, paid_on: '' },
          ])
        }
      >
        <Plus />
        {translate('importAddInstalment')}
      </Button>
    </div>
  )
}
