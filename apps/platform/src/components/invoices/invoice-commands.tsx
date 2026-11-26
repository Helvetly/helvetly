'use client'
import { localizedHref } from '@helvetly/i18n'
import type { Action, ActionGroup, ActionMenuSpec } from '@helvetly/ui/components/action-menu'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  Ban,
  Copy,
  Download,
  FileMinus,
  FilePen,
  FilePlus,
  CalendarRange,
  PanelRightOpen,
  Pencil,
  Send,
  Stamp,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { featureLock, lockedAction } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { useOpenHref } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { isApprovalRequired, toastApprovalRequired } from '@/lib/approvals'
import { useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  cannotIssueReasons,
  documentName,
  invoicesApi,
  isPositive,
  isReceivable,
  kindInfo,
  pdfUrl,
  useCreditNote,
  useDeleteInvoice,
  useDuplicateInvoice,
  useInvoiceAction,
  useInvoiceSettings,
  useIssueInvoice,
  useVoidInvoice,
  type Invoice,
  type InvoiceListItem,
  type IssueReason,
} from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

import { editHref } from './compose'
import { IssueBlockersDialog, PaymentDialog, RefundDialog, SendDialog } from './invoice-dialogs'
import { PlanDialog } from './plan-dialog'

export type InvoiceCommand =
  | 'open'
  | 'edit'
  | 'issue'
  | 'send'
  | 'payment'
  | 'refund'
  | 'duplicate'
  | 'credit_note'
  | DeriveCommand
  | 'void'
  | 'delete'
  | 'plan'

/** Commands that make a new draft from an issued document and open it in the editor. */
type DeriveCommand = 'correct' | 'debit_note' | 'convert_invoice' | 'convert_prepayment'

const DERIVE: Record<
  DeriveCommand,
  { title: (name: string) => string; body: string; confirmLabel: string; done: string }
> = {
  correct: {
    title: (name) => translate('correct2', { name: name }),
    body: translate('aDraftCorrectedInvoiceWithTheSameLinesOpens'),
    confirmLabel: translate('createCorrection'),
    done: translate('draftCorrectionCreatedFixWhatWasWrongThenIssue'),
  },
  debit_note: {
    title: (name) => translate('chargeMoreOn', { name: name }),
    body: translate('aDraftDebitNoteForThisInvoiceOpensIn'),
    confirmLabel: translate('createDebitNote'),
    done: translate('draftDebitNoteCreatedAddTheLinesThenIssue'),
  },
  convert_invoice: {
    title: (name) => translate('convertToAnInvoice', { name: name }),
    body: translate('aDraftInvoiceWithTheClientAndLinesOf'),
    confirmLabel: translate('convertToInvoice2'),
    done: translate('draftInvoiceCreatedFromTheProforma'),
  },
  convert_prepayment: {
    title: (name) => translate('convertToAPrepaymentInvoice', { name: name }),
    body: translate('aDraftPrepaymentInvoiceWithTheClientAndLines'),
    confirmLabel: translate('convertToPrepayment2'),
    done: translate('draftPrepaymentInvoiceCreatedFromTheProforma'),
  },
}
const isDerive = (command: InvoiceCommand): command is DeriveCommand => command in DERIVE

const deriveApi = ({ command, id }: { command: DeriveCommand; id: string }) =>
  command === 'correct'
    ? invoicesApi.correct(id)
    : command === 'debit_note'
      ? invoicesApi.debitNote(id)
      : invoicesApi.convert(id, command === 'convert_invoice' ? 'invoice' : 'prepayment')

/** A list row, or the full invoice (the drawer), which also knows its plan and schedule. */
type CommandTarget = InvoiceListItem & Partial<Pick<Invoice, 'plan' | 'instalments'>>

/** What can be done to an invoice in its state (the drawer's and the row's menus). */
export function availableCommands(invoice: CommandTarget, canManage: boolean) {
  // A plan's source draft is its template: the server refuses edits, issue and delete (409 planned).
  const planned = invoice.plan?.seq === 0
  const draft = invoice.status === 'draft'
  const editable = draft && !planned
  const open = invoice.status === 'open'
  const issued = open || invoice.status === 'paid'
  const receivable = isReceivable(invoice.kind)
  const proforma = invoice.kind === 'proforma'
  // Self-billed invoices are paid out by the workspace; proforma and credit notes take no payments.
  const payable = receivable || invoice.kind === 'self_billed'
  return {
    edit: editable,
    issue: editable,
    send: issued,
    payment: open && payable && isPositive(invoice.amount_due),
    duplicate: ['invoice', 'partial', 'prepayment', 'proforma', 'self_billed'].includes(
      invoice.kind,
    ),
    refund: receivable && isPositive(invoice.refund_due),
    credit_note: receivable && issued,
    correct: receivable && issued,
    debit_note: receivable && issued,
    convert_invoice: proforma && open,
    convert_prepayment: proforma && open,
    // The server also refuses invoices with payments (409); the drawer knows, the list does not.
    void: canManage && invoice.kind !== 'credit_note' && open,
    delete: editable,
    // A draft has a schedule or a plan, never both; list rows don't know which, so only the drawer offers it.
    plan: editable && receivable && invoice.kind !== 'corrected' && invoice.instalments === null,
  }
}

