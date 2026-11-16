'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DropdownMenuItem } from '@helvetly/ui/components/dropdown-menu'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleHelp,
  CloudOff,
  Download,
  ExternalLink,
  Eye,
  FileLock2,
  Lock,
  LoaderCircle,
  Plus,
  Trash2,
  X,
  ArrowLeft,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { addressLines } from '@/components/clients/client-bits'
import { ClientForm } from '@/components/clients/client-form'
import { countryName } from '@/components/clients/client-form-model'
import { Combobox, CURRENCY_OPTIONS } from '@/components/clients/fields'
import { State } from '@/components/data/table-page'
import { RecordLink } from '@/components/record-link'
import { LetterheadLogo } from '@/components/settings/logo-upload'
import { PageHeader } from '@/components/shell/page-header'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import {
  addDays,
  canManageInvoices,
  cannotIssueReasons,
  daysBetween,
  documentName,
  formatAmount,
  formatIban,
  formatMoney,
  fromCents,
  ibanInfo,
  isPositive,
  isReceivable,
  isZero,
  kindInfo,
  logoSrc,
  needsRonRate,
  pdfUrl,
  refundAfterCredit,
  toCents,
  today,
  useDeleteInvoice,
  useInvoice,
  useInvoicePreview,
  useInvoiceSettings,
  useIssueInvoice,
  useSaveInvoice,
  usableMethods,
  type Invoice,
  type InvoiceInput,
  type InvoiceKind,
  type IssueReason,
  type InvoiceSettings,
} from '@/lib/invoices'
import { useSession } from '@/lib/queries'

import { ClientSearch } from './client-search'
import { DateField, DueDateField, quietValue, ServiceField } from './date-fields'
import {
  applyClient,
  changeVatMode,
  emptyValues,
  LANGUAGE_CHOICES,
  reasonTarget,
  serverErrors,
  lockedInput,
  prepaidTotal,
  scheduleBlocker,
  toInput,
  valuesFromInvoice,
  VAT_CHOICES,
  type EditorErrors,
  type EditorValues,
} from './editor-model'
import { InstalmentsSection } from './instalments-section'
import { KIND_ICONS } from './invoice-bits'
import { IssueBlockers } from './invoice-dialogs'
import { focusCell, LinesEditor } from './lines-editor'
import { PaymentToggles } from './payment-methods'
import { PdfView } from './pdf-view'
import { PlanCard } from './plan-card'
import { PlanDialog } from './plan-dialog'
import { PrepaymentPicker } from './prepayment-picker'

/** What POST /invoices makes; the other kinds come from an issued invoice. */
const CREATABLE: InvoiceKind[] = ['invoice', 'partial', 'prepayment', 'proforma', 'self_billed']
const PRECEDING: Partial<Record<InvoiceKind, string>> = {
  credit_note: translate('creditsInvoice'),
  debit_note: translate('debitNoteOnInvoice'),
  corrected: translate('correctsInvoice'),
}

/** After the first save the URL carries the draft's id, so a reload continues where you were. */
const draftUrl = (id: string) => `${window.location.pathname}?id=${encodeURIComponent(id)}`

/** /invoices/new (optionally ?client=…&kind=…) and /invoices/edit?id=…: loads what the editor needs. */
export function InvoiceEditorPage() {
  const query = useSearchParams()
  const id = query.get('id')
  const clientId = query.get('client')
  const kind = CREATABLE.find((entry) => entry === query.get('kind')) ?? 'invoice'
  const [created, setCreated] = useState<string | null>(null)
  const settings = useInvoiceSettings()
  const invoice = useInvoice(id)
  const preset = useClient(id ? null : clientId)

  if (settings.error || invoice.error)
    return (
      <EditorFrame title={translate('invoice2')}>
        <State
          icon={<CloudOff />}
          title={
            invoice.error instanceof ApiError && invoice.error.status === 404
              ? translate('thisInvoiceDoesnTExist')
              : translate('couldnTOpenTheEditor')
          }
          text={errorMessage(invoice.error ?? settings.error)}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/invoices">
                <ArrowLeft />
                {translate('backToInvoices2')}
              </Link>
            </Button>
          }
        />
      </EditorFrame>
    )
  if (!settings.data || (id && !invoice.data) || (clientId && !id && preset.isLoading))
    return (
      <EditorFrame
        title={id ? translate('draft') : translate('newInvoice')}
        kind={id ? undefined : kind}
      >
        <Loader size="page" className="min-h-96" />
      </EditorFrame>
    )
  if (invoice.data && invoice.data.status !== 'draft') return <Locked invoice={invoice.data} />
  if (invoice.data?.plan?.seq === 0) return <Planned invoice={invoice.data} />

  return (
    <Editor
      // The draft made by the first save keeps the same editor (no remount, no lost focus).
      key={id && id !== created ? id : 'new'}
      settings={settings.data}
      invoice={id ? invoice.data : undefined}
      kind={kind}
      client={preset.data ?? null}
      onCreated={(newId) => {
        // Committed before the URL changes: the router's render must already see this draft as
        // the one being edited, or it would remount the editor mid-typing.
        flushSync(() => setCreated(newId))
        window.history.replaceState(null, '', draftUrl(newId))
      }}
    />
  )
}

