'use client'

import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
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
import { useRouter } from 'next/navigation'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import type { MenuKit } from '@/components/data/menus'
import { errorMessage } from '@/lib/api'
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
    title: (name) => `Correct ${name}?`,
    body: 'A draft corrected invoice with the same lines opens in the editor. Once it is issued, it replaces this one and the payments move over.',
    confirmLabel: 'Create correction',
    done: 'Draft correction created. Fix what was wrong, then issue it.',
  },
  debit_note: {
    title: (name) => `Charge more on ${name}?`,
    body: 'A draft debit note for this invoice opens in the editor. Add the extra lines, then issue it.',
    confirmLabel: 'Create debit note',
    done: 'Draft debit note created. Add the lines, then issue it.',
  },
  convert_invoice: {
    title: (name) => `Convert ${name} to an invoice?`,
    body: 'A draft invoice with the client and lines of this proforma opens in the editor. The proforma stays as it is.',
    confirmLabel: 'Convert to invoice',
    done: 'Draft invoice created from the proforma.',
  },
  convert_prepayment: {
    title: (name) => `Convert ${name} to a prepayment invoice?`,
    body: 'A draft prepayment invoice with the client and lines of this proforma opens in the editor. The proforma stays as it is.',
    confirmLabel: 'Convert to prepayment',
    done: 'Draft prepayment invoice created from the proforma.',
  },
}
const isDerive = (command: InvoiceCommand): command is DeriveCommand => command in DERIVE

const deriveApi = ({ command, id }: { command: DeriveCommand; id: string }) =>
  command === 'correct'
    ? invoicesApi.correct(id)
    : command === 'debit_note'
      ? invoicesApi.debitNote(id)
      : invoicesApi.convert(id, command === 'convert_invoice' ? 'invoice' : 'prepayment')

export const editHref = (id: string) => `/invoices/edit?id=${encodeURIComponent(id)}`

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
    send: !draft,
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
    plan: editable && receivable && invoice.instalments === null,
  }
}

const fail = toastError
const NOTHING: InvoiceCommand[] = []

