'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { Loader } from '@helvetly/ui/components/loader'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  CircleCheck,
  Landmark,
  ListTodo,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import { Money } from '@/components/invoices/invoice-bits'
import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { DEFAULT_PARAMS, dueLabel, isPositive, invoiceListQuery, today } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

import { useLegalFormMissing, useMonthsToClose, useVatReturnDue } from './attention'
import {
  DUE_SOON_DAYS,
  MONEY_GROUPS,
  moneyGroups,
  totalsByCurrency,
  type MoneyGroup,
  type MoneyRow,
} from './attention-groups'
import { DashboardCard, TONES, type Tone } from './dashboard-card'

// Open invoices and money owed back to customers; the card groups and orders them itself.
const ATTENTION = {
  ...DEFAULT_PARAMS,
  status: ['open' as const, 'refund_due' as const],
  kind: 'invoice' as const,
  sort: 'next_due_date' as const,
  desc: false,
  // The most the API gives in one page: groups count and total what they show.
  pageSize: 200,
}

/** Rows a group shows before "N more": enough to act on, short enough to see every group. */
const COLLAPSED = 3

const monthYear = new Intl.DateTimeFormat(languageTag, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthLabel = (month: string) => monthYear.format(new Date(`${month}-01T00:00:00Z`))

const GROUP_LABELS: Record<MoneyGroup, () => string> = {
  overdue: () => translate('attentionGroupOverdue'),
  instalments: () => translate('attentionGroupInstalments'),
  refunds: () => translate('attentionGroupRefunds'),
  dueSoon: () => translate('attentionGroupDueSoon', { days: DUE_SOON_DAYS }),
}

/**
 * The workspace's to-do list in groups, most important first: tasks from the books and settings,
 * then overdue invoices, instalments, refunds owed and invoices due soon, each with its count and
 * total, long groups folded to their first rows.
 */
export function NeedsAttention({ className }: { className?: string }) {
  const canReadInvoices = useCan('read:invoices')
  const vat = useVatReturnDue()
  const closing = useMonthsToClose()
  const legalForm = useLegalFormMissing()
  const invoices = useQuery({ ...invoiceListQuery(ATTENTION), enabled: canReadInvoices })
  const groups = moneyGroups(invoices.data?.data ?? [], today())
  const months = closing.value ?? []
  const tasks: TaskProps[] = [
    ...(vat.value
      ? [
          {
            id: 'vat',
            href: '/books/vat-return',
            icon: Landmark,
            tone: 'warning' as const,
            title: translate('vatReturnPeriod', { period: vat.value.period }),
            side: `${dueLabel(vat.value.due)} · ${formatDate(vat.value.due)}`,
          },
        ]
      : []),
    ...months.map((month) => ({
      id: month,
      href: '/books',
      icon: Lock,
      tone: 'info' as const,
      title: translate('monthsAreReadyToClose', { months: monthLabel(month), length: 1 }),
      side: translate('closeTheMonth', { length: 1 }),
    })),
    ...(legalForm
      ? [
          {
            id: 'legal-form',
            href: '/settings/company?focus=seller.legal_form#company',
            icon: Building2,
            tone: 'brand' as const,
            title: translate('addYourCompanysLegalForm'),
            side: translate('legalFormMissingBody'),
          },
        ]
      : []),
  ]
  const pending =
    vat.pending || closing.pending || (canReadInvoices && !invoices.data && !invoices.error)
  const loaded = invoices.data?.data.length ?? 0
  const total = invoices.data?.meta?.total ?? loaded
  const empty = tasks.length === 0 && MONEY_GROUPS.every((group) => groups[group].length === 0)

  return (
    <DashboardCard
      title={translate('needsAttention')}
      icon={ListTodo}
      tone="warning"
      help={translate('needsAttentionHelp')}
      viewAll={
        canReadInvoices
          ? {
              href: '/invoices?status=open&status=refund_due&kind=invoice',
              label: translate('allThatNeedsAttention').trim(),
            }
          : undefined
      }
      className={className}
    >
      {vat.error && (
        <SourceError
          message={translate('theVATReturnCouldnTBeChecked')}
          error={vat.error}
          retry={translate('retryVATReturn')}
          onRetry={vat.retry}
        />
      )}
      {closing.error && (
        <SourceError
          message={translate('closingCouldnTBeChecked')}
          error={closing.error}
          retry={translate('retryClosing')}
          onRetry={closing.retry}
        />
      )}
      {invoices.error && (
        <SourceError
          message={translate('openInvoicesCouldnTBeLoaded')}
          error={invoices.error}
          retry={translate('retryInvoices')}
          onRetry={() => void invoices.refetch()}
        />
      )}
      {pending ? (
        <Loader className="min-h-72" />
      ) : empty ? (
        !vat.error &&
        !closing.error &&
        !invoices.error && (
          <EmptyState
            icon={CircleCheck}
            title={translate('allDoneNothingNeedsYourAttention')}
            description={translate('nothingNeedsAttentionBody')}
            className="my-auto"
          />
        )
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 px-1.5 pb-3">
          {tasks.length > 0 && (
            <Group
              id="tasks"
              label={translate('attentionGroupTasks')}
              items={tasks}
              itemKey={(task) => task.id}
            >
              {(task) => <TaskRow {...task} />}
            </Group>
          )}
          {MONEY_GROUPS.map(
            (group) =>
              groups[group].length > 0 && (
                <Group
                  key={group}
                  id={group}
                  label={GROUP_LABELS[group]()}
                  items={groups[group]}
                  itemKey={(row) => `${row.invoice.id}-${row.instalment?.seq ?? ''}`}
                  total={<GroupTotal rows={groups[group]} />}
                >
                  {(row) => <MoneyRowLink row={row} />}
                </Group>
              ),
          )}
          {total > loaded && (
            <p className="px-3 text-xs text-muted-foreground">
              {translate('attentionPartial', { shown: loaded, total })}
            </p>
          )}
        </div>
      )}
    </DashboardCard>
  )
}

/** A titled group: its name, count and total, its first rows and "N more" to unfold the rest. */
function Group<T>({
  id,
  label,
  items,
  itemKey,
  total,
  children,
}: {
  id: string
  label: string
  items: T[]
  itemKey: (item: T) => string
  total?: ReactNode
  children: (item: T) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, COLLAPSED)
  const hidden = items.length - shown.length
  const headingId = `attention-${id}`
  const listId = `${headingId}-rows`
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 grid-cols-1 gap-0.5">
      <div className="flex items-baseline gap-2 px-3 pt-1 pb-0.5 text-xs text-muted-foreground">
        <h3 id={headingId} className="font-medium text-foreground/80">
          {label}
        </h3>
        <span className="rounded-full bg-muted px-1.5 tabular-nums">{items.length}</span>
        {total && items.length > 1 && <span className="ml-auto text-right">{total}</span>}
      </div>
      <ul id={listId} className="grid min-w-0 grid-cols-1">
        {shown.map((item) => (
          <li key={itemKey(item)}>{children(item)}</li>
        ))}
      </ul>
      {items.length > COLLAPSED && (
        <Button
          variant="link"
          size="xs"
          aria-expanded={open}
          aria-controls={listId}
          className="justify-self-start px-3 font-normal text-muted-foreground"
          onClick={() => setOpen(!open)}
        >
          {open
            ? translate('attentionShowLess')
            : translate('attentionShowMore', { count: hidden })}
        </Button>
      )}
    </section>
  )
}

