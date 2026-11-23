'use client'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { ClientDetail, type ClientCommand } from '@/components/clients/client-detail'
import { ClientForm } from '@/components/clients/client-form'
import { Preview } from '@/components/documents/preview'
import { EngagementDetail } from '@/components/engagements/engagement-detail'
import { EngagementForm } from '@/components/engagements/engagement-form'
import { ExpenseDetail, type ExpenseCommand } from '@/components/expenses/expense-detail'
import { ExpenseForm } from '@/components/expenses/expense-form'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { handOffImport } from '@/components/import/hand-off'
import { useInvoiceCommands } from '@/components/invoices/invoice-commands'
import { InvoiceDetail } from '@/components/invoices/invoice-detail'
import { InvoiceEditorDrawer } from '@/components/invoices/invoice-editor'
import { ProductForm } from '@/components/products/product-form'
import { productDefaults } from '@/components/products/product-form-model'
import { QuoteDetail } from '@/components/quotes/quote-detail'
import { NewQuoteSheet } from '@/components/quotes/quote-editor'
import { SessionDrawer } from '@/components/scheduling/session-drawer'
import { RequestDrawer } from '@/components/signatures/request-drawer'
import { canDeleteClients, useDeleteClient, useSaveClient, type Client } from '@/lib/clients'
import {
  canManageExpenses,
  expensesApi,
  useBulkExpenses,
  useExpenseAction,
  type Expense,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { canManageInvoices, useInvoiceSettings } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import { getWorkspaceTimezone } from '@/lib/timezone'

import {
  drawerKey,
  nextStack,
  onOwnPage,
  parseDrawerKey,
  RecordDrawersContext,
  RecordPageContext,
  recordPageHref,
  RecordReplaceContext,
  type CreateRef,
  type DrawerRef,
  type EditRef,
  type RecordRef,
} from './record-link'

/**
 * Records opened from another record (or from anywhere outside their own page), and new records' forms,
 * show as drawers stacked on top of the screen; closing one uncovers the one below. The stack is in the
 * address (`?drawer=`), so a reload or coming back to the page shows it again; another page clears it.
 */
export function RecordDrawers({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<StackEntry[]>(readStack)
  const latest = useRef(stack)
  const router = useRouter()
  const pathname = usePathname()
  const [shownOn, setShownOn] = useState(pathname)
  const [arrived, setArrived] = useState(false)
  if (shownOn !== pathname) {
    setShownOn(pathname)
    setStack([])
    setArrived(true)
  }
  // The router writes the new page's address after rendering it, so its stack is read once that is done.
  useEffect(() => {
    if (!arrived) return
    latest.current = readStack()
    setStack(latest.current)
    setArrived(false)
  }, [arrived])

  const commit = useCallback((next: StackEntry[]) => {
    latest.current = next
    setStack(next)
    markInAddress(next)
  }, [])
  const open = useCallback(
    (record: DrawerRef) => {
      const here = window.location.pathname + window.location.search
      // On its own page with nothing stacked, a form is the page's own (its list knows of it).
      if ('mode' in record && latest.current.length === 0 && onOwnPage(record, here))
        return router.push(recordPageHref(record))
      commit(nextStack(latest.current, record, here))
    },
    [commit, router],
  )
  const leave = useCallback(() => commit([]), [commit])
  const replaceAt = useCallback(
    (index: number, record: DrawerRef) => {
      const here = latest.current[index]
      if (!here) return
      commit([...latest.current.slice(0, index), { ...record, slot: here.slot ?? drawerKey(here) }])
    },
    [commit],
  )
  const closeAt = useCallback((index: number) => commit(latest.current.slice(0, index)), [commit])

  return (
    <RecordDrawersContext.Provider value={open}>
      {children}
      {stack.map((record, index) => (
        <StackedRecord
          // A record shown in place of another keeps the slot's key: its drawer stays open (no flicker).
          key={record.slot ?? drawerKey(record)}
          record={record}
          index={index}
          open={open}
          replaceAt={replaceAt}
          leave={leave}
          onClose={() => closeAt(index)}
        />
      ))}
    </RecordDrawersContext.Provider>
  )
}

/** A stacked drawer; `slot` is the key of the one it replaced in place, if any. */
type StackEntry = DrawerRef & { slot?: string }

// The static export renders without a window: nothing is stacked there.
function readStack(): StackEntry[] {
  if (typeof window === 'undefined') return []
  const query = new URLSearchParams(window.location.search)
  // `?open=invoice:inv_1` is the deep link's spelling; the stack writes itself back as `?drawer=`.
  return [...query.getAll('drawer'), ...query.getAll('open')]
    .map(parseDrawerKey)
    .filter((record) => record !== null)
}

/** Writes the stack into the address through the history API: a router navigation would re-render the page under it. */
function markInAddress(stack: DrawerRef[]) {
  const query = new URLSearchParams(window.location.search)
  query.delete('drawer')
  query.delete('open')
  for (const record of stack) query.append('drawer', drawerKey(record))
  const search = query.size > 0 ? `?${query}` : ''
  if (search === window.location.search) return
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + search + window.location.hash,
  )
}

/** One drawer of the stack, telling what it shows which record page it stands for. */
function StackedRecord({
  record,
  index,
  open,
  replaceAt,
  leave,
  onClose,
}: {
  record: DrawerRef
  index: number
  open: (record: DrawerRef) => void
  replaceAt: (index: number, record: DrawerRef) => void
  leave: () => void
  onClose: () => void
}) {
  const page = useMemo(() => ({ href: recordPageHref(record), leave }), [record, leave])
  const replace = useCallback((next: DrawerRef) => replaceAt(index, next), [replaceAt, index])
  return (
    <RecordPageContext.Provider value={page}>
      <RecordReplaceContext.Provider value={replace}>
        {'mode' in record ? (
          <RecordForm record={record} replace={replace} onClose={onClose} />
        ) : (
          <RecordDrawer record={record} open={open} onClose={onClose} />
        )}
      </RecordReplaceContext.Provider>
    </RecordPageContext.Provider>
  )
}

const WRITE_NEED = {
  invoice: 'write:invoices',
  quote: 'write:invoices',
  client: 'write:clients',
  engagement: 'write:engagements',
  expense: 'write:expenses',
  product: 'write:products',
} as const

/** A new record's form (or a draft's editor) in place; once saved, the drawer shows the record. */
function RecordForm({
  record,
  replace,
  onClose,
}: {
  record: CreateRef | EditRef
  replace: (record: DrawerRef) => void
  onClose: () => void
}) {
  const allowed = useCan(WRITE_NEED[record.kind])
  const router = useRouter()
  if (!allowed) return null
  const client = record.mode === 'new' ? (record.client ?? null) : null
  if (record.kind === 'invoice')
    return (
      <InvoiceEditorDrawer
        compose={{ id: record.mode === 'edit' ? record.id : null, kind: 'invoice', client }}
        onClose={onClose}
        // The draft made by the first save stays in the editor, as on the invoices page.
        onCreated={(id) => replace({ kind: 'invoice', mode: 'edit', id })}
      />
    )
  if (record.kind === 'quote')
    return (
      <NewQuoteSheet
        clientId={client}
        onClose={onClose}
        onSaved={(quote) => replace({ kind: 'quote', id: quote.id })}
      />
    )
  if (record.kind === 'client')
    return (
      <ClientForm
        onClose={onClose}
        onSaved={(saved, created) =>
          created ? replace({ kind: 'client', id: saved.id }) : onClose()
        }
      />
    )
  if (record.kind === 'expense')
    return (
      <ExpenseForm
        start
        onImport={(files) => {
          // One expense per file is the AI import's, which lives on the expenses page.
          handOffImport('expenses', files)
          onClose()
          router.push('/expenses?import=1')
        }}
        onClose={onClose}
        onSaved={(saved, created) =>
          created ? replace({ kind: 'expense', id: saved.id }) : onClose()
        }
      />
    )
  if (record.kind === 'engagement') return <NewEngagement replace={replace} onClose={onClose} />
  return <NewProduct onClose={onClose} />
}

/** The engagement form closes itself after saving; the drawer then shows the engagement instead. */
function NewEngagement({
  replace,
  onClose,
}: {
  replace: (record: DrawerRef) => void
  onClose: () => void
}) {
  const saved = useRef(false)
  return (
    <EngagementForm
      open
      onOpenChange={(isOpen) => !isOpen && !saved.current && onClose()}
      onSaved={(engagement) => {
        saved.current = true
        replace({ kind: 'engagement', id: engagement.id })
      }}
    />
  )
}

/** Products have no drawer outside their page: saving closes the form. */
function NewProduct({ onClose }: { onClose: () => void }) {
  const settings = useInvoiceSettings()
  if (!settled(settings))
    return <FormSheetLoading title={translate('newProductOrService')} onClose={onClose} />
  return (
    <ProductForm defaults={productDefaults(settings.data)} onClose={onClose} onSaved={onClose} />
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
  if (record.kind === 'session')
    return <StackedSession id={record.id} open={open} onClose={onClose} />
  return <EngagementDetail id={record.id} onOpenChange={(isOpen) => !isOpen && onClose()} />
}

function StackedSession({
  id,
  open,
  onClose,
}: {
  id: string
  open: (record: RecordRef) => void
  onClose: () => void
}) {
  const [now] = useState(() => new Date())
  return (
    <SessionDrawer
      target={{ kind: 'view', id }}
      zone={getWorkspaceTimezone()}
      now={now}
      onClose={onClose}
      onView={(next) => open({ kind: 'session', id: next })}
    />
  )
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
            toast.success(
              `${client.name} ${client.is_active ? translate('deactivated') : translate('activated')}.`,
            ),
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
        toast.success(translate('deleted3', { name: target.name }))
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
          title={translate('delete4', { name: deleting.name })}
          body={translate('invoicesAndDocumentsThatMentionThemKeepTheirCopy')}
          confirmLabel={translate('deleteClient')}
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
        onSuccess: (saved) => toast.success(translate('expenseBooked', { number: saved.number })),
        onError: toastError,
      })
    else if (name === 'duplicate')
      duplicate.mutate(expense.id, {
        onSuccess: (copy) => {
          toast.success(translate('copiedAsDraft', { number: copy.number }))
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
        extract: page,
        openFolder: (folder) =>
          router.push(folder ? `/documents?${new URLSearchParams({ folder })}` : '/documents'),
      }}
      onNavigate={() => {}}
      onClose={onClose}
    />
  )
}
