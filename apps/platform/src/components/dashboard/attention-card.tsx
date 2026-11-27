'use client'
import { languageTag } from '@helvetly/i18n'
import { Badge, TONES as BADGE_TONES, type Tone as BadgeTone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  ListTodo,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Money } from '@/components/invoices/invoice-bits'
import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { DEFAULT_PARAMS, dueLabel, invoiceListQuery, today } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

import { useLegalFormMissing, useMonthsToClose, useVatReturnDue } from './attention'
import {
  DUE_SOON_DAYS,
  MONEY_GROUPS,
  moneyGroups,
  totalsByCurrency,
  fitRows,
  type MoneyGroup,
  type MoneyRow,
} from './attention-groups'
import { DashboardCard } from './dashboard-card'

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

const monthYear = new Intl.DateTimeFormat(languageTag, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthLabel = (month: string) => monthYear.format(new Date(`${month}-01T00:00:00Z`))

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
            title: translate('vatReturnPeriod', { period: vat.value.period }),
            side: `${dueLabel(vat.value.due)} · ${formatDate(vat.value.due)}`,
          },
        ]
      : []),
    ...months.map((month) => ({
      id: month,
      href: '/books',
      title: translate('monthsAreReadyToClose', { months: monthLabel(month), length: 1 }),
      side: translate('closeTheMonth', { length: 1 }),
    })),
    ...(legalForm
      ? [
          {
            id: 'legal-form',
            href: '/settings/company?focus=seller.legal_form#company',
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

  const sections: Section[] = [
    ...(tasks.length > 0
      ? [
          {
            id: 'tasks',
            meta: TASKS_META,
            rows: tasks.map((task) => ({ key: task.id, node: <TaskRow {...task} /> })),
          },
        ]
      : []),
    ...MONEY_GROUPS.filter((group) => groups[group].length > 0).map((group) => ({
      id: group,
      meta: GROUP_META[group],
      total: <GroupTotal rows={groups[group]} />,
      rows: groups[group].map((row) => ({
        key: `${row.invoice.id}-${row.instalment?.seq ?? ''}`,
        node: <MoneyRowLink row={row} group={group} />,
      })),
    })),
  ]
  const [drawer, setDrawer] = useState(false)
  const partial = total > loaded && (
    <p className="px-3 text-xs text-muted-foreground">
      {translate('attentionPartial', { shown: loaded, total })}
    </p>
  )

  return (
    <DashboardCard
      title={translate('needsAttention')}
      icon={ListTodo}
      tone="warning"
      help={translate('needsAttentionHelp')}
      actions={
        sections.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="font-normal text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setDrawer(true)}
          >
            {translate('viewAll')}
            <span className="sr-only">: {translate('allThatNeedsAttention').trim()}</span>
            <ArrowRight className="stroke-[1.5]" />
          </Button>
        )
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
        <Loader className="flex-1" />
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
        <FittedGroups sections={sections} onViewAll={() => setDrawer(true)} footer={partial} />
      )}
      {drawer && (
        <AttentionDrawer sections={sections} footer={partial} onClose={() => setDrawer(false)} />
      )}
    </DashboardCard>
  )
}

type GroupMeta = { label: () => string; icon: LucideIcon; tone: BadgeTone }
type Section = {
  id: string
  meta: GroupMeta
  total?: ReactNode
  rows: { key: string; node: ReactNode }[]
}

// Each group its own accent, so the card reads as blocks: to-dos blue, overdue red, instalments amber.
const TASKS_META: GroupMeta = {
  label: () => translate('attentionGroupTasks'),
  icon: ListTodo,
  tone: 'blue',
}
const GROUP_META: Record<MoneyGroup, GroupMeta> = {
  overdue: { label: () => translate('attentionGroupOverdue'), icon: CircleAlert, tone: 'red' },
  instalments: {
    label: () => translate('attentionGroupInstalments'),
    icon: CalendarClock,
    tone: 'amber',
  },
  refunds: { label: () => translate('attentionGroupRefunds'), icon: Undo2, tone: 'violet' },
  dueSoon: {
    label: () => translate('attentionGroupDueSoon', { days: DUE_SOON_DAYS }),
    icon: Clock,
    tone: 'blue',
  },
}

// Fixed heights, so the rows that fit can be counted: a row, and a group's header, padding and divider.
const ROW_HEIGHT = 36
const GROUP_CHROME = 32 + 8 + 1

/**
 * The groups at the card's height: the first rows of each that fit (at most three), never growing
 * the card; "View all" opens the rest in a drawer.
 */
