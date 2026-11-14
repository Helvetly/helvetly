'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  useSheetEscape,
} from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronsUpDown, Lock, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { ClientSearch } from '@/components/invoices/client-search'
import {
  applyClient,
  changeVatMode,
  LANGUAGE_CHOICES,
  serverErrors,
  VAT_CHOICES,
} from '@/components/invoices/editor-model'
import { LinesEditor } from '@/components/invoices/lines-editor'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import {
  formatAmount,
  isZero,
  useInvoicePreview,
  useInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoices'
import { quoteNumber, useSaveQuote, type Quote } from '@/lib/quotes'

import { failQuote } from './quote-dialogs'
import {
  emptyQuoteValues,
  previewInput,
  toQuoteInput,
  valuesFromQuote,
  type QuoteValues,
} from './quote-model'

/** The drawer's width while a quote is edited: room for the lines grid. */
export const EDITOR_WIDTH = 'sm:w-[min(920px,100vw)]!'

const textArea = cn(inputClass, 'h-auto resize-y py-2 leading-relaxed')

/** A new quote in a drawer of its own (from the list or a client), opened in place. */
export function NewQuoteSheet({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: string | null
  onClose: () => void
  onSaved: (quote: Quote) => void
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn('w-full! max-w-none! gap-0 bg-panel p-0 dark:bg-background', EDITOR_WIDTH)}
      >
        <SheetTitle className="sr-only">New quote</SheetTitle>
        <SheetDescription className="sr-only">
          A quote for a client, saved as a draft
        </SheetDescription>
        <QuoteEditor clientId={clientId} onCancel={onClose} onSaved={onSaved} />
      </SheetContent>
    </Sheet>
  )
}

/** The editor once the invoice settings (the defaults) are loaded. */
export function QuoteEditor({
  quote,
  clientId = null,
  onCancel,
  onSaved,
}: {
  quote?: Quote
  clientId?: string | null
  onCancel: () => void
  onSaved: (quote: Quote) => void
}) {
  const settings = useInvoiceSettings()
  const preset = useClient(quote ? null : clientId)
  const title = !quote
    ? 'New quote'
    : quote.number
      ? `Edit ${quoteNumber(quote)}`
      : 'Edit draft quote'
  if (settings.error)
    return (
      <Frame title={title} onCancel={onCancel}>
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">
          {errorMessage(settings.error)}
        </p>
      </Frame>
    )
  if (!settings.data || (clientId && !quote && preset.isLoading))
    return (
      <Frame title={title} onCancel={onCancel}>
        <Loader size="page" className="min-h-96" />
      </Frame>
    )
  return (
    <Editor
      title={title}
      settings={settings.data}
      quote={quote}
      initial={
        quote
          ? valuesFromQuote(quote, settings.data)
          : emptyQuoteValues(settings.data, preset.data ?? null)
      }
      onCancel={onCancel}
      onSaved={onSaved}
    />
  )
}

function Frame({
  title,
  onCancel,
  children,
}: {
  title: string
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 bg-card px-3">
        <h2 className="ml-1 truncate text-body font-medium">{title}</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close editor"
              className="ml-auto"
              onClick={onCancel}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close without saving</TooltipContent>
        </Tooltip>
      </header>
      {children}
    </div>
  )
}

