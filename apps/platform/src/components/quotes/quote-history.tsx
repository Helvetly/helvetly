'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Check,
  ChevronDown,
  Clock,
  FileText,
  GitCompareArrows,
  History,
  Pencil,
  Send,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { TimelineItem, type TimelineTone } from '@/components/timeline'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatDay, formatMoney, UNITS, type Line } from '@/lib/invoices'
import { useQuoteRevisions, type Quote, type QuoteRevision } from '@/lib/quotes'

import {
  diffQuotes,
  isUnchanged,
  type LineDiff,
  type LineField,
  type QuoteDiff,
} from './quote-diff'

/**
 * The History tab: each sent revision of the quote, newest first, with when and to whom it went, the answer it got,
 * its PDF (opened in the drawer's PDF tab) and what changed since it.
 */
export function QuoteHistory({
  quote,
  onOpenPdf,
}: {
  quote: Quote
  onOpenPdf: (revision: number) => void
}) {
  const query = useQuoteRevisions(quote)
  const [comparing, setComparing] = useState<number | null>(null)
  if (query.error)
    return (
      <div className="grid justify-items-center gap-2 px-6 py-12 text-center">
        <p className="text-body font-medium">{translate('quoteHistoryLoadError')}</p>
        <p className="text-body-sm text-muted-foreground">{errorMessage(query.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {translate('tryAgain')}
        </Button>
      </div>
    )
  if (!query.data) return <Loader className="py-12" />
  const revisions = query.data
  if (revisions.length === 0)
    return <EmptyState icon={History} title={translate('quoteHistoryEmpty')} />
  // A revised quote is a draft of the next revision until it is sent: it heads the timeline, unsent.
  const draft = quote.status === 'draft' && quote.revision > (revisions[0]?.revision ?? 0)

  return (
    <Panel>
      <ol aria-label={translate('quoteHistory')} className="grid">
        {draft && (
          <Entry mark="draft" last={false}>
            <p className="text-body font-medium">
              {translate('quoteHistoryRev', { revision: quote.revision })}
            </p>
            <p className="text-body-sm text-muted-foreground">{translate('quoteHistoryDraft')}</p>
          </Entry>
        )}
        {revisions.map((revision, index) => (
          <Entry
            key={revision.revision}
            mark={revision.current ? 'current' : (revision.outcome ?? 'past')}
            last={index === revisions.length - 1}
          >
            <Revision
              quote={quote}
              revision={revision}
              comparing={comparing === revision.revision}
              onCompare={() =>
                setComparing(comparing === revision.revision ? null : revision.revision)
              }
              onOpenPdf={() => onOpenPdf(revision.revision)}
            />
          </Entry>
        ))}
      </ol>
    </Panel>
  )
}

type Mark = 'draft' | 'current' | 'past' | 'accepted' | 'declined' | 'expired'

const MARKS: Record<Mark, { tone: TimelineTone; icon: LucideIcon }> = {
  draft: { tone: 'neutral', icon: Pencil },
  current: { tone: 'brand', icon: Send },
  past: { tone: 'neutral', icon: History },
  accepted: { tone: 'success', icon: Check },
  declined: { tone: 'danger', icon: X },
  expired: { tone: 'warning', icon: Clock },
}

/** One step of the vertical timeline, in the app's timeline colours. */
function Entry({ mark, last, children }: { mark: Mark; last: boolean; children: ReactNode }) {
  return (
    <TimelineItem
      tone={MARKS[mark].tone}
      icon={MARKS[mark].icon}
      dashed={mark === 'draft'}
      last={last}
    >
      {children}
    </TimelineItem>
  )
}

function Revision({
  quote,
  revision,
  comparing,
  onCompare,
  onOpenPdf,
}: {
  quote: Quote
  revision: QuoteRevision
  comparing: boolean
  onCompare: () => void
  onOpenPdf: () => void
}) {
  const { snapshot } = revision
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body font-medium">
          {translate('quoteHistoryRev', { revision: revision.revision })}
        </p>
        {revision.current && (
          <Badge size="sm" tone="blue">
            {translate('current')}
          </Badge>
        )}
      </div>
      <p className="text-body-sm text-muted-foreground">{sentLine(revision)}</p>
      <Outcome revision={revision} />
      <div className="-ml-2 flex flex-wrap items-center gap-1 pt-0.5">
        {revision.has_pdf && (
          <Button variant="ghost" size="sm" onClick={onOpenPdf}>
            <FileText className="size-3.5" />
            {translate('quoteHistoryOpenPdf')}
          </Button>
        )}
        {snapshot && !revision.current && (
          <Button variant="ghost" size="sm" aria-expanded={comparing} onClick={onCompare}>
            <GitCompareArrows className="size-3.5" />
            {comparing ? translate('quoteHistoryHideCompare') : translate('quoteHistoryCompare')}
          </Button>
        )}
      </div>
      {!snapshot && (
        <p className="text-caption text-muted-foreground">
          {revision.has_pdf ? translate('quoteHistoryOnlyPdf') : translate('quoteHistoryNoPdf')}
        </p>
      )}
      {comparing && snapshot && (
        <RevisionDiff
          revision={revision.revision}
          diff={diffQuotes(snapshot, quote)}
          before={snapshot}
          after={quote}
        />
      )}
    </>
  )
}

/** "Sent 22 Nov 2026 to x@y", "Sent 22 Nov 2026" when it was only marked sent. */
function sentLine({ sent_at: at, sent_to: to }: QuoteRevision) {
  if (!at) return translate('quoteHistorySentUnknown')
  return to.length
    ? translate('quoteHistorySentTo', { date: formatDate(at), to: to.join(', ') })
    : translate('quoteHistorySent', { date: formatDate(at) })
}

function Outcome({ revision }: { revision: QuoteRevision }) {
  const { outcome, outcome_at: at } = revision
  if (!outcome) return null
  const by =
    revision.outcome_by === 'client'
      ? translate('quoteHistoryByClient')
      : revision.outcome_by === 'staff'
        ? translate('quoteHistoryByTeam')
        : ''
  const validUntil = revision.snapshot?.valid_until
  const text =
    outcome === 'expired'
      ? validUntil
        ? translate('quoteHistoryExpiredAfter', { date: formatDay(validUntil) })
        : translate('quoteHistoryExpired')
      : translate(outcome === 'accepted' ? 'quoteHistoryAccepted' : 'quoteHistoryDeclined', {
          date: at ? formatDate(at) : '',
        })
  return (
    <p className="text-body-sm">
      <span
        className={cn(
          'font-medium',
          outcome === 'accepted' && 'text-success',
          outcome === 'declined' && 'text-destructive',
          outcome === 'expired' && 'text-warning',
        )}
      >
        {text}
      </span>
      {by && <span className="text-muted-foreground"> {by}</span>}
      {revision.reason && (
        <span className="block break-words whitespace-pre-line text-muted-foreground">
          “{revision.reason}”
        </span>
      )}
    </p>
  )
}

const FIELD_LABELS: Record<QuoteDiff['fields'][number]['field'], () => string> = {
  issue_date: () => translate('issueDate'),
  valid_until: () => translate('validUntil3'),
  currency: () => translate('currency'),
  vat_mode: () => translate('quoteHistoryPrices'),
  discount_percent: () => translate('quoteHistoryDiscountPercent'),
  reference: () => translate('reference'),
  intro: () => translate('intro'),
  footer: () => translate('footer'),
}

const TOTAL_LABELS: Record<QuoteDiff['totals'][number]['field'], () => string> = {
  subtotal: () => translate('subtotal'),
  discount_amount: () => translate('discount2'),
  vat_total: () => translate('vat'),
  payable_total: () => translate('total'),
}

const LINE_LABELS: Record<LineField, () => string> = {
  description: () => translate('description'),
  quantity: () => translate('quantity'),
  unit: () => translate('unit'),
  unit_price: () => translate('unitPrice'),
  discount_percent: () => translate('quoteHistoryDiscountPercent'),
  vat: () => translate('vat'),
}

const VAT_MODES: Record<string, () => string> = {
  exclusive: () => translate('pricesExclVAT'),
  inclusive: () => translate('pricesInclVAT'),
  none: () => translate('noVAT'),
}

function fieldValue(field: QuoteDiff['fields'][number]['field'], value: string) {
  if (!value) return '—'
  if (field === 'issue_date' || field === 'valid_until') return formatDay(value)
  if (field === 'vat_mode') return VAT_MODES[value]?.() ?? value
  if (field === 'discount_percent') return `${value}%`
  return value
}

function lineValue(line: Line, field: LineField, currency: string) {
  switch (field) {
    case 'quantity':
      return line.quantity
    case 'unit':
      return line.unit ? (UNITS.find((unit) => unit.value === line.unit)?.label ?? line.unit) : '—'
    case 'unit_price':
      return formatMoney(line.unit_price, currency)
    case 'discount_percent':
      return `${line.discount_percent}%`
    case 'vat':
      return line.vat_category === 'S' ? `${line.vat_rate}%` : line.vat_category
    case 'description':
      return line.description
  }
}

/** Long texts read better above each other than side by side. */
const LONG = new Set<string>(['intro', 'footer', 'description', 'reference'])

/** One change, the old value struck through and muted, the new one after it. */
function Change({
  label,
  before,
  after,
  field,
}: {
  label: string
  before: string
  after: string
  field: string
}) {
  const long = LONG.has(field)
  return (
    <div
      className={cn(
        'grid gap-x-3 gap-y-0.5 py-1.5 text-body-sm',
        !long && 'sm:grid-cols-[9rem_minmax(0,1fr)]',
      )}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn('min-w-0', long ? 'grid gap-0.5' : 'flex flex-wrap items-baseline gap-x-1.5')}
      >
        <del className="break-words whitespace-pre-line text-muted-foreground decoration-muted-foreground/60">
          {before}
        </del>
        {!long && (
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
        )}
        <ins className="break-words whitespace-pre-line no-underline">{after}</ins>
      </dd>
    </div>
  )
}