function EditorFrame({
  title,
  kind = 'invoice',
  actions,
  children,
}: {
  title: string
  kind?: InvoiceKind
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <PageHeader
        tabs={[title]}
        tabIcons={[KIND_ICONS[kind]]}
        actions={actions ?? <CloseButton />}
      />
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  )
}

function CloseButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-sm" aria-label={translate('closeEditor')}>
          <Link href="/invoices">
            <X />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{translate('backToInvoices')}</TooltipContent>
    </Tooltip>
  )
}

/** A plan's source draft is its template: locked while the plan issues partials from it. */
function Planned({ invoice }: { invoice: Invoice }) {
  const canManage = canManageInvoices(useSession().data?.role)
  return (
    <EditorFrame
      title={translate('draft3', { value1: kindInfo(invoice.kind).label.toLowerCase() })}
      kind={invoice.kind}
    >
      <div className="mx-auto grid w-full max-w-[640px] gap-4 px-4 py-10">
        <State
          icon={<FileLock2 />}
          title={translate('thisDraftBelongsToAnInstalmentPlan')}
          text={translate('thePlanIssuesOnePartialInvoicePerInstalmentFrom')}
          action={
            <Button asChild size="sm">
              <Link href={`/invoices?id=${encodeURIComponent(invoice.id)}`}>
                {translate('openTheDraft')}
              </Link>
            </Button>
          }
        />
        {invoice.plan && <PlanCard planId={invoice.plan.id} canManage={canManage} />}
      </div>
    </EditorFrame>
  )
}

function Locked({ invoice }: { invoice: Invoice }) {
  return (
    <EditorFrame title={documentName(invoice)} kind={invoice.kind}>
      <State
        icon={<FileLock2 />}
        title={translate('isIssued', { value1: documentName(invoice) })}
        text={translate('issuedDocumentsCanTChangeToCorrectItCreate')}
        action={
          <Button asChild size="sm">
            <Link href={`/invoices?id=${encodeURIComponent(invoice.id)}`}>
              {translate('openTheInvoice')}
            </Link>
          </Button>
        }
      />
    </EditorFrame>
  )
}

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