function Editor({
  title,
  settings,
  quote,
  initial,
  onCancel,
  onSaved,
}: {
  title: string
  settings: InvoiceSettings
  quote?: Quote
  initial: QuoteValues
  onCancel: () => void
  onSaved: (quote: Quote) => void
}) {
  const [values, setValues] = useState(initial)
  const [fromServer, setFromServer] = useState<Record<string, string>>({})
  const [picking, setPicking] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [tried, setTried] = useState(false)
  const save = useSaveQuote()
  const client = useClient(values.client_id).data
  const converted = toQuoteInput(values)
  const errors: Record<string, string> = {
    ...fromServer,
    ...converted.errors,
    ...(tried && !values.client_id ? { client_id: 'Choose who this quote is for.' } : {}),
  }
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)

  // Totals: the server's preview (the invoice maths) a moment after typing stops.
  const forPreview = previewInput(values)
  const previewJson = JSON.stringify(forPreview)
  const [previewing, setPreviewing] = useState(forPreview)
  useEffect(() => {
    const timer = setTimeout(() => setPreviewing(JSON.parse(previewJson)), 250)
    return () => clearTimeout(timer)
  }, [previewJson])
  const preview = useInvoicePreview(previewing)
  const totals = preview.data

  const set = <K extends keyof QuoteValues>(field: K, value: QuoteValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }))

  const submit = () => {
    setTried(true)
    if (!values.client_id || Object.keys(converted.errors).length)
      return toast.error('Fix the highlighted fields first.')
    save.mutate(
      { id: quote?.id, input: converted.input },
      {
        onSuccess: (saved) => {
          toast.success(quote ? 'Quote saved.' : 'Draft quote created.')
          onSaved(saved)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            setFromServer(serverErrors(error.details.fields, converted.keys))
            toast.error('Fix the highlighted fields first.')
          } else failQuote(error)
        },
      },
    )
  }
  const cancel = () => (dirty ? setDiscarding(true) : onCancel())
  // Esc is Cancel too: it asks before throwing typed work away.
  useSheetEscape(cancel)

  return (
    <Frame title={title} onCancel={cancel}>
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* A plain scroller around the grid: a grid that scrolls itself squeezes its rows. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid content-start gap-5 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="quote-client" label="Client" required error={errors.client_id}>
                <Popover open={picking} onOpenChange={setPicking}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      {...describedBy('quote-client', errors.client_id)}
                      className={cn(inputClass, 'flex items-center justify-between text-left')}
                    >
                      <span className={cn('truncate', !client && 'text-muted-foreground')}>
                        {client?.name ?? (values.client_id ? 'Loading…' : 'Choose a client')}
                      </span>
                      <ChevronsUpDown className="size-4 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] p-0">
                    <ClientSearch
                      selectedId={values.client_id}
                      onSelect={(picked) => {
                        // The client brings its currency and language, as on an invoice.
                        setValues((current) => ({
                          ...current,
                          ...applyClient(current, picked, settings),
                        }))
                        setPicking(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </FormField>
              <FormField
                id="quote-reference"
                label="Reference"
                error={errors.reference}
                tip="The client’s project or request number, printed on the quote."
              >
                <input
                  {...describedBy('quote-reference', errors.reference)}
                  value={values.reference}
                  maxLength={100}
                  onChange={(event) => set('reference', event.target.value)}
                  placeholder="Optional"
                  className={inputClass}
                />
              </FormField>
              <FormField id="quote-issue_date" label="Date" required error={errors.issue_date}>
                <input
                  {...describedBy('quote-issue_date', errors.issue_date)}
                  type="date"
                  required
                  value={values.issue_date}
                  onChange={(event) => event.target.value && set('issue_date', event.target.value)}
                  className={cn(inputClass, 'tabular-nums')}
                />
              </FormField>
              <FormField
                id="quote-valid_until"
                label="Valid until"
                required
                error={errors.valid_until}
                tip="After this date the client can no longer accept it in the portal."
              >
                <input
                  {...describedBy('quote-valid_until', errors.valid_until)}
                  type="date"
                  required
                  min={values.issue_date}
                  value={values.valid_until}
                  onChange={(event) => event.target.value && set('valid_until', event.target.value)}
                  className={cn(inputClass, 'tabular-nums')}
                />
              </FormField>
            </div>

            {/* Document options: how the whole quote is priced and printed, as on an invoice. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[104px]">
                <Combobox
                  value={values.currency}
                  options={CURRENCY_OPTIONS}
                  label="Currency"
                  placeholder="Currency"
                  renderValue={(option) => option.value}
                  contentClassName="w-[300px]"
                  className="h-8"
                  onChange={(code) => set('currency', code)}
                />
              </div>
              <Segmented
                label="Document language"
                value={values.language}
                options={LANGUAGE_CHOICES}
                onChange={(language) => set('language', language)}
              />
              <Segmented
                label="VAT"
                value={values.vat_mode}
                options={VAT_CHOICES}
                onChange={(mode) =>
                  setValues((current) => ({
                    ...current,
                    ...changeVatMode(current, mode, settings.default_vat_rate),
                  }))
                }
              />
            </div>

            <FormField id="quote-intro" label="Introduction" error={errors.intro}>
              <textarea
                {...describedBy('quote-intro', errors.intro)}
                rows={2}
                maxLength={1000}
                value={values.intro}
                onChange={(event) => set('intro', event.target.value)}
                placeholder="Printed above the lines, e.g. Thank you for your request. We are pleased to offer:"
                className={textArea}
              />
            </FormField>

            {/* The padding (cancelled by the margins) and the scroll padding, kept when a focused cell
              scrolls into view on a phone, leave room for the controls' focus rings. */}
            <div className="-m-1 scroll-px-2 overflow-x-auto p-1">
              <LinesEditor
                lines={values.lines}
                vatMode={values.vat_mode}
                defaultRate={settings.default_vat_rate}
                amounts={totals?.lines.map((line) => line.amount)}
                errors={errors}
                onChange={(lines) => set('lines', lines)}
                currency={values.currency}
              />
            </div>

            <dl
              aria-label="Totals"
              aria-busy={preview.isFetching}
              className={cn(
                'grid w-full gap-2 justify-self-end text-body transition-opacity sm:w-80',
                preview.isFetching && 'opacity-70',
              )}
            >
              <TotalRow label="Subtotal" value={totals?.subtotal} />
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <label htmlFor="quote-discount_percent">Discount %</label>
                  <input
                    id="quote-discount_percent"
                    aria-invalid={errors.discount_percent ? true : undefined}
                    inputMode="decimal"
                    value={values.discount_percent}
                    onChange={(event) => set('discount_percent', event.target.value)}
                    placeholder="0"
                    className={cn(inputClass, 'h-8 w-16 px-2 text-right tabular-nums')}
                  />
                </dt>
                <dd className="tabular-nums">
                  {totals && !isZero(totals.discount_amount)
                    ? `−${formatAmount(totals.discount_amount)}`
                    : '—'}
                </dd>
              </div>
              {values.vat_mode !== 'none' &&
                totals?.vat_breakdown.map((group) => (
                  <TotalRow
                    key={`${group.category}${group.rate}`}
                    muted
                    label={`VAT ${group.category === 'S' ? `${group.rate}%` : group.category}`}
                    value={group.vat_amount}
                  />
                ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-foreground/80 pt-2 font-medium">
                <dt>Total {values.currency}</dt>
                <dd className="text-title tabular-nums">
                  {totals ? formatAmount(totals.payable_total) : '—'}
                </dd>
              </div>
              {errors.discount_percent && (
                <p className="text-xs text-destructive">Discount: {errors.discount_percent}</p>
              )}
            </dl>

            <FormField id="quote-footer" label="Footer" error={errors.footer}>
              <textarea
                {...describedBy('quote-footer', errors.footer)}
                rows={2}
                maxLength={1000}
                value={values.footer}
                onChange={(event) => set('footer', event.target.value)}
                placeholder="Printed at the bottom, e.g. terms or what is not included"
                className={textArea}
              />
            </FormField>

            <section className="grid gap-1.5">
              <label
                htmlFor="quote-note"
                className="flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground"
              >
                <Lock className="size-3.5" /> Internal note
                <span className="font-normal">· never printed or shown to the client</span>
              </label>
              <textarea
                id="quote-note"
                rows={2}
                maxLength={1000}
                value={values.note}
                onChange={(event) => set('note', event.target.value)}
                placeholder="Anything your team should know about this quote"
                className={textArea}
              />
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-card px-4 py-3">
          <span className="text-body-sm text-muted-foreground max-sm:hidden">
            Saved as a draft: nothing is sent yet.
          </span>
          <Button type="button" variant="ghost" className="ml-auto" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : quote ? 'Save changes' : 'Save draft'}
          </Button>
        </footer>
      </form>

      {discarding && (
        <ConfirmDialog
          title="Discard your changes?"
          body="What you typed in this quote is not saved."
          confirmLabel="Discard"
          tone="destructive"
          onDecide={(approved) => {
            setDiscarding(false)
            if (approved) onCancel()
          }}
        />
      )}
    </Frame>
  )
}

function TotalRow({
  label,
  value,
  muted,
}: {
  label: string
  value: string | undefined
  muted?: boolean
}) {
  return (
    <div className={cn('flex justify-between gap-3', muted && 'text-muted-foreground')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value === undefined ? '—' : formatAmount(value)}</dd>
    </div>
  )
}