const fail = toastError
const NOTHING: InvoiceCommand[] = []

/** Runs invoice commands from anywhere: confirmations, dialogs and toasts included. */
export function useInvoiceCommands(onOpen: (id: string) => void) {
  // In a stacked drawer the editor takes the invoice's place, as the invoices page does.
  const openHref = useOpenHref(true)
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<{
    command: InvoiceCommand
    invoice: InvoiceListItem
  } | null>(null)
  const [blocked, setBlocked] = useState<{
    invoice: InvoiceListItem
    reasons: IssueReason[]
  } | null>(null)
  const issue = useIssueInvoice()
  const duplicate = useDuplicateInvoice()
  const creditNote = useCreditNote()
  const derive = useInvoiceAction(deriveApi)
  const voidInvoice = useVoidInvoice()
  const remove = useDeleteInvoice()
  const close = () => setPending(null)
  // Each of these makes a new draft on the server: a second click (or a reopened menu) while one is out is ignored.
  const creating = useRef(false)
  const once = (start: (settled: () => void) => void) => {
    if (creating.current) return
    creating.current = true
    start(() => {
      creating.current = false
    })
  }

  const run = (command: InvoiceCommand, invoice: InvoiceListItem) => {
    if (command === 'open') return onOpen(invoice.id)
    if (command === 'edit') return openHref(editHref(invoice.id))
    if (command === 'duplicate')
      return once((settled) =>
        duplicate.mutate(invoice.id, {
          onSuccess: (copy) => {
            toast.success(translate('copiedIntoANewDraftFor', { name: copy.client.name }))
            openHref(editHref(copy.id))
          },
          onError: toastError,
          onSettled: settled,
        }),
      )
    setPending({ command, invoice })
  }

  const confirmIssue = (invoice: InvoiceListItem) =>
    issue.mutate(invoice.id, {
      onSuccess: (issued) => toast.success(translate('issued2', { value1: documentName(issued) })),
      onError: (error) => {
        const reasons = cannotIssueReasons(error)
        if (isApprovalRequired(error)) toastApprovalRequired(queryClient, invoice.id)
        else if (reasons) setBlocked({ invoice, reasons })
        else toast.error(errorMessage(error))
      },
    })

  const decide = (approved: boolean) => {
    const current = pending
    close()
    if (!approved || !current) return
    const { command, invoice } = current
    if (command === 'issue') confirmIssue(invoice)
    if (command === 'credit_note')
      once((settled) =>
        creditNote.mutate(invoice.id, {
          onSuccess: (note) => {
            toast.success(translate('draftCreditNoteCreatedAdjustTheLinesThenIssue'))
            openHref(editHref(note.id))
          },
          onError: fail,
          onSettled: settled,
        }),
      )
    if (isDerive(command))
      once((settled) =>
        derive.mutate(
          { command, id: invoice.id },
          {
            onSuccess: (made) => {
              toast.success(DERIVE[command].done)
              openHref(editHref(made.id))
            },
            onError: fail,
            onSettled: settled,
          },
        ),
      )
    if (command === 'void')
      voidInvoice.mutate(
        { id: invoice.id },
        {
          onSuccess: (voided) =>
            toast.success(translate('isVoid', { value1: documentName(voided) })),
          onError: fail,
        },
      )
    if (command === 'delete')
      remove.mutate(invoice.id, {
        onSuccess: () => toast.success(translate('draftDeleted2')),
        onError: fail,
      })
  }

  const confirm = (props: {
    title: string
    body: string
    confirmLabel: string
    destructive?: boolean
    confirmIcon?: ReactNode
  }) => (
    <ConfirmDialog
      title={props.title}
      body={props.body}
      confirmLabel={props.confirmLabel}
      tone={props.destructive ? 'destructive' : 'default'}
      confirmIcon={props.confirmIcon}
      onDecide={decide}
    />
  )

  let dialog: ReactNode = null
  if (pending) {
    const { command, invoice } = pending
    const name = documentName(invoice)
    if (command === 'send') dialog = <SendDialog invoice={invoice} onClose={close} />
    if (command === 'payment') dialog = <PaymentDialog invoice={invoice} onClose={close} />
    if (command === 'refund') dialog = <RefundDialog invoice={invoice} onClose={close} />
    if (command === 'plan')
      dialog = (
        <PlanCommand
          invoice={invoice}
          onClose={close}
          onCreated={() => {
            close()
            onOpen(invoice.id)
          }}
        />
      )
    if (command === 'issue')
      dialog = confirm({
        title: translate('issueThis', { value1: kindInfo(invoice.kind).label.toLowerCase() }),
        body: translate('itGetsTheNextNumberItsPDFIsStored'),
        confirmLabel: translate('issue3'),
      })
    if (command === 'credit_note')
      dialog = confirm({
        title: translate('credit', { name: name }),
        body: translate('aDraftCreditNoteForTheFullAmountOpens'),
        confirmLabel: translate('createCreditNote2'),
      })
    if (isDerive(command))
      dialog = confirm({
        title: DERIVE[command].title(name),
        body: DERIVE[command].body,
        confirmLabel: DERIVE[command].confirmLabel,
      })
    if (command === 'void')
      dialog = confirm({
        title: translate('void4', { name: name }),
        body: translate('aFullCreditNoteIsIssuedAgainstItAnd'),
        confirmLabel: translate('voidInvoice'),
        destructive: true,
        confirmIcon: <Ban />,
      })
    if (command === 'delete')
      dialog = confirm({
        title: translate('deleteThisDraft'),
        body: translate('theDraftForIsRemovedForGoodDraftsHave', { name: invoice.client.name }),
        confirmLabel: translate('deleteDraft2'),
        destructive: true,
      })
  }

  return {
    run,
    busy:
      issue.isPending ||
      duplicate.isPending ||
      creditNote.isPending ||
      derive.isPending ||
      voidInvoice.isPending,
    dialogs: (
      <>
        {dialog}
        {blocked && (
          <IssueBlockersDialog
            reasons={blocked.reasons}
            clientId={blocked.invoice.client.id}
            editHref={editHref(blocked.invoice.id)}
            onClose={() => setBlocked(null)}
          />
        )}
      </>
    ),
  }
}

