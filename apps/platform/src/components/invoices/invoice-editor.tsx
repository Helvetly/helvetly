'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Kbd } from '@helvetly/ui/components/kbd'
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
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CloudOff,
  Ellipsis,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileLock2,
  Landmark,
  Link2,
  type LucideIcon,
  Lock,
  LoaderCircle,
  Plus,
  Trash2,
  X,
  ArrowLeft,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Combobox, CURRENCY_OPTIONS } from '@/components/clients/fields'
import { State } from '@/components/data/table-page'
import { RecordLink } from '@/components/record-link'
import { LetterheadLogo } from '@/components/settings/logo-upload'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient, type Client } from '@/lib/clients'
import { linkInvoice, useInvoiceEngagement } from '@/lib/engagements'
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
import { typedPercent } from '@/lib/percent'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'

import type { Compose } from './compose'
import { ContractField } from './contract-field'
import { DateField, DueDateField, quietValue, ServiceField } from './date-fields'
import {
  ClientBlock,
  MetaLabel,
  PARTY_LABEL,
  proseInput,
  SellerBlock,
  TotalLine,
} from './document-parts'
import {
  applyClient,
  changeVatMode,
  emptyValues,
  isBlankLine,
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
import { EngagementLink } from './engagement-link'
import { InstalmentsSection } from './instalments-section'
import { KIND_ICONS } from './invoice-bits'
import { IssueBlockers } from './invoice-dialogs'
import { focusCell, LinesEditor } from './lines-editor'
import { METHOD_ICONS, PaymentToggles } from './payment-methods'
import { PdfView } from './pdf-view'
import { PlanCard } from './plan-card'
import { PlanDialog } from './plan-dialog'
import { PrepaymentPicker } from './prepayment-picker'

const PRECEDING: Partial<Record<InvoiceKind, string>> = {
  credit_note: translate('creditsInvoice'),
  debit_note: translate('debitNoteOnInvoice'),
  corrected: translate('correctsInvoice'),
}

/** Width of the drawer: room for the page and its totals. */
const DRAWER_WIDTH = 'sm:w-[min(1200px,96vw)]!'

/**
 * Creating a document, or editing a draft, in a drawer from the right; the page decides when it is open
 * (?compose= on /invoices, or the older /invoices/new and /invoices/edit URLs).
 */
export function InvoiceEditorDrawer({
  compose,
  onClose,
  onCreated,
}: {
  compose: Compose
  onClose: () => void
  /** After the first save, so the URL carries the draft's id and a reload continues where you were. */
  onCreated: (id: string) => void
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn('w-full! max-w-none! gap-0 bg-panel p-0 dark:bg-background', DRAWER_WIDTH)}
      >
        <SheetTitle className="sr-only">
          {compose.id ? translate('editInvoice') : translate('newInvoice')}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {translate('theDraftAsItWillPrint')}
        </SheetDescription>
        <InvoiceEditorLoader compose={compose} onClose={onClose} onCreated={onCreated} />
      </SheetContent>
    </Sheet>
  )
}