const KIND_TONE = {
  added: 'green',
  removed: 'red',
  changed: 'amber',
} as const

const KIND_LABEL = {
  added: () => translate('quoteHistoryAdded'),
  removed: () => translate('quoteHistoryRemoved'),
  changed: () => translate('quoteHistoryChanged'),
}

function LineChange({ entry, before, after }: { entry: LineDiff; before: Quote; after: Quote }) {
  if (entry.kind === 'same') return null
  return (
    <li className="grid gap-1 py-2.5 first:pt-1">
      <div className="flex min-w-0 items-start gap-2">
        <Badge size="sm" tone={KIND_TONE[entry.kind]} className="mt-0.5">
          {KIND_LABEL[entry.kind]()}
        </Badge>
        <span
          className={cn(
            'min-w-0 flex-1 text-body break-words whitespace-pre-line',
            entry.kind === 'removed' && 'text-muted-foreground line-through',
          )}
        >
          {entry.kind === 'changed' && entry.fields.includes('description')
            ? entry.before.description
            : entry.line.description}
        </span>
        {entry.kind !== 'changed' && (
          <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
            {entry.line.quantity} ×{' '}
            {formatMoney(
              entry.line.unit_price,
              (entry.kind === 'removed' ? before : after).currency,
            )}
          </span>
        )}
      </div>
      {entry.kind === 'changed' && (
        <dl className="pl-1">
          {entry.fields.map((field) => (
            <Change
              key={field}
              field={field}
              label={LINE_LABELS[field]()}
              before={lineValue(entry.before, field, before.currency)}
              after={lineValue(entry.line, field, after.currency)}
            />
          ))}
        </dl>
      )}
    </li>
  )
}