function FittedGroups({
  sections,
  onViewAll,
  footer,
}: {
  sections: Section[]
  onViewAll: () => void
  footer: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [budget, setBudget] = useState(Infinity)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () =>
      setBudget(Math.floor((element.clientHeight - sections.length * GROUP_CHROME) / ROW_HEIGHT))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [sections.length])
  const shown = fitRows(
    sections.map((section) => section.rows.length),
    budget,
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-2">
      <div ref={box} className="min-h-0 flex-1 overflow-hidden">
        {sections.map((section, i) => (
          <Group
            key={section.id}
            section={section}
            rows={section.rows.slice(0, shown[i])}
            onViewAll={section.rows.length > (shown[i] ?? 0) ? onViewAll : undefined}
          />
        ))}
      </div>
      {footer}
    </div>
  )
}

/** Everything that needs attention, every row of every group, over the dashboard. */
function AttentionDrawer({
  sections,
  footer,
  onClose,
}: {
  sections: Section[]
  footer: ReactNode
  onClose: () => void
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(560px,calc(100vw-6rem))]! dark:bg-card"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div className="grid gap-0.5">
            <SheetTitle className="text-lg font-semibold">{translate('needsAttention')}</SheetTitle>
            <SheetDescription className="text-body-sm text-muted-foreground">
              {translate('needsAttentionHelp')}
            </SheetDescription>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={translate('close')} onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="@container min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {sections.map((section) => (
            <Group key={section.id} section={section} rows={section.rows} />
          ))}
          {footer}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** A group as its own block: accent icon, bold name, count and total, then its rows. */
function Group({
  section: { id, meta, total, rows: all },
  rows,
  onViewAll,
}: {
  section: Section
  rows: Section['rows']
  onViewAll?: () => void
}) {
  const headingId = `attention-${id}`
  const Icon = meta.icon
  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 grid-cols-1 border-t py-1 first:border-t-0"
    >
      <div className="flex h-8 items-center gap-2 px-3">
        <span
          aria-hidden
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-md',
            BADGE_TONES[meta.tone],
          )}
        >
          <Icon className="size-3 stroke-2" />
        </span>
        <h3 id={headingId} className="truncate text-body-sm font-semibold">
          {meta.label()}
        </h3>
        <Badge size="sm" tone={meta.tone}>
          {all.length}
        </Badge>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-body-sm">
          {total && all.length > 1 && <span className="font-medium tabular-nums">{total}</span>}
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="inline-flex items-center gap-1 rounded-sm text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {translate('attentionViewAllCount', { count: all.length })}
              <ArrowRight aria-hidden className="size-3 stroke-[1.5]" />
            </button>
          )}
        </span>
      </div>
      <ul className="grid min-w-0 grid-cols-1">
        {rows.map((row) => (
          <li key={row.key}>{row.node}</li>
        ))}
      </ul>
    </section>
  )
}

const ROW =
  'flex h-9 items-center gap-3 rounded-lg px-3 text-body-sm transition-colors duration-150 hover:bg-muted/60'

type TaskProps = {
  id: string
  href: string
  title: string
  side: string
}

/** A to-do from the books or settings: what to do, then its action as a quiet link. */
function TaskRow({ href, title, side }: TaskProps) {
  return (
    <Link href={href} className={cn(ROW, 'group/row')}>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="flex min-w-0 shrink items-center gap-1 text-caption text-muted-foreground underline-offset-4 group-hover/row:text-foreground group-hover/row:underline">
        <span className="truncate @max-sm:sr-only">{side}</span>
        <ArrowRight aria-hidden className="size-3 shrink-0 stroke-[1.5]" />
      </span>
    </Link>
  )
}

/** One invoice, instalment or refund: client and number, its status as a small badge, the amount. */
function MoneyRowLink({
  row: { invoice, due, amount, instalment },
  group,
}: {
  row: MoneyRow
  group: MoneyGroup
}) {
  const status = instalment
    ? translate('importInstalmentN', { n: instalment.seq })
    : group === 'refunds'
      ? translate('toRefund')
      : dueLabel(due)
  return (
    <RecordLink href={`/invoices?id=${encodeURIComponent(invoice.id)}`} className={ROW}>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate">{invoice.client.name}</span>
        <span className="font-code truncate text-caption text-muted-foreground @max-sm:hidden">
          {invoice.number}
        </span>
      </span>
      <Badge
        size="sm"
        // An instalment already overdue reads red among the others.
        tone={instalment?.is_overdue ? 'red' : GROUP_META[group].tone}
        title={instalment ? dueLabel(due) : undefined}
        className="font-normal"
      >
        {status}
        {instalment && <span className="sr-only"> · {dueLabel(due).toLowerCase()}</span>}
      </Badge>
      <Money
        value={amount}
        currency={invoice.currency}
        className="shrink-0 text-right tabular-nums"
      />
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