/** Runs invoice commands from anywhere: confirmations, dialogs and toasts included. */
export function useInvoiceCommands(onOpen: (id: string) => void) {
  const router = useRouter()
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
    if (command === 'edit') return router.push(editHref(invoice.id))
    if (command === 'duplicate')
      return once((settled) =>
        duplicate.mutate(invoice.id, {
          onSuccess: (copy) => {
            toast.success(`Copied into a new draft for ${copy.client.name}.`)
            router.push(editHref(copy.id))
          },
          onError: toastError,
          onSettled: settled,
        }),
      )
    setPending({ command, invoice })
  }

  const confirmIssue = (invoice: InvoiceListItem) =>
    issue.mutate(invoice.id, {
      onSuccess: (issued) => toast.success(`${documentName(issued)} issued.`),
      onError: (error) => {
        const reasons = cannotIssueReasons(error)
        if (reasons) setBlocked({ invoice, reasons })
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
            toast.success('Draft credit note created. Adjust the lines, then issue it.')
            router.push(editHref(note.id))
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
              router.push(editHref(made.id))
            },
            onError: fail,
            onSettled: settled,
          },
        ),
      )
    if (command === 'void')
      voidInvoice.mutate(
        { id: invoice.id },
        { onSuccess: (voided) => toast.success(`${documentName(voided)} is void.`), onError: fail },
      )
    if (command === 'delete')
      remove.mutate(invoice.id, { onSuccess: () => toast.success('Draft deleted.'), onError: fail })
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
        title: `Issue this ${kindInfo(invoice.kind).label.toLowerCase()}?`,
        body: `It gets the next number, its PDF is stored and it can no longer be edited. Corrections then go through a credit note.`,
        confirmLabel: 'Issue',
      })
    if (command === 'credit_note')
      dialog = confirm({
        title: `Credit ${name}?`,
        body: 'A draft credit note for the full amount opens in the editor. Reduce the lines for a partial credit, then issue it.',
        confirmLabel: 'Create credit note',
      })
    if (isDerive(command))
      dialog = confirm({
        title: DERIVE[command].title(name),
        body: DERIVE[command].body,
        confirmLabel: DERIVE[command].confirmLabel,
      })
    if (command === 'void')
      dialog = confirm({
        title: `Void ${name}?`,
        body: 'A full credit note is issued against it and nothing is owed any more. This can’t be undone.',
        confirmLabel: 'Void invoice',
        destructive: true,
        confirmIcon: <Ban />,
      })
    if (command === 'delete')
      dialog = confirm({
        title: 'Delete this draft?',
        body: `The draft for ${invoice.client.name} is removed for good. Drafts have no number, so nothing goes missing in your numbering.`,
        confirmLabel: 'Delete draft',
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

/**
 * The menu items for `invoice` (row "…", right-click and drawer "…"); `skip` leaves out the
 * primary action.
 */
export function CommandItems({
  kit: { Item, Separator },
  invoice,
  canManage,
  run,
  skip = NOTHING,
  showOpen = false,
}: {
  kit: MenuKit
  invoice: CommandTarget
  canManage: boolean
  run: (command: InvoiceCommand, invoice: InvoiceListItem) => void
  skip?: InvoiceCommand[]
  showOpen?: boolean
}) {
  const available = availableCommands(invoice, canManage)
  const writable = useCan('write:invoices')
  const show = (command: keyof typeof available) =>
    writable && available[command] && !skip.includes(command)
  return (
    <>
      {showOpen && (
        <Item onSelect={() => run('open', invoice)}>
          <PanelRightOpen /> Open details
        </Item>
      )}
      {show('edit') && (
        <Item onSelect={() => run('edit', invoice)}>
          <Pencil /> Edit draft
        </Item>
      )}
      {show('issue') && (
        <Item onSelect={() => run('issue', invoice)}>
          <Stamp /> Issue
        </Item>
      )}
      {show('send') && (
        <Item onSelect={() => run('send', invoice)}>
          <Send /> {invoice.sent_at ? 'Send again' : 'Send by email'}
        </Item>
      )}
      {show('refund') && (
        <Item onSelect={() => run('refund', invoice)}>
          <Undo2 /> Record refund
        </Item>
      )}
      {show('payment') && (
        <Item onSelect={() => run('payment', invoice)}>
          <Wallet /> Record payment
        </Item>
      )}
      <Item asChild>
        <a href={pdfUrl(invoice.id, true)} download>
          <Download /> Download PDF
        </a>
      </Item>
      {show('duplicate') && (
        <Item onSelect={() => run('duplicate', invoice)}>
          <Copy /> Duplicate
        </Item>
      )}
      {show('plan') && (
        <Item onSelect={() => run('plan', invoice)}>
          <CalendarRange /> Split into instalment invoices
        </Item>
      )}
      {(show('convert_invoice') || show('convert_prepayment')) && <Separator />}
      {show('convert_invoice') && (
        <Item onSelect={() => run('convert_invoice', invoice)}>
          <ArrowRightLeft /> Convert to invoice
        </Item>
      )}
      {show('convert_prepayment') && (
        <Item onSelect={() => run('convert_prepayment', invoice)}>
          <ArrowRightLeft /> Convert to prepayment
        </Item>
      )}
      {(show('credit_note') ||
        show('correct') ||
        show('debit_note') ||
        show('void') ||
        show('delete')) && <Separator />}
      {show('correct') && (
        <Item onSelect={() => run('correct', invoice)}>
          <FilePen /> Correct
        </Item>
      )}
      {show('debit_note') && (
        <Item onSelect={() => run('debit_note', invoice)}>
          <FilePlus /> Debit note
        </Item>
      )}
      {show('credit_note') && (
        <Item onSelect={() => run('credit_note', invoice)}>
          <FileMinus /> Create credit note
        </Item>
      )}
      {show('void') && (
        <Item variant="destructive" onSelect={() => run('void', invoice)}>
          <Ban /> Void
        </Item>
      )}
      {show('delete') && (
        <Item variant="destructive" onSelect={() => run('delete', invoice)}>
          <Trash2 /> Delete draft
        </Item>
      )}
    </>
  )
}