/** Loads what the editor needs: the settings, the draft and a preset client. */
function InvoiceEditorLoader({
  compose: { id, kind, client: clientId },
  onClose,
  onCreated,
}: {
  compose: Compose
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [created, setCreated] = useState<string | null>(null)
  const settings = useInvoiceSettings()
  const invoice = useInvoice(id)
  const preset = useClient(id ? null : clientId)

  if (settings.error || invoice.error)
    return (
      <EditorFrame title={translate('invoice2')} onClose={onClose}>
        <State
          icon={<CloudOff />}
          title={
            invoice.error instanceof ApiError && invoice.error.status === 404
              ? translate('thisInvoiceDoesnTExist')
              : translate('couldnTOpenTheEditor')
          }
          text={errorMessage(invoice.error ?? settings.error)}
          action={
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft />
              {translate('backToInvoices2')}
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
        onClose={onClose}
      >
        <Loader size="page" className="min-h-96" />
      </EditorFrame>
    )
  if (invoice.data && invoice.data.status !== 'draft')
    return <Locked invoice={invoice.data} onClose={onClose} />
  if (invoice.data?.plan?.seq === 0) return <Planned invoice={invoice.data} onClose={onClose} />

  return (
    <Editor
      // The draft made by the first save keeps the same editor (no remount, no lost focus).
      key={id && id !== created ? id : 'new'}
      settings={settings.data}
      invoice={id ? invoice.data : undefined}
      kind={kind}
      client={preset.data ?? null}
      onClose={onClose}
      onCreated={(newId) => {
        // Committed before the URL changes: the router's render must already see this draft as
        // the one being edited, or it would remount the editor mid-typing.
        flushSync(() => setCreated(newId))
        onCreated(newId)
      }}
    />
  )
}

/** The drawer's top bar: the document, then its own controls and the close button. */
function EditorBar({
  title,
  kind = 'invoice',
  status,
  menu,
  actions,
  onClose,
}: {
  title: string
  kind?: InvoiceKind
  /** Before the menu, so the menu sits next to the document's actions. */
  status?: ReactNode
  menu?: ReactNode
  actions?: ReactNode
  onClose: () => void
}) {
  const Icon = KIND_ICONS[kind]
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-card px-3">
      <Icon className="ml-1 size-4 shrink-0 text-muted-foreground" />
      <h2 className="min-w-0 truncate text-body font-medium">{title}</h2>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status}
        {menu && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={translate('more')}>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{translate('more')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-52">
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {actions}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={translate('closeEditor')}
              onClick={onClose}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translate('backToInvoices')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function EditorFrame({
  title,
  kind,
  onClose,
  children,
}: {
  title: string
  kind?: InvoiceKind
  onClose: () => void
  children: ReactNode
}) {
  return (
    <>
      <EditorBar title={title} kind={kind} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </>
  )
}

/** A plan's source draft is its template: locked while the plan issues partials from it. */
function Planned({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const canManage = canManageInvoices(useSession().data?.role)
  return (
    <EditorFrame
      title={translate('draft3', { value1: kindInfo(invoice.kind).label.toLowerCase() })}
      kind={invoice.kind}
      onClose={onClose}
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

function Locked({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  return (
    <EditorFrame title={documentName(invoice)} kind={invoice.kind} onClose={onClose}>
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
  onClose: closeEditor,
  onCreated,
}: {
  settings: InvoiceSettings
  invoice?: Invoice
  kind: InvoiceKind
  client: Client | null
  onClose: () => void
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
  const [engagementId, setEngagementId] = useState('') // chosen before the draft exists
  // The contract row shows once added, and stays while it holds a number or a document.
  const canLinkEngagement = useCan('write:engagements')
  const [contractShown, setContractShown] = useState(false)
  const [engagementShown, setEngagementShown] = useState(false)
  const linkedEngagement = useInvoiceEngagement(canLinkEngagement ? draftId : null).data
  // Optional rows: shown while they hold something or once added; the rest wait under "Add field".
  const showEngagement =
    canLinkEngagement && (engagementShown || Boolean(engagementId) || Boolean(linkedEngagement))
  const showClientNumber = values.client_number_display !== ''
  const showContract =
    contractShown || Boolean(values.contract_reference) || Boolean(values.contract_document)
  const hiddenFields = [
    ...(canLinkEngagement && !showEngagement
      ? [
          {
            id: 'invoice-engagement',
            label: translate('engagement2'),
            show: () => setEngagementShown(true),
          },
        ]
      : []),
    ...(!showClientNumber
      ? [
          {
            id: 'invoice-client_number',
            label: translate('clientNumberShort'),
            show: () => set('client_number_display', null),
          },
        ]
      : []),
    ...(!showContract
      ? [
          {
            id: 'invoice-contract_reference',
            label: translate('contractNumberShort'),
            show: () => setContractShown(true),
          },
        ]
      : []),
  ]
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
  // A notice between the options bar and the page needs a gap; without one the page starts at the bar's line.
  const banner = Boolean((preceding && invoice?.credited_invoice) || reasons?.length)
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
  const [initialPayload] = useState(payload)
  const errors = { ...fromServer, ...converted.errors }
  // The PDF says nothing useful before it names who pays and for what.
  const canPreview = Boolean(
    draftId && values.client_id && values.lines.some((line) => !isBlankLine(line)),
  )

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
  const previewFailed = preview.isError && !totals

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
        if (engagementId)
          void linkInvoice(engagementId, saved.id).then(
            () => setEngagementId(''),
            (error) => toast.error(errorMessage(error)),
          )
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
  // Autosave keeps a draft that has a client and valid fields; anything else typed would be lost on close.
  const unsaved =
    dirty && payload !== initialPayload && !(values.client_id && valid && payload !== failedPayload)
  const [discarding, setDiscarding] = useState<false | 'close' | 'back'>(false)
  // Browser Back with input that cannot be saved: one guard history entry (same state, so Next's own popstate handling
  // stays a no-op) turns the Back into the discard question. Keep editing puts the guard back; Discard lets the Back go on.
  const guarded = useRef(false)
  // The input the person agreed to discard with Back: that departure may leave the page, and the tab-close warning
  // must not ask again. It covers only that input (the raw values: every edit makes new ones, even when two invalid
  // entries would save alike): a Back that went nowhere (first history entry, a blocked departure)
  // leaves the editor open, and any new edit is warned about again. A later popstate means the page stayed.
  const leaving = useRef<EditorValues | null>(null)
  useEffect(() => {
    if (!unsaved || guarded.current) return
    window.history.pushState(window.history.state, '', window.location.href)
    guarded.current = true
  }, [unsaved])
  const back = useEffectEvent(() => {
    leaving.current = null
    if (!guarded.current) return
    guarded.current = false
    if (unsaved) setDiscarding('back')
    else window.history.back() // nothing left to lose: the Back goes on
  })
  useEffect(() => {
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  // Every other way out first removes the guard entry, so it never leaves a duplicate step behind.
  const onClose = () => {
    if (!guarded.current) return closeEditor()
    guarded.current = false
    window.addEventListener('popstate', closeEditor, { once: true })
    window.history.back()
  }
  const warn = useEffectEvent((event: BeforeUnloadEvent) => {
    if (leaving.current !== values && (unsaved || (dirty && values.client_id)))
      event.preventDefault()
  })
  useEffect(() => {
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // ⌘S saves now.
  const saveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    // ⌘P shows our PDF instead of printing the editor page.
    if (event.key === 'p' && canPreview) {
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

  const cancel = () => (unsaved ? setDiscarding('close') : onClose())
  // Esc is the close button too: it asks before throwing typed work away.
  useSheetEscape(cancel)

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
    // "Add at least one line": the empty first row is where the line goes.
    if (target.field === 'add-line') return focusCell(values.lines[0]?.key ?? '', 'description')
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
      <EditorBar
        title={title}
        kind={kind}
        onClose={cancel}
        menu={
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 /> {draftId ? translate('deleteDraft2') : translate('discard')}
          </DropdownMenuItem>
        }
        status={<SaveIndicator state={saveState} onRetry={() => void persist().catch(() => {})} />}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A span keeps the tooltip working while the button is disabled. */}
                <span tabIndex={canPreview ? undefined : 0}>
                  <Button
                    variant="ghost"
                    disabled={!canPreview}
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setPreviewing(true)}
                  >
                    <Eye className="size-4" />
                    {/* Phones keep the bar to one row with Close in reach: the label stays for screen readers. */}
                    <span className="max-sm:sr-only">{translate('preview3')}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {canPreview ? (
                  <span className="flex items-center gap-2">
                    {translate('thePDFAsItWillPrint')}
                    <Kbd>{translate('p')}</Kbd>
                  </span>
                ) : (
                  translate('previewNeedsClientAndLine')
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
          </>
        }
      />

      {/* From md up the document options stay above and the internal note below, and only the document scrolls;
          on a phone everything scrolls together, so the pinned bars never cover the page. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:scroll-py-2 max-md:overflow-y-auto">
        <div className="shrink-0 border-b border-border/60 px-3 py-3 sm:px-6">
          <div className="mx-auto w-full max-w-[1040px]">
            {/* One row on a phone, scrolled sideways, instead of three stacked rows above the page. */}
            <div className="flex items-center gap-2 max-sm:-mx-3 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:px-3 max-sm:py-1 max-sm:*:shrink-0 sm:flex-wrap sm:justify-center">
              {credit ? (
                <span className="text-body-sm text-muted-foreground">
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
                size="sm"
                label={translate('documentLanguage')}
                value={values.language}
                options={LANGUAGE_CHOICES}
                onChange={(language) => set('language', language)}
              />
              {!credit && (
                <Segmented
                  size="sm"
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
          </div>
        </div>
        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
          <div
            ref={top}
            className={cn(
              '@container min-w-0 flex-1 scroll-mt-16 px-3 pb-8 sm:px-6',
              // The page starts at the options bar's line; only a notice above it needs the gap.
              banner && 'pt-4',
            )}
          >
            <div className="mx-auto grid w-full max-w-[1040px] grid-cols-[minmax(0,1fr)] gap-4">
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

              <article
                aria-label={title}
                // A flat page: lines run to the edges of the work area (the container's padding is cancelled).
                className={cn(
                  'relative left-1/2 w-[calc(100cqw+1.5rem)] -translate-x-1/2 border bg-card px-5 py-8 sm:w-[calc(100cqw+3rem)] sm:px-10 sm:py-10',
                  !banner && 'border-t-0',
                )}
              >
                {/* Letterhead: logo left; title and dates right. */}
                {/* Letterhead: logo left, title right; below it seller, client and dates side by side. */}
                <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                  <LetterheadLogo url={logoSrc(settings)} canEdit={canManage} />
                  <div className="grid justify-items-end gap-1 text-right max-sm:justify-items-start max-sm:text-left">
                    <h1 className="text-display leading-none font-medium tracking-[-0.025em]">
                      {kindInfo(kind).label}
                    </h1>
                    <span className="text-body-sm text-muted-foreground">
                      {translate('noAssignedWhenIssued')}
                    </span>
                  </div>
                </header>

                <div className="mt-10 grid gap-8 md:grid-cols-2 @4xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <SellerBlock settings={settings} label={translate('billedBy')} />
                  <ClientBlock
                    label={translate('billedTo')}
                    missing={translate('chooseWhoThisInvoiceIsFor')}
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
                  <dl className="grid w-full max-w-[300px] grid-cols-[92px_minmax(0,1fr)] content-start items-center gap-x-2 gap-y-0.5 self-start text-left text-body-sm md:col-span-2 @4xl:col-span-1">
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
                      tip={translate('theDayOrPeriodYouDeliveredPrintedOn')}
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
                      <p className="col-span-2 px-2 pt-1 text-caption text-destructive">
                        {errors.issue_date ??
                          errors.due_date ??
                          errors.reference ??
                          errors.tax_currency_rate}
                      </p>
                    )}
                  </dl>
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
                    amountsFailed={previewFailed}
                    errors={errors}
                    onChange={(lines) => set('lines', lines)}
                    currency={values.currency}
                  />
                </div>

                <div className="mt-6 flex flex-wrap items-start justify-between gap-8">
                  <div className="grid w-full max-w-sm content-start gap-8">
                    <PaymentNote
                      settings={settings}
                      ibanValid={iban.valid}
                      qrBill={totals?.payment.qr_bill ?? false}
                      revolutUrl={totals?.payment.revolut_url ?? null}
                    />
                    <div className="grid content-start gap-2.5 text-body-sm">
                      <span className={PARTY_LABEL}>{translate('details')}</span>
                      <dl className="grid w-full max-w-[320px] grid-cols-[112px_minmax(0,1fr)] content-start items-center gap-x-2 gap-y-0.5 text-left text-body-sm">
                        {showEngagement && (
                          <>
                            <MetaLabel htmlFor="invoice-engagement" error={undefined}>
                              {translate('engagement2')}
                            </MetaLabel>
                            <dd className="flex min-w-0 items-center gap-0.5">
                              <span className="min-w-0 flex-1">
                                <EngagementLink
                                  id="invoice-engagement"
                                  clientId={values.client_id ?? ''}
                                  invoiceId={draftId}
                                  pending={engagementId}
                                  onPendingChange={setEngagementId}
                                />
                              </span>
                              {/* A linked engagement is removed with its own ×; hiding is for an empty row. */}
                              {!linkedEngagement && (
                                <HideField
                                  label={translate('hideEngagement')}
                                  onHide={() => {
                                    setEngagementId('')
                                    setEngagementShown(false)
                                  }}
                                />
                              )}
                            </dd>
                          </>
                        )}
                        {showClientNumber && (
                          <>
                            <MetaLabel
                              htmlFor="invoice-client_number"
                              error={errors.client_number_display}
                            >
                              {translate('clientNumberShort')}
                            </MetaLabel>
                            <dd className="flex min-w-0 items-center gap-0.5">
                              <input
                                id="invoice-client_number"
                                value={values.client_number_display ?? ''}
                                maxLength={40}
                                onChange={(event) =>
                                  set('client_number_display', event.target.value || null)
                                }
                                placeholder={client ? String(client.number) : '—'}
                                className={cn(
                                  quietValue,
                                  'min-w-0 flex-1',
                                  // linked: the client's own number reads as the value, not as a hint
                                  values.client_number_display === null &&
                                    'placeholder:text-foreground',
                                )}
                              />
                              {client &&
                                (values.client_number_display === null ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Link
                                        href={`/clients?id=${encodeURIComponent(client.id)}`}
                                        aria-label={translate('clientNumberLinked', {
                                          name: client.name,
                                        })}
                                        className="grid size-6 shrink-0 place-items-center rounded-md text-brand hover:bg-muted"
                                      >
                                        <Link2 className="size-3.5" />
                                      </Link>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {translate('clientNumberLinked', { name: client.name })}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={translate('clientNumberUseClients')}
                                        className="shrink-0 text-muted-foreground"
                                        onClick={() => set('client_number_display', null)}
                                      >
                                        <Link2 />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {translate('clientNumberUseClients')}
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              <HideField
                                label={translate('clientNumberHide')}
                                onHide={() => set('client_number_display', '')}
                              />
                            </dd>
                          </>
                        )}
                        {showContract && (
                          <>
                            <MetaLabel
                              htmlFor="invoice-contract_reference"
                              error={errors.contract_reference ?? errors.contract_document_id}
                            >
                              {translate('contractNumberShort')}
                            </MetaLabel>
                            <dd className="flex min-w-0 items-center gap-0.5">
                              <span className="min-w-0 flex-1">
                                <ContractField
                                  id="invoice-contract_reference"
                                  value={values.contract_reference}
                                  document={values.contract_document}
                                  onChange={(value) => set('contract_reference', value)}
                                  onLink={(document) => set('contract_document', document)}
                                />
                              </span>
                              <HideField
                                label={translate('hideContractNumber')}
                                onHide={() => {
                                  setValues((current) => ({
                                    ...current,
                                    contract_reference: '',
                                    contract_document: null,
                                  }))
                                  setContractShown(false)
                                }}
                              />
                            </dd>
                          </>
                        )}
                        {hiddenFields.length > 0 && (
                          <dd className="col-span-2 pt-0.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="-ml-2 gap-1 text-muted-foreground"
                                >
                                  <Plus />
                                  {translate('addField')}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {hiddenFields.map((field) => (
                                  <DropdownMenuItem
                                    key={field.id}
                                    onSelect={() => {
                                      field.show()
                                      requestAnimationFrame(() =>
                                        document.getElementById(field.id)?.focus(),
                                      )
                                    }}
                                  >
                                    {field.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </dd>
                        )}
                        {(errors.client_number_display ||
                          errors.contract_reference ||
                          errors.contract_document_id) && (
                          <p className="col-span-2 px-2 pt-1 text-caption text-destructive">
                            {errors.client_number_display ??
                              errors.contract_reference ??
                              errors.contract_document_id}
                          </p>
                        )}
                      </dl>
                    </div>
                  </div>
                  <dl
                    aria-busy={preview.isFetching}
                    className={cn(
                      'grid w-full gap-2 text-body transition-opacity sm:w-[320px]',
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
                        {translate('discount2')}
                        <span className="relative">
                          <input
                            id="invoice-discount_percent"
                            aria-label={translate('discountOnTheWholeDocumentPercent')}
                            aria-invalid={errors.discount_percent ? true : undefined}
                            inputMode="decimal"
                            disabled={credit}
                            value={values.discount_percent}
                            onChange={(event) =>
                              set(
                                'discount_percent',
                                typedPercent(event.target.value, values.discount_percent),
                              )
                            }
                            placeholder="0"
                            className="h-7 w-14 rounded-md bg-muted/60 pr-5 pl-2 text-right text-body-sm tabular-nums outline-none focus:bg-card focus:ring-2 focus:ring-ring/40 aria-invalid:ring-2 aria-invalid:ring-destructive/40"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-caption text-muted-foreground">
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
                      <dt className="text-body font-medium">
                        {translate('total2')}
                        {values.currency}
                        {values.vat_mode === 'inclusive' && (
                          <span className="font-normal text-muted-foreground">
                            {translate('inclVAT2')}
                          </span>
                        )}
                      </dt>
                      <dd className="text-page font-medium tracking-[-0.02em] tabular-nums">
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
                        failed={previewFailed}
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
                    className={cn(proseInput, 'text-body-sm text-muted-foreground')}
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
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-border/60 px-3 py-3 sm:px-6">
          <div className="mx-auto grid w-full max-w-[1040px] gap-2">
            <section className="grid gap-1.5 rounded-xl px-1">
              <label
                htmlFor="invoice-note"
                className="flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground"
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
                rows={1}
                className="[field-sizing:content] max-h-32 w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-body leading-relaxed shadow-xs outline-none placeholder:text-placeholder focus:border-ring focus:ring-2 focus:ring-ring/40"
              />
            </section>

            <p className="hidden flex-wrap justify-center gap-x-4 gap-y-1 text-caption text-muted-foreground md:flex">
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
              <span className="ml-1 text-body">{translate('preview')}</span>
              <span className="ml-1.5 text-body-sm text-muted-foreground">
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
      {discarding && (
        <ConfirmDialog
          title={translate('discardYourChanges')}
          body={translate('whatYouEnteredInThisFormWillBeLost')}
          confirmLabel={translate('discard')}
          cancelLabel={translate('keepEditing')}
          tone="destructive"
          onDecide={(discard) => {
            const wasBack = discarding === 'back'
            setDiscarding(false)
            if (discard && wasBack) {
              leaving.current = values
              return window.history.back()
            }
            if (discard) return onClose()
            if (wasBack) {
              window.history.pushState(window.history.state, '', window.location.href)
              guarded.current = true
            }
          }}
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
            if (!draftId) return onClose()
            remove.mutate(draftId, {
              onSuccess: () => {
                toast.success(translate('draftDeleted2'))
                onClose()
              },
              onError: toastError,
            })
          }}
        />
      )}
    </>
  )
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{keys}</Kbd>
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
        className="mr-1 flex items-center gap-1.5 text-body-sm text-destructive underline underline-offset-2 hover:no-underline"
      >
        <CloudOff className="size-3.5" />
        {translate('notSavedRetry')}
      </button>
    )
  return (
    <output className="mr-1 flex items-center gap-1.5 text-body-sm text-muted-foreground">
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
        <span className="flex items-center gap-1.5 font-medium text-success">
          <Check className="size-3.5" />
          {translate('saved3')}
        </span>
      )}
    </output>
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
    <div className="grid w-full max-w-sm content-start gap-2.5 text-body-sm leading-snug">
      <span className={PARTY_LABEL}>{translate('payment')}</span>
      {settings.iban ? (
        <ul className="grid gap-2">
          <PaymentRow
            icon={ibanValid ? Landmark : CircleAlert}
            invalid={!ibanValid}
            title={<span className="font-mono tracking-tight">{formatIban(settings.iban)}</span>}
            detail={ibanValid ? settings.bank_name : translate('checkTheIBAN')}
          />
          {qrBill && <PaymentRow icon={METHOD_ICONS.qr_bill} title={translate('swissQRBill')} />}
          {revolutUrl && (
            <PaymentRow
              icon={METHOD_ICONS.revolut}
              title={translate('revolut2')}
              detail={revolutUrl.replace('https://', '')}
            />
          )}
        </ul>
      ) : (
        <Link
          href="/settings/company?focus=iban#bank"
          className="inline-flex items-center gap-1 text-link underline underline-offset-2 hover:no-underline"
        >
          {translate('addYourIBANToGetPaid')}
          <ArrowUpRight className="size-3" />
        </Link>
      )}
    </div>
  )
}

function PaymentRow({
  icon: Icon,
  title,
  detail,
  invalid = false,
}: {
  icon: LucideIcon
  title: ReactNode
  detail?: string | null
  invalid?: boolean
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground',
          invalid && 'border-destructive/40 bg-destructive/5 text-destructive',
        )}
      >
        <Icon aria-hidden className="size-4 stroke-[1.5]" />
      </span>
      <span className="grid min-w-0">
        <span className="truncate text-foreground">{title}</span>
        {detail && (
          <span className={cn('truncate text-muted-foreground', invalid && 'text-destructive')}>
            {detail}
          </span>
        )}
      </span>
    </li>
  )
}

/** Hides an optional row of the document's details; it comes back under "Add field". */
function HideField({ label, onHide }: { label: string; onHide: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="shrink-0 text-muted-foreground"
          onClick={onHide}
        >
          <EyeOff />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
