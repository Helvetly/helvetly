'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge, TONES, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Loader } from '@helvetly/ui/components/loader'
import { formatDate, formatMoney, formatSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import {
  Check,
  CircleAlert,
  CircleCheck,
  Download,
  FilePenLine,
  FileText,
  Gauge,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import { civilToday, daysBetween, daysLeftText, dueText, greeting, sharedText } from '@/lib/dates'
import { isActive, mostRelevant, usedShare } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { byUrgency, isOpen, sumByCurrency } from '@/lib/invoices'
import {
  getPortalSession,
  listPortalDocuments,
  listPortalEngagements,
  listPortalInvoices,
  portalDocumentUrl,
  portalInvoicePdfUrl,
  portalKeys,
  type PortalEngagement,
  type PortalInvoice,
} from '@/lib/portal'
import {
  isAwaiting,
  listPortalQuotes,
  portalQuotePdfUrl,
  quoteName,
  type PortalQuote,
} from '@/lib/quotes'
import { shorten } from '@/lib/text'
import { amountOf } from '@/lib/units'

import { cardClass, DownloadLink, FileTile, RetryAlert, SectionTitle } from './portal-bits'
import { UsageBar } from './portal-engagements'
import { DecisionDialog, type Asking } from './portal-quotes'
import { NextSessionCard } from './portal-sessions'
import { PreviewLock } from './portal-shell'

/** Days before a due date (or a quote's last day) that move it into "Due soon". */
const SOON_DAYS = 14

const moneyLines = (sums: [string, string][]) =>
  sums.map(([currency, total]) => (
    <span key={currency} className="block whitespace-nowrap">
      {formatMoney(total, currency)}
    </span>
  ))

const viewAll = (href: string, label: string) => (
  <Link
    href={href}
    className="text-body-sm text-link underline underline-offset-2 hover:no-underline"
  >
    {label}
  </Link>
)

/** A soft tinted tile carrying an icon: the row's or tile's state at a glance. */
function ToneIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <span
      className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', TONES[tone])}
    >
      <Icon className="size-[18px]" aria-hidden />
    </span>
  )
}

type Tile = {
  key: string
  icon: LucideIcon
  tone: Tone
  label: string
  value: ReactNode
  meta: ReactNode
  /** Sits under the value, e.g. a usage bar. */
  extra?: ReactNode
  /** A link at the label's right, e.g. "+2 more". */
  action?: ReactNode
  alert?: boolean
}

const TILE_COLUMNS = ['', '', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4']

/** 2–4 tiles of the same height: what is due, overdue, quotes to answer, engagement usage. */
function Summary({
  invoices,
  quotes,
  engagements,
  today,
}: {
  invoices: PortalInvoice[]
  quotes: PortalQuote[]
  engagements: PortalEngagement[]
  today: string
}) {
  const open = byUrgency(invoices)
  const due = sumByCurrency(open, (i) => i.amount_due)
  const overdue = open.filter((i) => i.is_overdue)
  const next = open.find((i) => !i.is_overdue && i.due_date)?.due_date
  const awaiting = quotes.filter(isAwaiting)
  const active = engagements.filter(isActive)
  const shown = mostRelevant(active)

  const tiles: Tile[] = [
    {
      key: 'due',
      icon: Wallet,
      tone: 'neutral',
      label: translate('amountDue'),
      value: due.length > 0 ? moneyLines(due) : translate('nothingDue'),
      meta: next
        ? translate('nextDueOn', { date: formatDate(next) })
        : translate('invoiceCount', { count: open.length }),
    },
    {
      key: 'overdue',
      icon: overdue.length > 0 ? CircleAlert : CircleCheck,
      tone: overdue.length > 0 ? 'amber' : 'green',
      label: translate('overdue'),
      value:
        overdue.length > 0
          ? moneyLines(sumByCurrency(overdue, (i) => i.amount_due))
          : translate('none'),
      meta:
        overdue.length > 0
          ? translate('invoiceCount', { count: overdue.length })
          : translate('everythingOnTime'),
      alert: overdue.length > 0,
    },
  ]
  if (awaiting.length > 0)
    tiles.push({
      key: 'quotes',
      icon: FilePenLine,
      tone: 'blue',
      label: translate('quotesToAnswer'),
      value: awaiting.length,
      meta: translate('validUntil2', {
        value1: formatDate(awaiting.map((q) => q.valid_until).toSorted()[0] ?? ''),
      }),
    })
  const period = shown?.current_period
  if (shown && period)
    tiles.push({
      key: 'usage',
      icon: Gauge,
      tone: usedShare(shown) > 1 ? 'amber' : 'neutral',
      label: translate('engagementUsage'),
      action:
        active.length > 1
          ? viewAll('/engagements', translate('moreEngagements', { count: active.length - 1 }))
          : undefined,
      value: translate('percentUsed', { percent: Math.round(usedShare(shown) * 100) }),
      extra: <UsageBar engagement={shown} />,
      meta: (
        <span className="grid gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/engagements#${shown.id}`}
              className="truncate font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              {shown.name}
            </Link>
            <Badge tone="green" size="sm" className="shrink-0">
              {translate('activeBadge')}
            </Badge>
          </span>
          <span className="truncate tabular-nums">
            {translate('ofUsed', {
              used: Number(period.used),
              total: amountOf(shown.quantity, shown.unit),
            })}
            {' · '}
            {daysLeftText(period.ends_on, today)}
          </span>
        </span>
      ),
    })

  const small = tiles.filter((tile) => tile.key !== 'usage').length
  return (
    <dl
      aria-label={translate('summary')}
      className={cn('grid grid-cols-2 gap-3 sm:gap-4', TILE_COLUMNS[tiles.length])}
    >
      {tiles.map((tile, index) => (
        <div
          key={tile.key}
          className={cn(
            cardClass,
            'grid min-w-0 content-start gap-2 p-4 sm:p-5',
            // Below lg the usage tile, the fullest, takes a row of its own, and so does an odd last small tile.
            (tile.key === 'usage' || (index === small - 1 && small % 2 === 1)) &&
              'max-lg:col-span-2',
          )}
        >
          <dt className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md',
                TONES[tile.tone],
              )}
            >
              <tile.icon className="size-3.5" aria-hidden />
            </span>
            <span className="truncate">{tile.label}</span>
            {tile.action && <span className="ml-auto shrink-0">{tile.action}</span>}
          </dt>
          <dd
            // Not cn(): tailwind-merge would drop the type-scale size for the colour.
            className={`text-title font-semibold tracking-tight tabular-nums sm:text-page ${tile.alert ? 'text-destructive' : ''}`}
          >
            {tile.value}
          </dd>
          {tile.extra && <dd>{tile.extra}</dd>}
          <dd className="min-w-0 truncate text-body-sm text-muted-foreground">{tile.meta}</dd>
        </div>
      ))}
    </dl>
  )
}