/** The plan dialog once the settings (its defaults) are loaded; fetched only when asked for. */
function PlanCommand({
  invoice,
  onClose,
  onCreated,
}: {
  invoice: InvoiceListItem
  onClose: () => void
  onCreated: () => void
}) {
  const settings = useInvoiceSettings().data
  return settings ? (
    <PlanDialog
      invoiceId={invoice.id}
      settings={settings}
      firstDue={invoice.due_date}
      onClose={onClose}
      onCreated={onCreated}
    />
  ) : null
}

/** What the menus need beyond the invoice: write access and the plan's locks. Stable while billing is. */
export function useInvoiceActionState() {
  const writable = useCan('write:invoices')
  const billing = useBilling().data
  return useMemo(
    () => ({
      writable,
      corrections: featureLock(billing, 'invoice_corrections'),
      instalments: featureLock(billing, 'automations'),
    }),
    [writable, billing],
  )
}

export type InvoiceActionState = ReturnType<typeof useInvoiceActionState>

/**
 * The actions for `invoice` (row "…", right-click and drawer "…"); `skip` leaves out those shown
 * as buttons beside the menu.
 */
export function invoiceActions({
  invoice,
  canManage,
  state: { writable, corrections, instalments },
  run,
  skip = NOTHING,
  showOpen = false,
}: {
  invoice: CommandTarget
  canManage: boolean
  state: InvoiceActionState
  run: (command: InvoiceCommand, invoice: InvoiceListItem) => void
  skip?: InvoiceCommand[]
  showOpen?: boolean
}): ActionMenuSpec['actions'] {
  const available = availableCommands(invoice, canManage)
  const show = (command: keyof typeof available) =>
    writable && available[command] && !skip.includes(command)
  const action = (
    command: keyof typeof available,
    group: ActionGroup,
    icon: ReactNode,
    label: string,
    more: Partial<Action> = {},
  ): Action | false =>
    show(command) && {
      id: command,
      group,
      icon,
      label,
      onSelect: () => run(command, invoice),
      ...more,
    }
  return [
    showOpen && {
      id: 'open',
      group: 'view',
      icon: <PanelRightOpen />,
      label: translate('openDetails'),
      onSelect: () => run('open', invoice),
    },
    {
      id: 'pdf',
      group: 'view',
      icon: <Download />,
      label: translate('downloadPDF2'),
      href: localizedHref(pdfUrl(invoice.id, true)),
      download: true,
    },
    action(
      'send',
      'send',
      <Send />,
      invoice.sent_at ? translate('sendAgain') : translate('sendByEmail'),
    ),
    action('issue', 'status', <Stamp />, translate('issue2'), { tone: 'success' }),
    action('payment', 'status', <Wallet />, translate('recordPayment'), { tone: 'success' }),
    action('refund', 'status', <Undo2 />, translate('recordRefund')),
    action('void', 'status', <Ban />, translate('void3'), {
      tone: 'destructive',
      ...lockedAction(corrections),
    }),
    action('edit', 'edit', <Pencil />, translate('editDraft')),
    action('duplicate', 'edit', <Copy />, translate('duplicate')),
    action(
      'plan',
      'edit',
      <CalendarRange />,
      translate('splitIntoInstalmentInvoices2'),
      lockedAction(instalments),
    ),
    action('convert_invoice', 'create', <ArrowRightLeft />, translate('convertToInvoice')),
    action('convert_prepayment', 'create', <ArrowRightLeft />, translate('convertToPrepayment')),
    action('correct', 'create', <FilePen />, translate('correct'), lockedAction(corrections)),
    action('debit_note', 'create', <FilePlus />, translate('debitNote'), lockedAction(corrections)),
    action(
      'credit_note',
      'create',
      <FileMinus />,
      translate('createCreditNote'),
      lockedAction(corrections),
    ),
    action('delete', 'danger', <Trash2 />, translate('deleteDraft')),
  ]
}