/** What changed from a sent revision to the quote now; unchanged lines folded away. */
function RevisionDiff({
  revision,
  diff,
  before,
  after,
}: {
  revision: number
  diff: QuoteDiff
  before: Quote
  after: Quote
}) {
  const [showSame, setShowSame] = useState(false)
  const same = diff.lines.filter((entry) => entry.kind === 'same')
  return (
    <section
      aria-label={translate('quoteHistoryComparing', { revision })}
      className="mt-1 grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
    >
      <p className="text-body-sm font-medium text-muted-foreground">
        {translate('quoteHistoryComparing', { revision })}
      </p>
      {isUnchanged(diff) ? (
        <p className="text-body-sm">{translate('quoteHistorySame')}</p>
      ) : (
        <>
          {diff.lines.some((entry) => entry.kind !== 'same') && (
            <Group title={translate('lines')}>
              <ul className="divide-y divide-border/60">
                {diff.lines.map((entry) => (
                  <LineChange
                    key={`${entry.kind}-${entry.line.id}`}
                    entry={entry}
                    before={before}
                    after={after}
                  />
                ))}
              </ul>
            </Group>
          )}
          {diff.totals.length > 0 && (
            <Group title={translate('totals')}>
              <dl>
                {diff.totals.map((change) => (
                  <Change
                    key={change.field}
                    field={change.field}
                    label={TOTAL_LABELS[change.field]()}
                    before={formatMoney(change.before, before.currency)}
                    after={formatMoney(change.after, after.currency)}
                  />
                ))}
              </dl>
            </Group>
          )}
          {diff.fields.length > 0 && (
            <Group title={translate('details')}>
              <dl>
                {diff.fields.map((change) => (
                  <Change
                    key={change.field}
                    field={change.field}
                    label={FIELD_LABELS[change.field]()}
                    before={fieldValue(change.field, change.before)}
                    after={fieldValue(change.field, change.after)}
                  />
                ))}
              </dl>
            </Group>
          )}
        </>
      )}
      {same.length > 0 && !isUnchanged(diff) && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            aria-expanded={showSame}
            onClick={() => setShowSame(!showSame)}
          >
            <ChevronDown className={cn('size-3.5', showSame && 'rotate-180')} />
            {translate('quoteHistoryUnchangedLines', { count: same.length })}
          </Button>
          {showSame && (
            <ul className="grid gap-1 pt-1 pl-1">
              {same.map((entry) => (
                <li
                  key={entry.line.id}
                  className="flex min-w-0 gap-2 text-body-sm text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{entry.line.description}</span>
                  <span className="shrink-0 tabular-nums">
                    {entry.line.quantity} × {formatMoney(entry.line.unit_price, after.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <h4 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </div>
  )
}