const GROUPS = ['overdue', 'soon', 'review', 'later'] as const
type Group = (typeof GROUPS)[number]
const GROUP_LABEL: Record<Group, string> = {
  overdue: translate('overdue'),
  soon: translate('dueSoon'),
  review: translate('toReview'),
  later: translate('later'),
}

type Item = {
  key: string
  group: Group
  icon: LucideIcon
  tone: Tone
  title: string
  meta: string
  /** The exact date beside `meta`, left out on phones. */
  date?: string
  overdue?: boolean
  amount: string
  action: ReactNode
  pdf: ReactNode
}

const invoiceGroup = (invoice: PortalInvoice, today: string): Group => {
  if (invoice.is_overdue) return 'overdue'
  return invoice.due_date && daysBetween(today, invoice.due_date) <= SOON_DAYS ? 'soon' : 'later'
}

/** Every thing waiting for the client, one row each with one action, overdue first. */
function Attention({
  invoices,
  quotes,
  today,
  onPay,
  onAsk,
}: {
  invoices: PortalInvoice[]
  quotes: PortalQuote[]
  today: string
  onPay: (invoice: PortalInvoice) => void
  onAsk: (asking: Asking) => void
}) {
  const items: Item[] = [
    ...byUrgency(invoices).map((invoice): Item => {
      const group = invoiceGroup(invoice, today)
      return {
        key: invoice.id,
        group,
        icon: FileText,
        tone: group === 'later' ? 'blue' : 'amber',
        title: translate('invoiceNumber', { number: invoice.number }),
        meta: invoice.due_date ? dueText(invoice.due_date, today) : translate('noDueDate'),
        date: invoice.due_date ? formatDate(invoice.due_date) : undefined,
        overdue: invoice.is_overdue,
        amount: formatMoney(invoice.amount_due, invoice.currency),
        action: (
          <Button
            variant="outline"
            aria-label={translate('payInvoice', { number: invoice.number })}
            onClick={() => onPay(invoice)}
          >
            <Wallet aria-hidden />
            {translate('pay')}
          </Button>
        ),
        pdf: invoice.has_pdf !== false && (
          <DownloadLink
            href={portalInvoicePdfUrl(invoice.id)}
            label={translate('downloadPDFOfInvoice', { number: invoice.number })}
          />
        ),
      }
    }),
    ...quotes
      .filter(isAwaiting)
      .toSorted((a, b) => a.valid_until.localeCompare(b.valid_until))
      .map((quote): Item => {
        const soon = daysBetween(today, quote.valid_until) <= SOON_DAYS
        return {
          key: quote.id,
          group: soon ? 'soon' : 'review',
          icon: FilePenLine,
          tone: soon ? 'amber' : 'blue',
          title: translate('quoteTitle', { name: quoteName(quote) }),
          meta: translate('validUntil2', { value1: formatDate(quote.valid_until) }),
          amount: formatMoney(quote.total, quote.currency),
          action: (
            <PreviewLock>
              <Button
                variant="outline"
                aria-label={translate('acceptQuote', { value1: quoteName(quote) })}
                onClick={() => onAsk({ quote, decision: 'accept' })}
              >
                <Check aria-hidden />
                {translate('accept')}
              </Button>
            </PreviewLock>
          ),
          pdf: (
            <DownloadLink
              href={portalQuotePdfUrl(quote.id)}
              label={translate('downloadPDFOfQuote', { value1: quoteName(quote) })}
            />
          ),
        }
      }),
  ]

  if (items.length === 0)
    return (
      <div className="grid justify-items-center gap-3 py-10 text-center">
        <span className={cn('flex size-12 items-center justify-center rounded-full', TONES.green)}>
          <CircleCheck className="size-6" aria-hidden />
        </span>
        <div className="grid gap-1">
          <p className="text-title-sm font-medium">{translate('youReAllSet')}</p>
          <p className="max-w-xs text-body-sm text-pretty text-muted-foreground">
            {translate('nothingNeedsYourAttention')}
          </p>
        </div>
      </div>
    )

  return (
    <div className="grid gap-4">
      {GROUPS.map((group) => {
        const rows = items.filter((item) => item.group === group)
        if (rows.length === 0) return null
        return (
          <div key={group} className="grid">
            <h3
              id={`attention-${group}`}
              className="text-caption font-medium text-muted-foreground"
            >
              {GROUP_LABEL[group]}
            </h3>
            <ul
              aria-labelledby={`attention-${group}`}
              className="-mx-2 grid divide-y divide-border/70"
            >
              {rows.map((item) => (
                // Phones: the actions go to a line of their own, so the title and date stay readable.
                <li key={item.key} className="flex flex-wrap items-center gap-3 px-2 py-3">
                  <ToneIcon icon={item.icon} tone={item.tone} />
                  <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                    <span className="truncate text-body font-medium">{item.title}</span>
                    <span
                      // Not cn(): tailwind-merge would drop the type-scale size for the colour.
                      className={`truncate text-body-sm ${item.overdue ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      <span className="tabular-nums sm:hidden">{item.amount} · </span>
                      {item.meta}
                      {item.date && <span className="max-sm:hidden"> · {item.date}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-body font-medium tabular-nums max-sm:hidden">
                    {item.amount}
                  </span>
                  <span className="flex shrink-0 gap-2 max-sm:basis-full max-sm:pl-12">
                    {item.action}
                    {item.pdf}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

/** The archived payment slip is usable only while its amount matches the balance. */
function PayDialog({
  invoice,
  today,
  checking,
  retry,
  onClose,
}: {
  invoice: PortalInvoice
  today: string
  checking: boolean
  retry?: () => void
  onClose: () => void
}) {
  const canPay = !checking && !retry && isOpen(invoice)
  let description = translate('nothingDue')
  if (checking) {
    description = translate('loadingInvoices')
  } else if (retry) {
    description = translate('yourInvoices') + translate('couldnTBeLoadedTryAgainInAMoment')
  } else if (canPay) {
    description = translate(
      invoice.current_qr
        ? 'payWithTheQRBillSteps'
        : invoice.has_pdf === false
          ? 'askSupplierForPaymentDetails'
          : 'useCurrentBalanceWhenPaying',
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('payInvoice', { number: invoice.number })}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {canPay && (
          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/60 p-4">
            <div className="grid gap-0.5">
              <dt className="text-body-sm text-muted-foreground">{translate('amountDue')}</dt>
              <dd className="text-title-sm font-semibold tabular-nums">
                {formatMoney(invoice.amount_due, invoice.currency)}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-body-sm text-muted-foreground">{translate('due')}</dt>
              <dd
                className={`text-body font-medium ${invoice.is_overdue ? 'text-destructive' : ''}`}
              >
                {invoice.due_date
                  ? `${formatDate(invoice.due_date)} · ${dueText(invoice.due_date, today)}`
                  : translate('noDueDate')}
              </dd>
            </div>
          </dl>
        )}
        {canPay && invoice.has_pdf !== false && (
          <DialogFooter>
            <Button asChild>
              <a href={localizedHref(portalInvoicePdfUrl(invoice.id))}>
                <Download aria-hidden />
                {translate('downloadPDF')}
              </a>
            </Button>
          </DialogFooter>
        )}
        {!checking && retry && (
          <DialogFooter>
            <Button variant="outline" onClick={retry}>
              {translate('tryAgain')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecentDocuments({ today }: { today: string }) {
  const query = useQuery({ queryKey: portalKeys.documents, queryFn: listPortalDocuments })
  if (query.isSuccess && query.data.length === 0) return null
  return (
    <section
      aria-labelledby="overview-documents"
      className={cn(cardClass, 'grid content-start gap-2 p-4 sm:p-6')}
    >
      <SectionTitle
        id="overview-documents"
        action={viewAll('/documents', translate('allDocuments'))}
      >
        {translate('recentlyShared')}
      </SectionTitle>
      {query.isPending ? (
        <Loader className="mt-2 min-h-12" />
      ) : query.error ? (
        <RetryAlert what={translate('documents')} onRetry={() => void query.refetch()} />
      ) : (
        <ul className="-mx-2 grid divide-y divide-border/70">
          {query.data.slice(0, 3).map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-2 py-3">
              <FileTile contentType={doc.content_type} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-body">{doc.name}</span>
                <span className="text-body-sm text-muted-foreground">
                  <span className="max-sm:hidden">{formatSize(doc.size)} · </span>
                  {sharedText(doc.shared_at, today)}
                </span>
              </span>
              <DownloadLink
                href={portalDocumentUrl(doc.id)}
                label={translate('download2', { name: doc.name })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A long legal name would fill the header; the full one stays in the tooltip and the shell. */
const NAME_MAX = 40

/** Greeting, a strip of key numbers, the to-do list, and new files beside it. */
export function PortalOverview() {
  const today = civilToday()
  const [hour] = useState(() => new Date().getHours())
  const [payingID, setPayingID] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  const invoices = useQuery({ queryKey: portalKeys.invoices, queryFn: listPortalInvoices })
  const paying = invoices.data?.data.find((invoice) => invoice.id === payingID)
  // Quotes and engagements add tiles and rows; a failure there leaves them out, their pages say why.
  const quotes = useQuery({ queryKey: portalKeys.quotes, queryFn: listPortalQuotes })
  const engagements = useQuery({
    queryKey: portalKeys.engagements,
    queryFn: listPortalEngagements,
  })
  const name = session.data?.client.name
  const supplier = session.data?.workspace.name

  return (
    <div className="grid gap-6 sm:gap-8">
      <header className="grid min-w-0 gap-1.5">
        <h1 className="truncate text-page font-semibold tracking-tight sm:text-display">
          {greeting(hour)}
          {name && `, ${shorten(name, NAME_MAX)}`}
        </h1>
        {supplier && (
          <p className="text-body text-muted-foreground sm:text-title-sm" title={supplier}>
            {translate('sharesYourInvoicesWorkAndDocumentsHere', {
              name: shorten(supplier, NAME_MAX),
            })}
          </p>
        )}
      </header>

      {invoices.isPending ? (
        <Loader className="min-h-24" />
      ) : invoices.error ? (
        <section aria-label={translate('amountDue')} className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('yourInvoices')} onRetry={() => void invoices.refetch()} />
        </section>
      ) : (
        <Summary
          invoices={invoices.data.data}
          quotes={quotes.data ?? []}
          engagements={engagements.data ?? []}
          today={today}
        />
      )}

      {/* Phones: one column in priority order. Wide screens: the to-do list with new files beside it, or alone. */}
      <div className="flex flex-col gap-5 sm:gap-6 lg:flex-row lg:items-start">
        {!invoices.error && (
          <section
            aria-labelledby="overview-attention"
            className={cn(cardClass, 'grid min-w-0 content-start gap-3 p-4 sm:p-6 lg:flex-1')}
          >
            <SectionTitle
              id="overview-attention"
              action={viewAll('/invoices', translate('allInvoices'))}
            >
              {translate('needsYourAttention')}
            </SectionTitle>
            {invoices.data ? (
              <Attention
                invoices={invoices.data.data}
                quotes={quotes.data ?? []}
                today={today}
                onPay={(invoice) => {
                  setPayingID(invoice.id)
                  void invoices.refetch()
                }}
                onAsk={setAsking}
              />
            ) : (
              <Loader className="min-h-24" />
            )}
          </section>
        )}
        <div className="grid min-w-0 gap-5 empty:hidden sm:gap-6 lg:w-96 lg:shrink-0">
          <NextSessionCard />
          <RecentDocuments today={today} />
        </div>
      </div>

      {paying && (
        <PayDialog
          invoice={paying}
          today={today}
          checking={invoices.isFetching}
          retry={invoices.isError ? () => void invoices.refetch() : undefined}
          onClose={() => setPayingID(null)}
        />
      )}
      {asking && (
        <DecisionDialog key={asking.quote.id} {...asking} onClose={() => setAsking(null)} />
      )}
    </div>
  )
}
