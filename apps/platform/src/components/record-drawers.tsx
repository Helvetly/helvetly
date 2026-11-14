'use client'

import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { ClientDetail, type ClientCommand } from '@/components/clients/client-detail'
import { ClientForm } from '@/components/clients/client-form'
import { Preview } from '@/components/documents/preview'
import { EngagementDetail } from '@/components/engagements/engagement-detail'
import { ExpenseDetail, type ExpenseCommand } from '@/components/expenses/expense-detail'
import { useInvoiceCommands } from '@/components/invoices/invoice-commands'
import { InvoiceDetail } from '@/components/invoices/invoice-detail'
import { QuoteDetail } from '@/components/quotes/quote-detail'
import { RequestDrawer } from '@/components/signatures/request-drawer'
import { canDeleteClients, useDeleteClient, useSaveClient, type Client } from '@/lib/clients'
import {
  canManageExpenses,
  expensesApi,
  useBulkExpenses,
  useExpenseAction,
  type Expense,
} from '@/lib/expenses'
import { canManageInvoices } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'

import {
  nextStack,
  RecordDrawersContext,
  RecordPageContext,
  recordPageHref,
  type RecordRef,
} from './record-link'

/**
 * Records opened from another record (or from anywhere outside their own page) show as drawers
 * stacked on top of the screen; closing one uncovers the one below. A page change clears them.
 */
export function RecordDrawers({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<RecordRef[]>([])
  const pathname = usePathname()
  const [shownOn, setShownOn] = useState(pathname)
  if (shownOn !== pathname) {
    setShownOn(pathname)
    setStack([])
  }
  const open = useCallback(
    (record: RecordRef) =>
      setStack((current) =>
        nextStack(current, record, window.location.pathname + window.location.search),
      ),
    [],
  )

  return (
    <RecordDrawersContext.Provider value={open}>
      {children}
      {stack.map((record, index) => (
        <RecordPageContext.Provider
          key={`${record.kind}:${record.id}`}
          value={{ href: recordPageHref(record), leave: () => setStack([]) }}
        >
          <RecordDrawer
            record={record}
            open={open}
            onClose={() => setStack((current) => current.slice(0, index))}
          />
        </RecordPageContext.Provider>
      ))}
    </RecordDrawersContext.Provider>
  )
}

function RecordDrawer({
  record,
  open,
  onClose,
}: {
  record: RecordRef
  open: (record: RecordRef) => void
  onClose: () => void
}) {
  if (record.kind === 'invoice')
    return <StackedInvoice id={record.id} open={open} onClose={onClose} />
  if (record.kind === 'quote') return <QuoteDetail id={record.id} onClose={onClose} />
  if (record.kind === 'client') return <StackedClient id={record.id} onClose={onClose} />
  if (record.kind === 'expense')
    return <StackedExpense id={record.id} open={open} onClose={onClose} />
  if (record.kind === 'document') return <StackedDocument id={record.id} onClose={onClose} />
  if (record.kind === 'signature') return <RequestDrawer id={record.id} onClose={onClose} />
  return <EngagementDetail id={record.id} onOpenChange={(isOpen) => !isOpen && onClose()} />
}

function StackedInvoice({
  id,
  open,
  onClose,
}: {
  id: string
  open: (record: RecordRef) => void
  onClose: () => void
}) {
  const canManage = canManageInvoices(useSession().data?.role)
  const commands = useInvoiceCommands((next) => open({ kind: 'invoice', id: next }))
  return (
    <>
      <InvoiceDetail
        id={id}
        canManage={canManage}
        onClose={onClose}
        run={commands.run}
        busy={commands.busy}
      />
      {commands.dialogs}
    </>
  )
}

/** The client drawer with the same commands as on the clients page: edit, activate and delete. */
function StackedClient({ id, onClose }: { id: string; onClose: () => void }) {
  const role = useSession().data?.role
  const canDelete = useCan('write:clients') && canDeleteClients(role)
  const [form, setForm] = useState<{ client: Client; focus?: 'address' } | null>(null)
  const [deleting, setDeleting] = useState<Client | null>(null)
  const save = useSaveClient()
  const remove = useDeleteClient()

  const command = (name: ClientCommand, client: Client) => {
    if (name === 'edit') setForm({ client })
    if (name === 'complete') setForm({ client, focus: 'address' })
    if (name === 'delete') setDeleting(client)
    if (name === 'toggle')
      save.mutate(
        { id: client.id, input: { is_active: !client.is_active } },
        {
          onSuccess: () =>
            toast.success(`${client.name} ${client.is_active ? 'deactivated' : 'activated'}.`),
          onError: toastError,
        },
      )
  }
  const confirmDelete = (approved: boolean) => {
    const target = deleting
    setDeleting(null)
    if (!approved || !target) return
    remove.mutate(target.id, {
      onSuccess: () => {
        toast.success(`${target.name} deleted.`)
        onClose()
      },
      onError: toastError,
    })
  }

  return (
    <>
      <ClientDetail id={id} canDelete={canDelete} onClose={onClose} onCommand={command} />
      {form && (
        <ClientForm
          client={form.client}
          focus={form.focus}
          onClose={() => setForm(null)}
          onSaved={() => setForm(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="Invoices and documents that mention them keep their copy of the details. This can’t be undone here."
          confirmLabel="Delete client"
          tone="destructive"
          onDecide={confirmDelete}
        />
      )}
    </>
  )
}

/**
 * The expense drawer in place: booking, the payment marks and duplicating run here; editing, voiding
 * and deleting need the expenses page's forms and dialogs, so they go there with the drawer open.
 */
function StackedExpense({
  id,
  open,
  onClose,
}: {
  id: string
  open: (record: RecordRef) => void
  onClose: () => void
}) {
  const canManage = canManageExpenses(useSession().data?.role)
  const router = useRouter()
  const bulk = useBulkExpenses()
  const book = useExpenseAction((expenseId: string) => expensesApi.book(expenseId))
  const duplicate = useExpenseAction((expenseId: string) => expensesApi.duplicate(expenseId))
  const command = (name: ExpenseCommand, expense: Expense) => {
    if (name === 'book')
      book.mutate(expense.id, {
        onSuccess: (saved) => toast.success(`Expense #${saved.number} booked.`),
        onError: toastError,
      })
    else if (name === 'duplicate')
      duplicate.mutate(expense.id, {
        onSuccess: (copy) => {
          toast.success(`Copied as draft #${copy.number}.`)
          open({ kind: 'expense', id: copy.id })
        },
        onError: toastError,
      })
    else if (name === 'mark_paid' || name === 'mark_unpaid' || name === 'mark_reimbursed')
      bulk.mutate({ ids: [expense.id], action: name }, { onError: toastError })
    else router.push(recordPageHref({ kind: 'expense', id: expense.id }))
  }
  return <ExpenseDetail id={id} canManage={canManage} onClose={onClose} onCommand={command} />
}

/** A document's preview in place; changing the file (rename, move, sign…) happens on its Documents page. */
function StackedDocument({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter()
  const page = () => router.push(recordPageHref({ kind: 'document', id }))
  return (
    <Preview
      id={id}
      siblings={[]}
      commands={{
        rename: page,
        move: page,
        copy: page,
        trash: page,
        restore: page,
        link: page,
        unlink: page,
        sign: page,
        openFolder: (folder) =>
          router.push(folder ? `/documents?${new URLSearchParams({ folder })}` : '/documents'),
      }}
      onNavigate={() => {}}
      onClose={onClose}
    />
  )
}