function Editor({
  settings,
  invoice,
  kind: newKind,
  client: preset,
  onCreated,
}: {
  settings: InvoiceSettings
  invoice?: Invoice
  kind: InvoiceKind
  client: Client | null
  onCreated: (id: string) => void
}) {
  const router = useRouter()
  const kind = invoice?.kind ?? newKind
  const [values, setValues] = useState<EditorValues>(() =>
    invoice
      ? valuesFromInvoice(invoice, settings.default_vat_rate)
      : emptyValues(settings, preset, kind),
  )
  const [draftId, setDraftId] = useState(invoice?.id ?? null)
  const lockCredit = (input: Partial<InvoiceInput>) => lockedInput(kind, input)
  const [savedPayload, setSavedPayload] = useState(() =>
    invoice
      ? JSON.stringify(
          lockCredit(toInput(valuesFromInvoice(invoice, settings.default_vat_rate)).input),
        )
      : null,
  )
  const [failedPayload, setFailedPayload] = useState<string | null>(null)
  const [fromServer, setFromServer] = useState<EditorErrors>({})
  const [reasons, setReasons] = useState<IssueReason[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pdfVersion, setPdfVersion] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [pages, setPages] = useState<number | null>(null)
  const [picking, setPicking] = useState(!values.client_id && !invoice)
  const [clientError, setClientError] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  const save = useSaveInvoice()
  const saving = useRef<Promise<Invoice> | null>(null)
  const savingPayload = useRef<string | null>(null) // what the save in flight sends
  const issue = useIssueInvoice()
  const remove = useDeleteInvoice()
  const client =
    useClient(values.client_id).data ?? (preset?.id === values.client_id ? preset : undefined)
  const credit = kind === 'credit_note'
  const canManage = canManageInvoices(useSession().data?.role)
  const noun = kindInfo(kind).label.toLowerCase()
  const preceding = PRECEDING[kind]
  const hasPaymentMethods = !credit && kind !== 'proforma' && kind !== 'self_billed'

  // A method that cannot apply (settings, IBAN, currency) is sent as off, so the saved choice never
  // holds what the toolbar shows as off; the toggle keeps the intent for when it applies again.
  const sendable = {
    ...values,
    payment_methods: usableMethods(values.payment_methods, settings, values.currency),
  }
  const converted = toInput(sendable)
  const body = lockCredit(converted.input)
  // The kind is fixed once the draft exists, so only the first save sends it.
  const createBody: Partial<InvoiceInput> = { ...body, kind }
  const payload = JSON.stringify(body)
  const valid = Object.keys(converted.errors).length === 0
  const dirty = payload !== savedPayload
  const errors = { ...fromServer, ...converted.errors }

  // Totals: the server's preview of what is on screen, a moment after typing stops.
  const forPreview = toInput(sendable, true)
  const previewJson = JSON.stringify(forPreview.input)
  const previewValid = Object.keys(forPreview.errors).length === 0
  const [previewInput, setPreviewInput] = useState(forPreview.input)
  useEffect(() => {
    if (!previewValid) return
    const timer = setTimeout(() => setPreviewInput(JSON.parse(previewJson)), 250)
    return () => clearTimeout(timer)
  }, [previewJson, previewValid])
  const preview = useInvoicePreview(previewInput)
  const totals = preview.data
  const amounts = totals?.lines.map((line) => line.amount)

  const set = <K extends keyof EditorValues>(field: K, value: EditorValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }))

  const persist = async () => {
    if (saving.current) return saving.current
    const sent = payload
    const keys = converted.keys
    try {
      savingPayload.current = sent
      saving.current = save.mutateAsync({
        id: draftId ?? undefined,
        input: draftId ? body : createBody,
      })
      const saved = await saving.current
      setSavedPayload(sent)
      setFailedPayload(null)
      setFromServer({})
      setPdfVersion((version) => version + 1)
      if (!draftId) {
        setDraftId(saved.id)
        onCreated(saved.id)
      }
      return saved
    } catch (error) {
      setFailedPayload(sent)
      if (error instanceof ApiError && error.status === 422)
        setFromServer(serverErrors(error.details.fields, keys))
      throw error
    } finally {
      saving.current = null
      savingPayload.current = null
    }
  }

  // Autosave: a draft exists once there is a client; then every pause in typing saves it.
  const autosave = useEffectEvent(() => void persist().catch(() => {}))
  // Keyed by the payload, so every change restarts the pause.
  const pending =
    Boolean(values.client_id) && valid && dirty && payload !== failedPayload ? payload : null
  useEffect(() => {
    if (pending === null || save.isPending) return
    const timer = setTimeout(autosave, 700)
    return () => clearTimeout(timer)
  }, [pending, save.isPending])

  // Leaving mid-pause still saves; closing the tab with unsaved changes asks first.
  const flush = useEffectEvent(() => {
    if (!values.client_id || !valid || !dirty) return
    const inFlight = saving.current
    if (!inFlight)
      return save.mutate({ id: draftId ?? undefined, input: draftId ? body : createBody })
    // Edits typed while a save is out follow it, under the id it returns (a first save creates the draft).
    if (payload === savingPayload.current) return
    const latest = body
    inFlight.then(
      (saved) => save.mutate({ id: saved.id, input: latest }),
      () => {},
    )
  })
  useEffect(() => () => flush(), [])
  const warn = useEffectEvent((event: BeforeUnloadEvent) => {
    if (dirty && values.client_id) event.preventDefault()
  })
  useEffect(() => {
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // ⌘S saves now.
  const saveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    // ⌘P shows our PDF instead of printing the editor page.
    if (event.key === 'p' && draftId) {
      event.preventDefault()
      return setPreviewing(true)
    }
    if (event.key !== 's') return
    event.preventDefault()
    if (values.client_id && valid)
      void persist().then(
        () => toast.success(translate('draftSaved2')),
        () => {},
      )
  })
  useEffect(() => {
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [])

  const saveState: SaveState = save.isPending
    ? 'saving'
    : failedPayload === payload && dirty
      ? 'error'
      : dirty && values.client_id
        ? 'unsaved'
        : draftId
          ? 'saved'
          : 'idle'

  const startIssue = async () => {
    if (!values.client_id) {
      setClientError(true)
      setPicking(true)
      return
    }
    if (!valid) return toast.error(translate('fixTheHighlightedFieldsFirst'))
    try {
      if (dirty || !draftId) await persist()
    } catch (error) {
      return toast.error(
        error instanceof ApiError && error.status === 422
          ? translate('fixTheHighlightedFieldsFirst')
          : errorMessage(error),
      )
    }
    setConfirming(true)
  }

  const doIssue = (thenRefund = false) => {
    if (!draftId) return
    issue.mutate(draftId, {
      onSuccess: (issued) => {
        toast.success(translate('issued2', { value1: documentName(issued) }))
        // Straight to the credited invoice with the refund dialog open (?refund=1).
        const credited = issued.credited_invoice?.id
        router.push(
          thenRefund && credited
            ? `/invoices?id=${encodeURIComponent(credited)}&refund=1`
            : `/invoices?id=${encodeURIComponent(issued.id)}`,
        )
      },
      onError: (error) => {
        const found = cannotIssueReasons(error)
        if (!found) return toastError(error)
        setReasons(found)
        top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    })
  }

  const fixInline = (reason: IssueReason) => {
    const target = reasonTarget(reason.field)
    if (!target) return
    // The server counts the lines it was sent: untouched rows are not among them.
    const key = target.line === undefined ? undefined : converted.keys[target.line]
    if (key) return focusCell(key, target.field)
    document.querySelector<HTMLElement>(`[data-field="${target.field}"]`)?.focus()
    document.getElementById(`invoice-${target.field}`)?.focus()
  }

  const title = draftId ? translate('draft2', { noun: noun }) : translate('new', { noun: noun })
  const due = daysBetween(values.issue_date, values.due_date)
  const iban = ibanInfo(settings.iban ?? '')
  const payable = totals?.payable_total ?? null
  const prepaid = kind === 'invoice' && values.prepayments.length > 0
  const amountDue =
    payable === null
      ? null
      : fromCents(toCents(payable) - toCents(prepaidTotal(values.prepayments)))
  const generated =
    totals?.instalments?.items.map(({ due_date, amount }) => ({ due_date, amount })) ?? []
  // Rows equal to the server's (a reopened draft) are generated: they follow the totals again.
  const schedule = values.instalments
  if (schedule?.items && JSON.stringify(schedule.items) === JSON.stringify(generated))
    setValues({ ...values, instalments: { ...schedule, items: null } })
  const blocker = scheduleBlocker(values, payable, generated)
  const openPlan = async () => {
    try {
      if (dirty) await persist()
      setPlanning(true)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  // A credit note against a paid invoice leaves the customer owed money back.
  const credited = useInvoice(invoice?.credited_invoice?.id ?? null).data
  const owedBack =
    credited && payable !== null && isPositive(refundAfterCredit(credited, payable))
      ? refundAfterCredit(credited, payable)
      : null

  return (
    <>
      <PageHeader
        tabs={[title]}
        tabIcons={[KIND_ICONS[kind]]}
        menu={
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 /> {draftId ? translate('deleteDraft2') : translate('discard')}
          </DropdownMenuItem>
        }
        actions={
          <>
            <SaveIndicator state={saveState} onRetry={() => void persist().catch(() => {})} />
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A span keeps the tooltip working while the button is disabled. */}
                <span tabIndex={draftId ? undefined : 0}>
                  <Button
                    variant="ghost"
                    disabled={!draftId}
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setPreviewing(true)}
                  >
                    <Eye className="size-4" />
                    {translate('preview3')}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {draftId ? (
                  <span className="flex items-center gap-2">
                    {translate('thePDFAsItWillPrint')}
                    <Kbd>{translate('p')}</Kbd>
                  </span>
                ) : (
                  translate('chooseAClientFirstThePDFShowsOnceThe')
                )}
              </TooltipContent>
            </Tooltip>
            <Button
              disabled={issue.isPending || save.isPending || blocker !== null}
              title={blocker ?? undefined}
              onClick={() => void startIssue()}
            >
              {issue.isPending ? translate('issuing') : translate('issue4', { noun: noun })}
            </Button>
            <CloseButton />
          </>
        }
      />

      <div className="flex flex-1 items-start">
        <div ref={top} className="min-w-0 flex-1 scroll-mt-16 px-3 pt-5 pb-16 sm:px-6 md:pt-8">
          <div className="mx-auto grid w-full max-w-[1040px] gap-4">
            {preceding && invoice?.credited_invoice && (
              <Callout tone="warning" icon={CircleAlert}>
                {preceding}{' '}
                <RecordLink
                  href={`/invoices?id=${encodeURIComponent(invoice.credited_invoice.id)}`}
                  className="font-medium underline underline-offset-4 hover:no-underline"
                >
                  {invoice.credited_invoice.number}
                </RecordLink>
                {credit && '. Remove or lower lines for a partial credit.'}
              </Callout>
            )}
            {reasons && reasons.length > 0 && (
              <IssueBlockers
                reasons={reasons}
                clientId={values.client_id ?? ''}
                onFixInline={fixInline}
              />
            )}

            {/* Document options: how the whole document is priced and printed. */}
            <div className="flex flex-wrap items-center gap-2">
              {credit ? (
                <span className="text-[13px] text-muted-foreground">
                  {values.currency} ·{' '}
                  {VAT_CHOICES.find((choice) => choice.value === values.vat_mode)?.label}
                  {translate('asOnTheCreditedInvoice')}
                </span>
              ) : (
                <div className="w-[104px]">
                  <Combobox
                    value={values.currency}
                    options={CURRENCY_OPTIONS}
                    label={translate('currency')}
                    placeholder={translate('currency')}
                    renderValue={(option) => option.value}
                    contentClassName="w-[300px]"
                    className="h-8"
                    onChange={(code) => set('currency', code)}
                  />
                </div>
              )}
              <Segmented
                label={translate('documentLanguage')}
                value={values.language}
                options={LANGUAGE_CHOICES}
                onChange={(language) => set('language', language)}
              />
              {!credit && (
                <Segmented
                  label={translate('vat')}
                  value={values.vat_mode}
                  options={VAT_CHOICES}
                  onChange={(mode) =>
                    setValues((current) => changeVatMode(current, mode, settings.default_vat_rate))
                  }
                />
              )}
              {hasPaymentMethods && (
                <PaymentToggles
                  settings={settings}
                  currency={values.currency}
                  value={values.payment_methods}
                  onChange={(methods) => set('payment_methods', methods)}
                />
              )}
            </div>

            <article
              aria-label={title}
              className="rounded-[18px] bg-card px-5 py-8 shadow-[0_0_0_1px_oklch(0.21_0.006_286/0.06),0_2px_4px_oklch(0.21_0.006_286/0.03),0_18px_44px_-18px_oklch(0.21_0.006_286/0.16)] sm:px-10 sm:py-10 dark:shadow-elevation-2"
            >
              {/* Letterhead: logo left; title and dates right. */}
              <header className="flex flex-wrap items-start justify-between gap-6 max-md:flex-col">
                <LetterheadLogo url={logoSrc(settings)} canEdit={canManage} />
                <div className="grid justify-items-end gap-1 text-right max-md:justify-items-start max-md:text-left">
                  <h1 className="text-[28px] leading-none font-medium tracking-[-0.025em]">
                    {kindInfo(kind).label}
                  </h1>
                  <span className="text-[13px] text-muted-foreground">
                    {translate('noAssignedWhenIssued')}
                  </span>
                  <dl className="mt-4 grid w-[300px] max-w-full grid-cols-[92px_minmax(0,1fr)] content-start items-center gap-x-2 gap-y-0.5 text-left text-[13.5px]">
                    <MetaLabel htmlFor="invoice-issue_date" error={errors.issue_date}>
                      {translate('issueDate')}
                    </MetaLabel>
                    <dd>
                      <DateField
                        id="invoice-issue_date"
                        label={translate('issueDate')}
                        value={values.issue_date}
                        max={today()}
                        invalid={Boolean(errors.issue_date)}
                        // The term stays: moving the issue date moves the due date with it.
                        onChange={(issueDate) =>
                          setValues((current) => ({
                            ...current,
                            issue_date: issueDate,
                            due_date: addDays(issueDate, Math.max(due, 0)),
                          }))
                        }
                      />
                    </dd>
                    <MetaLabel htmlFor="invoice-due_date" error={errors.due_date}>
                      {translate('dueDate')}
                    </MetaLabel>
                    <dd>
                      <DueDateField
                        id="invoice-due_date"
                        issueDate={values.issue_date}
                        value={values.due_date}
                        invalid={Boolean(errors.due_date) || due < 0}
                        onChange={(dueDate) => set('due_date', dueDate)}
                      />
                    </dd>
                    <MetaLabel
                      htmlFor="invoice-service_date"
                      error={errors.service_date ?? errors.service_date_end}
                    >
                      {translate('service')}
                    </MetaLabel>
                    <dd>
                      <ServiceField
                        id="invoice-service_date"
                        start={values.service_date}
                        end={values.service_date_end}
                        invalid={Boolean(errors.service_date ?? errors.service_date_end)}
                        onChange={(start, end) =>
                          setValues((current) => ({
                            ...current,
                            service_date: start,
                            service_date_end: end,
                          }))
                        }
                      />
                    </dd>
                    <MetaLabel
                      htmlFor="invoice-reference"
                      error={errors.reference}
                      tip={translate('theClientSOrderOrPONumberPrintedOn')}
                    >
                      {translate('reference')}
                    </MetaLabel>
                    <dd>
                      <input
                        id="invoice-reference"
                        value={values.reference}
                        maxLength={100}
                        onChange={(event) => set('reference', event.target.value)}
                        placeholder={translate('addPONumber')}
                        className={quietValue}
                      />
                    </dd>
                    {needsRonRate(client?.country, values.currency) && (
                      <>
                        <MetaLabel
                          htmlFor="invoice-tax_currency_rate"
                          error={errors.tax_currency_rate}
                          tip={translate('ronPer1OnTheIssueDateBNRRate', {
                            currency: values.currency,
                          })}
                        >
                          {translate('ronRate')}
                        </MetaLabel>
                        <dd>
                          <input
                            id="invoice-tax_currency_rate"
                            value={values.tax_currency_rate}
                            inputMode="decimal"
                            maxLength={19}
                            onChange={(event) => set('tax_currency_rate', event.target.value)}
                            placeholder={translate('eG49771')}
                            className={quietValue}
                          />
                        </dd>
                      </>
                    )}
                    {(errors.issue_date ||
                      errors.due_date ||
                      errors.reference ||
                      errors.tax_currency_rate) && (
                      <p className="col-span-2 px-2 pt-1 text-[12px] text-destructive">
                        {errors.issue_date ??
                          errors.due_date ??
                          errors.reference ??
                          errors.tax_currency_rate}
                      </p>
                    )}
                  </dl>
                </div>
              </header>

              {/* Seller and client side by side, as on the printed invoice. */}
              <div className="mt-10 grid gap-8 md:grid-cols-2">
                <div className="grid content-start gap-0.5 text-[13px] leading-relaxed text-muted-foreground">
                  <span className={cn(PARTY_LABEL, 'mb-1.5')}>{translate('from')}</span>
                  <span className="text-[15px] font-medium text-foreground">
                    {settings.seller.name || translate('yourCompany')}
                  </span>
                  {settings.seller.street && (
                    <span>
                      {settings.seller.street} {settings.seller.street_number},{' '}
                      {settings.seller.zip} {settings.seller.city}
                    </span>
                  )}
                  {settings.seller.vat_number && <span>{settings.seller.vat_number}</span>}
                  {!settings.is_complete && (
                    <Link
                      href="/settings/invoices"
                      className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-link underline underline-offset-2 hover:no-underline"
                    >
                      {translate('completeYourCompanyDetails')}
                      <ArrowUpRight className="size-3" />
                    </Link>
                  )}
                </div>
                <ClientBlock
                  client={client ?? null}
                  open={picking}
                  locked={credit}
                  invalid={clientError && !values.client_id}
                  onOpenChange={setPicking}
                  onPick={(picked) => {
                    setValues((current) => applyClient(current, picked, settings))
                    setClientError(false)
                    setPicking(false)
                    focusCell(values.lines[0]?.key ?? '', 'description')
                  }}
                />
              </div>

              <textarea
                aria-label={translate('introduction')}
                value={values.intro}
                maxLength={1000}
                onChange={(event) => set('intro', event.target.value)}
                placeholder={translate('addAMessageAboveTheLinesOptionalEG')}
                rows={1}
                className={cn(proseInput, 'mt-10')}
              />

              {/* The padding (cancelled by the margins) leaves room for the controls' focus rings. */}
              <div className="-mx-1 mt-3 -mb-1 overflow-x-auto p-1">
                <LinesEditor
                  lines={values.lines}
                  vatMode={values.vat_mode}
                  defaultRate={settings.default_vat_rate}
                  amounts={amounts}
                  errors={errors}
                  onChange={(lines) => set('lines', lines)}
                  currency={values.currency}
                />
              </div>

              <div className="mt-6 flex flex-wrap items-start justify-between gap-8">
                <PaymentNote
                  settings={settings}
                  ibanValid={iban.valid}
                  qrBill={totals?.payment.qr_bill ?? false}
                  revolutUrl={totals?.payment.revolut_url ?? null}
                />
                <dl
                  aria-busy={preview.isFetching}
                  className={cn(
                    'grid w-full gap-2 text-[14px] transition-opacity sm:w-[320px]',
                    preview.isFetching && 'opacity-70',
                  )}
                >
                  <TotalLine
                    label={translate('subtotal')}
                    value={totals ? formatAmount(totals.subtotal) : null}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      {translate('discount2')}
                      <span className="relative">
                        <input
                          id="invoice-discount_percent"
                          aria-label={translate('discountOnTheWholeDocumentPercent')}
                          aria-invalid={errors.discount_percent ? true : undefined}
                          inputMode="decimal"
                          disabled={credit}
                          value={values.discount_percent}
                          onChange={(event) => set('discount_percent', event.target.value)}
                          placeholder="0"
                          className="h-7 w-14 rounded-md bg-muted/60 pr-5 pl-2 text-right text-[13px] tabular-nums outline-none focus:bg-card focus:ring-2 focus:ring-ring/40 aria-invalid:ring-2 aria-invalid:ring-destructive/40"
                        />
                        <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[12px] text-muted-foreground">
                          %
                        </span>
                      </span>
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
                        label={translate('vatOn2', {
                          value1: group.category === 'S' ? `${group.rate}%` : group.category,
                          value2: formatAmount(group.taxable_amount),
                        })}
                        value={formatAmount(group.vat_amount)}
                      />
                    ))}
                  {totals && !isZero(totals.rounding_amount) && (
                    <TotalLine
                      muted
                      label={translate('roundingTo005')}
                      value={formatAmount(totals.rounding_amount)}
                    />
                  )}
                  <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-foreground/80 pt-3">
                    <dt className="text-[14px] font-medium">
                      {translate('total2')}
                      {values.currency}
                      {values.vat_mode === 'inclusive' && (
                        <span className="font-normal text-muted-foreground">
                          {translate('inclVAT2')}
                        </span>
                      )}
                    </dt>
                    <dd className="text-[22px] font-medium tracking-[-0.02em] tabular-nums">
                      {payable === null ? '—' : formatAmount(payable)}
                    </dd>
                  </div>
                  {prepaid &&
                    values.prepayments.map((prepayment) => (
                      <TotalLine
                        key={prepayment.id}
                        muted
                        label={`Prepayment ${prepayment.number ?? ''}`.trim()}
                        value={`−${formatAmount(prepayment.payable_total)}`}
                      />
                    ))}
                  {prepaid && (
                    <TotalLine
                      label={translate('amountDue2', { currency: values.currency })}
                      value={amountDue === null ? null : formatAmount(amountDue)}
                    />
                  )}
                </dl>
              </div>

              {/* The rule sits outside the field, so focus outlines only the text. */}
              <div className="mt-10 border-t border-border/70 pt-4">
                <textarea
                  aria-label={translate('footer')}
                  value={values.footer}
                  maxLength={1000}
                  onChange={(event) => set('footer', event.target.value)}
                  placeholder={translate('footerPrintedAtTheBottomEGPaymentConditions')}
                  rows={1}
                  className={cn(proseInput, 'text-[13px] text-muted-foreground')}
                />
              </div>
            </article>

            {kind === 'invoice' && values.client_id && (
              <PrepaymentPicker
                clientId={values.client_id}
                currency={values.currency}
                value={values.prepayments}
                onChange={(prepayments) => set('prepayments', prepayments)}
              />
            )}

            {isReceivable(kind) && (
              <InstalmentsSection
                value={values.instalments}
                onChange={(instalments) => set('instalments', instalments)}
                reminders={values.reminders_enabled}
                onReminders={(on) => set('reminders_enabled', on)}
                payable={payable}
                generated={generated}
                currency={values.currency}
                issueDate={values.issue_date}
                firstDue={values.due_date}
                settings={settings}
                errors={errors}
                blocker={blocker}
                onSplit={draftId && valid ? () => void openPlan() : undefined}
              />
            )}

            <section className="grid gap-1.5 rounded-xl px-1">
              <label
                htmlFor="invoice-note"
                className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"
              >
                <Lock className="size-3.5" />
                {translate('internalNote2')}
                <span className="font-normal">{translate('neverPrinted')}</span>
              </label>
              <textarea
                id="invoice-note"
                value={values.note}
                maxLength={1000}
                onChange={(event) => set('note', event.target.value)}
                placeholder={translate('anythingYourTeamShouldKnowAboutThisInvoice')}
                rows={2}
                className="[field-sizing:content] w-full resize-none rounded-xl bg-muted/50 px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-placeholder focus:bg-card focus:ring-2 focus:ring-ring/40"
              />
            </section>

            <p className="hidden flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-[12px] text-muted-foreground md:flex">
              <Hint keys="Enter">{translate('newLine')}</Hint>
              <Hint keys="⇧ Enter">{translate('lineBreak')}</Hint>
              <Hint keys="⌥ ↑ ↓">{translate('moveLine')}</Hint>
              <Hint keys="⌘ S">{translate('saveNow')}</Hint>
            </p>
          </div>
        </div>
      </div>

      {planning && draftId && (
        <PlanDialog
          invoiceId={draftId}
          settings={settings}
          firstDue={values.due_date}
          onClose={() => setPlanning(false)}
          onCreated={() => router.push(`/invoices?id=${encodeURIComponent(draftId)}`)}
        />
      )}

      {previewing && draftId && (
        <Sheet open onOpenChange={setPreviewing}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-full! max-w-none! gap-0 bg-panel p-0 sm:w-[min(900px,90vw)]! dark:bg-background"
          >
            <SheetTitle className="sr-only">{translate('pdfPreview')}</SheetTitle>
            <SheetDescription className="sr-only">
              {translate('theDraftAsItWillPrint')}
            </SheetDescription>
            <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border/70 bg-card px-3">
              <span className="ml-1 text-[14px]">{translate('preview')}</span>
              <span className="ml-1.5 text-[13px] text-muted-foreground">
                {pages ? `${pages} ${pages === 1 ? 'page' : 'pages'} · ` : ''}
                {saveState === 'saved'
                  ? translate('asSaved')
                  : translate('savingYourLatestChanges')}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button asChild variant="ghost" className="text-muted-foreground">
                  <a href={localizedHref(pdfUrl(draftId))} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                    {translate('openInNewTab')}
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={localizedHref(pdfUrl(draftId, true))} download>
                    <Download className="size-3.5" />
                    {translate('download3')}
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('closePreview')}
                  onClick={() => setPreviewing(false)}
                >
                  <X />
                </Button>
              </div>
            </div>
            <PdfView
              key={pdfVersion}
              onPages={setPages}
              title={translate('pdfPreview')}
              src={pdfUrl(draftId)}
              className="min-h-0 w-full flex-1"
            />
          </SheetContent>
        </Sheet>
      )}
      {confirming && (
        <ConfirmDialog
          title={translate('issueThis2', { noun: noun })}
          body={
            owedBack
              ? translate('alreadyPaidSoTheyWillBeOwedBackThe', {
                  value1: client?.name ?? translate('theCustomer'),
                  value2: formatMoney(owedBack, values.currency),
                })
              : translate('itGetsTheNextNumberItsPDFIsStored2', {
                  value1: client?.name ?? translate('theClient'),
                  value2: payable === null ? '' : formatMoney(payable, values.currency),
                })
          }
          confirmLabel={translate('issue4', { noun: noun })}
          tone="default"
          onDecide={(approved) => {
            setConfirming(false)
            if (approved) doIssue()
          }}
          alternative={
            owedBack
              ? {
                  label: translate('issueAndRecordRefundNow'),
                  onChoose: () => {
                    setConfirming(false)
                    doIssue(true)
                  },
                }
              : undefined
          }
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={draftId ? translate('deleteThisDraft') : translate('discardThisInvoice')}
          body={translate('whatYouEnteredIsRemovedDraftsHaveNoNumber')}
          confirmLabel={draftId ? translate('deleteDraft2') : translate('discard')}
          tone="destructive"
          onDecide={(approved) => {
            setDeleting(false)
            if (!approved) return
            setSavedPayload(payload)
            if (!draftId) return router.push('/invoices')
            remove.mutate(draftId, {
              onSuccess: () => {
                toast.success(translate('draftDeleted2'))
                router.push('/invoices')
              },
              onError: toastError,
            })
          }}
        />
      )}
    </>
  )
}