const ROW =
  'flex min-h-10 items-center gap-3 rounded-lg px-3 py-1.5 text-body-sm transition-colors duration-150 hover:bg-muted/60'

type TaskProps = {
  id: string
  href: string
  icon: LucideIcon
  tone: Tone
  title: string
  side: string
}

/** A to-do from the books or settings: a small tinted icon, what to do and when. */
function TaskRow({ href, icon: Icon, tone, title, side }: TaskProps) {
  return (
    <Link href={href} className={ROW}>
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md',
          TONES[tone].tile,
        )}
      >
        <Icon className="size-3.5 stroke-[1.75]" />
      </span>
      <span className="min-w-0 truncate">{title}</span>
      <span className="ml-auto flex min-w-0 shrink items-center gap-2 text-muted-foreground">
        <span className="truncate @max-sm:hidden">{side}</span>
        <ArrowRight aria-hidden className="size-3.5 shrink-0 stroke-[1.5]" />
      </span>
    </Link>
  )
}

/** One invoice, instalment or refund on one line: client, number, when, how much. */
function MoneyRowLink({ row: { invoice, due, amount, instalment } }: { row: MoneyRow }) {
  const overdue = instalment ? instalment.is_overdue : due < today()
  const refund = isPositive(invoice.refund_due)
  const when = instalment
    ? `${translate('importInstalmentN', { n: instalment.seq })} · ${dueLabel(due).toLowerCase()}`
    : refund
      ? translate('toRefund')
      : dueLabel(due)
  return (
    <RecordLink href={`/invoices?id=${encodeURIComponent(invoice.id)}`} className={ROW}>
      <span className="grid min-w-0 flex-1 leading-tight @xl:flex @xl:items-baseline @xl:gap-2">
        <span className="truncate">{invoice.client.name}</span>
        <span className="truncate text-muted-foreground">
          <span className="font-code">{invoice.number}</span>
          <span className="@xl:hidden"> · {when}</span>
        </span>
      </span>
      <span
        className={cn(
          'min-w-0 shrink truncate text-right @max-xl:hidden',
          overdue && !refund ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {when}
      </span>
      <Money value={amount} currency={invoice.currency} className="shrink-0 text-right" />
    </RecordLink>
  )
}

/** "CHF 1’240.00", or each currency's total when a group mixes them. */
function GroupTotal({ rows }: { rows: MoneyRow[] }) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-x-2">
      {totalsByCurrency(rows).map(({ currency, amount }) => (
        <Money key={currency} value={amount} currency={currency} className="text-foreground/80" />
      ))}
    </span>
  )
}

/** One source of the list failed: say which, offer a retry, and keep showing the others. */
function SourceError({
  message,
  error,
  retry,
  onRetry,
}: {
  message: string
  error: Error
  retry: string
  onRetry: () => void
}) {
  return (
    <div className="mx-4 mb-2 grid justify-items-start gap-3 rounded-lg bg-muted/50 p-3">
      <p role="alert" className="text-sm text-muted-foreground">
        {message}
        {errorMessage(error)}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retry}
      </Button>
    </div>
  )
}
