'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { inputClass } from '@helvetly/ui/components/input'
import { LanguageSelect } from '@helvetly/ui/components/language-select'
import { Loader } from '@helvetly/ui/components/loader'
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
import { Lock, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Combobox, CURRENCY_OPTIONS } from '@/components/clients/fields'
import { DateField, quietValue } from '@/components/invoices/date-fields'
import {
  ClientBlock,
  MetaLabel,
  PaperFooter,
  ProseField,
  proseInput,
  SellerBlock,
  TotalLine,
} from '@/components/invoices/document-parts'
import {
  applyClient,
  changeVatMode,
  scheduleBlocker,
  serverErrors,
  VAT_CHOICES,
} from '@/components/invoices/editor-model'
import { InstalmentsSection } from '@/components/invoices/instalments-section'
import { LinesEditor } from '@/components/invoices/lines-editor'
import { LetterheadLogo } from '@/components/settings/logo-upload'
import { PercentInput } from '@/components/shared/percent-input'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import {
  canManageInvoices,
  formatAmount,
  isZero,
  logoSrc,
  useInvoicePreview,
  useInvoiceSettings,
  type InvoiceSettings,
  DOC_LANGUAGES,
} from '@/lib/invoices'
import { useSession } from '@/lib/queries'
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
export const EDITOR_WIDTH = 'sm:w-[min(1200px,96vw)]!'

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
        <SheetTitle className="sr-only">{translate('newQuote2')}</SheetTitle>
        <SheetDescription className="sr-only">
          {translate('aQuoteForAClientSavedAsADraft')}
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
    ? translate('newQuote2')
    : quote.number
      ? translate('edit2', { value1: quoteNumber(quote) })
      : translate('editDraftQuote')
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
  actions,
  children,
}: {
  title: string
  onCancel: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-card px-3">
        <h2 className="ml-1 min-w-0 truncate text-body font-medium">{title}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={translate('closeEditor')}
                onClick={onCancel}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('closeWithoutSaving')}</TooltipContent>
          </Tooltip>
        </div>
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
  const canManage = canManageInvoices(useSession().data?.role)
  const client = useClient(values.client_id).data
  const converted = toQuoteInput(values)
  const errors: Record<string, string> = {
    ...fromServer,
    ...converted.errors,
    ...(tried && !values.client_id ? { client_id: translate('chooseWhoThisQuoteIsFor') } : {}),
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
  const previewFailed = preview.isError && !totals
  const payable = totals?.payable_total ?? null
  const generated =
    totals?.instalments?.items.map(({ due_date, amount }) => ({ due_date, amount })) ?? []
  // Rows equal to the server's (a reopened draft) are generated: they follow the totals again.
  const schedule = values.instalments
  if (schedule?.items && JSON.stringify(schedule.items) === JSON.stringify(generated))
    setValues({ ...values, instalments: { ...schedule, items: null } })
  const blocker = scheduleBlocker(values, payable, generated)

  const set = <K extends keyof QuoteValues>(field: K, value: QuoteValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }))

  const submit = () => {
    setTried(true)
    if (!values.client_id || Object.keys(converted.errors).length)
      return toast.error(translate('fixTheHighlightedFieldsFirst'))
    save.mutate(
      { id: quote?.id, input: converted.input },
      {
        onSuccess: (saved) => {
          toast.success(quote ? translate('quoteSaved') : translate('draftQuoteCreated'))
          onSaved(saved)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            setFromServer(serverErrors(error.details.fields, converted.keys))
            toast.error(translate('fixTheHighlightedFieldsFirst'))
          } else failQuote(error)
        },
      },
    )
  }
  const cancel = () => (dirty ? setDiscarding(true) : onCancel())
  // Esc is Cancel too: it asks before throwing typed work away.
  useSheetEscape(cancel)

  const metaError = errors.issue_date ?? errors.valid_until ?? errors.reference

  return (
    // The form wraps the bar too, so Save in the bar submits it.
    <form
      noValidate
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Frame
        title={title}
        onCancel={cancel}
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="submit" size="sm" disabled={save.isPending}>
                {save.isPending
                  ? translate('saving')
                  : quote
                    ? translate('saveChanges')
                    : translate('saveDraft')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('savedAsADraftNothingIsSentYet')}</TooltipContent>
          </Tooltip>
        }
      >
        {/* As on an invoice: the options above and the internal note below stay put from md up, and only the
            page scrolls; on a phone everything scrolls together. */}
        <div className="flex min-h-0 flex-1 flex-col max-md:scroll-py-2 max-md:overflow-y-auto">
          <div className="shrink-0 border-b border-border/60 px-3 py-3 sm:px-6">
            <div className="mx-auto flex w-full max-w-[1040px] items-center gap-2 max-sm:-mx-3 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:px-3 max-sm:py-1 max-sm:*:shrink-0 sm:flex-wrap sm:justify-center">
              <div className="w-[104px]">
                <Combobox
                  value={values.currency}
                  options={CURRENCY_OPTIONS}
                  label={translate('currency')}
                  placeholder={translate('currency')}
                  renderValue={(option) => option.value}
                  contentClassName="w-[300px]"
                  onChange={(code) => set('currency', code)}
                />
              </div>
              <div className="w-[136px]">
                <LanguageSelect
                  value={values.language}
                  languages={DOC_LANGUAGES}
                  label={translate('documentLanguage')}
                  placeholder={translate('documentLanguage')}
                  onChange={(language) => set('language', language)}
                />
              </div>
              <Segmented
                size="sm"
                label={translate('vat')}
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
          </div>

          {/* Flex columns down to the page, so a short quote still reaches the internal note. */}
          <div className="flex flex-1 flex-col md:min-h-0 md:overflow-y-auto">
            <div className="@container flex min-w-0 flex-1 flex-col px-3 sm:px-6">
              <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col">
                <article
                  aria-label={translate('quote2')}
                  // A flat page from the options bar's line down to the internal note, its sides at the work area's edges.
                  className="relative left-1/2 flex w-[calc(100cqw+1.5rem)] flex-1 -translate-x-1/2 flex-col border-x bg-card px-5 py-8 sm:w-[calc(100cqw+3rem)] sm:px-10 sm:py-10"
                >
                  <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                    <LetterheadLogo url={logoSrc(settings)} canEdit={canManage} />
                    <div className="grid justify-items-end gap-1 text-right max-sm:justify-items-start max-sm:text-left">
                      <h1 className="text-display leading-none font-medium tracking-[-0.025em]">
                        {translate('quote2')}
                      </h1>
                      <span className="text-body-sm text-muted-foreground">
                        {quote?.number ? quoteNumber(quote) : translate('noAssignedWhenSent')}
                      </span>
                    </div>
                  </header>

                  <div className="mt-10 grid gap-8 md:grid-cols-2 @4xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <SellerBlock settings={settings} label={translate('from')} />
                    <ClientBlock
                      label={translate('quoteFor')}
                      missing={translate('chooseWhoThisQuoteIsFor')}
                      client={client ?? null}
                      open={picking}
                      locked={false}
                      invalid={tried && !values.client_id}
                      onOpenChange={setPicking}
                      onPick={(picked) => {
                        // The client brings its currency and language, as on an invoice.
                        setValues((current) => ({
                          ...current,
                          ...applyClient(current, picked, settings),
                        }))
                        setPicking(false)
                      }}
                    />
                    <dl className="grid w-full max-w-[300px] grid-cols-[92px_minmax(0,1fr)] content-start items-center gap-x-2 gap-y-0.5 self-start text-left text-body-sm md:col-span-2 @4xl:col-span-1">
                      <MetaLabel htmlFor="quote-issue_date" error={errors.issue_date}>
                        {translate('date')}
                      </MetaLabel>
                      <dd>
                        <DateField
                          id="quote-issue_date"
                          label={translate('date')}
                          value={values.issue_date}
                          invalid={Boolean(errors.issue_date)}
                          onChange={(date) => set('issue_date', date)}
                        />
                      </dd>
                      <MetaLabel
                        htmlFor="quote-valid_until"
                        error={errors.valid_until}
                        tip={translate('afterThisDateTheClientCanNoLongerAccept')}
                      >
                        {translate('validUntil3')}
                      </MetaLabel>
                      <dd>
                        <DateField
                          id="quote-valid_until"
                          label={translate('validUntil3')}
                          value={values.valid_until}
                          min={values.issue_date}
                          invalid={Boolean(errors.valid_until)}
                          onChange={(date) => set('valid_until', date)}
                        />
                      </dd>
                      <MetaLabel
                        htmlFor="quote-reference"
                        error={errors.reference}
                        tip={translate('theClientSProjectOrRequestNumberPrintedOn')}
                      >
                        {translate('reference')}
                      </MetaLabel>
                      <dd>
                        <input
                          id="quote-reference"
                          value={values.reference}
                          maxLength={100}
                          onChange={(event) => set('reference', event.target.value)}
                          placeholder={translate('addPONumber')}
                          className={quietValue}
                        />
                      </dd>
                      {metaError && (
                        <p className="col-span-2 px-2 pt-1 text-caption text-destructive">
                          {metaError}
                        </p>
                      )}
                    </dl>
                  </div>

                  <ProseField
                    aria-label={translate('introduction')}
                    aria-invalid={errors.intro ? true : undefined}
                    value={values.intro}
                    onChange={(event) => set('intro', event.target.value)}
                    placeholder={translate('printedAboveTheLinesEGThankYouFor')}
                    wrapperClassName="mt-10"
                    className={proseInput}
                  />

                  {/* The padding (cancelled by the margins) leaves room for the controls' focus rings. */}
                  <div className="-mx-1 mt-3 -mb-1 scroll-px-2 overflow-x-auto p-1">
                    <LinesEditor
                      onChangeBasis={(mode) =>
                        setValues((current) => ({
                          ...current,
                          ...changeVatMode(current, mode, settings.default_vat_rate),
                        }))
                      }
                      lines={values.lines}
                      vatMode={values.vat_mode}
                      defaultRate={settings.default_vat_rate}
                      amounts={totals?.lines.map((line) => line.amount)}
                      amountsFailed={previewFailed}
                      errors={errors}
                      onChange={(lines) => set('lines', lines)}
                      currency={values.currency}
                    />
                  </div>

                  <dl
                    aria-label={translate('totals')}
                    aria-busy={preview.isFetching}
                    className={cn(
                      'mt-6 ml-auto grid w-full gap-2 text-body transition-opacity sm:w-[320px]',
                      preview.isFetching && 'opacity-70',
                    )}
                  >
                    <TotalLine
                      failed={previewFailed}
                      label={translate('subtotal')}
                      value={totals ? formatAmount(totals.subtotal) : null}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-2 text-muted-foreground">
                        <label htmlFor="quote-discount_percent">{translate('discount2')}</label>
                        <PercentInput
                          id="quote-discount_percent"
                          aria-invalid={errors.discount_percent ? true : undefined}
                          value={values.discount_percent}
                          onValueChange={(value) => set('discount_percent', value)}
                          placeholder="0"
                          compact
                          className="inline-block"
                          inputClassName="field-quiet h-7 w-14 rounded-md bg-muted/60 pl-2 text-right text-body-sm tabular-nums outline-none focus:bg-card focus:ring-2 focus:ring-ring/40 aria-invalid:ring-2 aria-invalid:ring-destructive/40"
                        />
                      </dt>
                      <dd className="tabular-nums">
                        {totals && !isZero(totals.discount_amount) ? (
                          `−${formatAmount(totals.discount_amount)}`
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </dd>
                    </div>
                    {values.vat_mode !== 'none' &&
                      totals?.vat_breakdown.map((group) => (
                        <TotalLine
                          key={`${group.category}${group.rate}`}
                          muted
                          label={translate('vatGroupLabel', {
                            category: group.category === 'S' ? `${group.rate}%` : group.category,
                          })}
                          value={formatAmount(group.vat_amount)}
                        />
                      ))}
                    <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-foreground/80 pt-3">
                      <dt className="text-body font-medium">
                        {translate('total2')}
                        {values.currency}
                      </dt>
                      <dd className="text-page font-medium tracking-[-0.02em] tabular-nums">
                        {totals ? formatAmount(totals.payable_total) : '—'}
                      </dd>
                    </div>
                    {errors.discount_percent && (
                      <p className="text-xs text-destructive">
                        {translate('discount3')}
                        {errors.discount_percent}
                      </p>
                    )}
                  </dl>

                  <PaperFooter>
                    <ProseField
                      aria-label={translate('footer')}
                      aria-invalid={errors.footer ? true : undefined}
                      value={values.footer}
                      onChange={(event) => set('footer', event.target.value)}
                      placeholder={translate('printedAtTheBottomEGTermsOrWhat')}
                      className={cn(proseInput, 'text-body-sm text-muted-foreground')}
                    />
                  </PaperFooter>
                  {(errors.intro || errors.footer) && (
                    <p className="mt-2 text-caption text-destructive">
                      {errors.intro ?? errors.footer}
                    </p>
                  )}
                </article>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/60 px-3 py-3 sm:px-6">
            <div className="mx-auto grid w-full max-w-[1040px] gap-2">
              <InstalmentsSection
                value={values.instalments}
                onChange={(instalments) => set('instalments', instalments)}
                description={translate('quoteInstalmentsDescription')}
                payable={payable}
                generated={generated}
                currency={values.currency}
                issueDate={values.issue_date}
                firstDue={values.due_date}
                settings={settings}
                errors={errors}
                blocker={blocker}
              />
              <section className="grid gap-1.5 px-1">
                <label
                  htmlFor="quote-note"
                  className="flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground"
                >
                  <Lock className="size-3.5" />
                  {translate('internalNote2')}
                  <span className="font-normal">{translate('neverPrintedOrShownToTheClient')}</span>
                </label>
                <textarea
                  id="quote-note"
                  value={values.note}
                  maxLength={1000}
                  onChange={(event) => set('note', event.target.value)}
                  placeholder={translate('anythingYourTeamShouldKnowAboutThisQuote')}
                  rows={1}
                  className={cn(
                    inputClass,
                    '[field-sizing:content] h-auto max-h-32 resize-none py-2.5 text-body leading-relaxed',
                  )}
                />
              </section>
            </div>
          </div>
        </div>
      </Frame>

      {discarding && (
        <ConfirmDialog
          title={translate('discardYourChanges')}
          body={translate('whatYouTypedInThisQuoteIsNotSaved')}
          confirmLabel={translate('discard')}
          tone="destructive"
          onDecide={(approved) => {
            setDiscarding(false)
            if (approved) onCancel()
          }}
        />
      )}
    </form>
  )
}