const proseInput =
  'w-full resize-none rounded-md bg-transparent px-2 py-1.5 -mx-2 text-[14px] leading-relaxed outline-none transition-colors [field-sizing:content] placeholder:text-placeholder hover:bg-muted/50 focus:bg-card focus:ring-2 focus:ring-ring/40'

function MetaLabel({
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

function TotalLine({
  label,
  value,
  muted,
}: {
  label: string
  value: string | null
  muted?: boolean
}) {
  return (
    <div className={cn('flex justify-between gap-3', muted && 'text-muted-foreground')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value ?? <Loader className="inline-flex min-h-0 w-auto" />}</dd>
    </div>
  )
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-border bg-card px-1.5 py-px font-sans text-[11px]">
        {keys}
      </kbd>
      {children}
    </span>
  )
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'idle') return null
  if (state === 'error')
    return (
      <button
        type="button"
        onClick={onRetry}
        className="mr-1 flex items-center gap-1.5 text-[13px] text-destructive underline underline-offset-2 hover:no-underline"
      >
        <CloudOff className="size-3.5" />
        {translate('notSavedRetry')}
      </button>
    )
  return (
    <output className="mr-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
      {state === 'saving' ? (
        <>
          <LoaderCircle className="size-3.5 animate-spin" />
          {translate('saving2')}
        </>
      ) : state === 'unsaved' ? (
        <>
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
          {translate('editing')}
        </>
      ) : (
        <>
          <Check className="size-3.5" />
          {translate('saved3')}
        </>
      )}
    </output>
  )
}

const PARTY_LABEL = 'text-[12px] font-medium tracking-[0.04em] text-muted-foreground uppercase'

/** "Bill to": the client (with its address as it will print) or the picker. */
function ClientBlock({
  client,
  open,
  locked,
  invalid,
  onOpenChange,
  onPick,
}: {
  client: Client | null
  open: boolean
  locked: boolean
  invalid: boolean
  onOpenChange: (open: boolean) => void
  onPick: (client: Client) => void
}) {
  const lines = client ? addressLines(client) : []
  const [creating, setCreating] = useState(false)
  return (
    <div className="grid content-start gap-2">
      <span className={cn(PARTY_LABEL, invalid && 'text-destructive')}>
        {translate('billTo')}
        <span aria-hidden className="ml-0.5 text-destructive">
          *
        </span>
      </span>
      <Popover open={open && !locked} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild disabled={locked}>
          {client ? (
            <button
              type="button"
              aria-label={translate('clientChangeClient', { name: client.name })}
              className="group relative -mx-3 -my-2 grid w-[calc(100%+24px)] max-w-[344px] rounded-lg p-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:hover:bg-transparent"
            >
              <span className="pr-14 text-[16px] font-medium">{client.name}</span>
              {!locked && (
                <span className="absolute top-3 right-3 text-[12px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {translate('change')}
                </span>
              )}
              {lines.map((line) => (
                <span key={line} className="text-[14px] leading-relaxed">
                  {line}
                </span>
              ))}
              {client.country && (
                <span className="text-[14px] leading-relaxed text-muted-foreground">
                  {countryName(client.country)}
                </span>
              )}
              {client.vat_number && (
                <span className="mt-0.5 font-mono text-[12.5px] text-muted-foreground">
                  {client.vat_number}
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              data-invalid={invalid || undefined}
              className="flex h-[92px] w-full max-w-[320px] items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[14px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground data-invalid:border-destructive/60 data-invalid:text-destructive"
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
      {invalid && (
        <span className="text-[12px] text-destructive">
          {translate('chooseWhoThisInvoiceIsFor')}
        </span>
      )}
      {client?.is_draft && (
        <Callout tone="warning" icon={CircleAlert} className="max-w-sm rounded-lg px-3 py-2">
          <span>
            {translate('theAddressIsIncompleteSoThisCanBeDrafted')}{' '}
            <a
              href={localizedHref(`/clients?id=${encodeURIComponent(client.id)}`)}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4 hover:no-underline"
            >
              {translate('completeIt')}
            </a>
          </span>
        </Callout>
      )}
    </div>
  )
}

function PaymentNote({
  settings,
  ibanValid,
  qrBill,
  revolutUrl,
}: {
  settings: InvoiceSettings
  ibanValid: boolean
  qrBill: boolean
  revolutUrl: string | null
}) {
  return (
    <div className="grid max-w-xs gap-1 text-[12.5px] leading-relaxed text-muted-foreground">
      <span className="text-[11px] font-medium tracking-[0.04em] uppercase">
        {translate('payment')}
      </span>
      {settings.iban ? (
        <>
          <span className="font-mono text-[12px] text-foreground">{formatIban(settings.iban)}</span>
          <span>
            {settings.bank_name}
            {settings.bank_name && ' · '}
            {qrBill
              ? translate('qrBillAttached')
              : ibanValid
                ? translate('bankDetailsPrinted')
                : translate('checkTheIBAN')}
          </span>
        </>
      ) : (
        <Link
          href="/settings/invoices"
          className="inline-flex items-center gap-1 text-link underline underline-offset-2 hover:no-underline"
        >
          {translate('addYourIBANToGetPaid')}
          <ArrowUpRight className="size-3" />
        </Link>
      )}
      {revolutUrl && (
        <span>
          {translate('revolut')}
          {revolutUrl.replace('https://', '')}
        </span>
      )}
    </div>
  )
}
