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
  CalendarClock,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Gauge,
  Video,
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
import { documentTitle } from '@/lib/quotes'
import {
  civilDay,
  formatClock,
  relativeDay,
  sessionAttention,
  sessionIcsUrl,
  zoneName,
  type ClientSession,
  type SessionAttention,
} from '@/lib/scheduling'
import { scoped } from '@/lib/scope'
import { shorten } from '@/lib/text'
import { amountOf } from '@/lib/units'

import { cardClass, DownloadLink, FileTile, RetryAlert, SectionTitle, ViewAll } from './portal-bits'
import { UsageBar } from './portal-engagements'
import { NextSessionCard, useUpcomingSessions } from './portal-sessions'

/** Days ahead that count as "This week" on the to-do list. */
const WEEK_DAYS = 7

const moneyLines = (sums: [string, string][]) =>
  sums.map(([currency, total]) => (
    <span key={currency} className="block whitespace-nowrap">
      {formatMoney(total, currency)}
    </span>
  ))

const viewAll = (href: string, label: string) => <ViewAll href={href} label={label} />

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

/** 2–3 tiles of the same height: what is due, what is overdue, and the engagement's usage. */
function Summary({
  invoices,
  engagements,
  today,
}: {
  invoices: PortalInvoice[]
  engagements: PortalEngagement[]
  today: string
}) {
  const open = byUrgency(invoices)
  const due = sumByCurrency(open, (i) => i.amount_due)
  const overdue = open.filter((i) => i.is_overdue)
  const next = open.find((i) => !i.is_overdue && i.due_date)?.due_date
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
              href={scoped(`/engagements#${shown.id}`)}
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

  return (
    <dl
      aria-label={translate('summary')}
      className={cn(
        'grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4',
        tiles.length > 2 && 'lg:grid-cols-3',
      )}
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className={cn(
            cardClass,
            'grid min-w-0 content-start gap-2 p-4 sm:p-5',
            // Below lg the usage tile, the fullest, takes a row of its own.
            tile.key === 'usage' && 'max-lg:col-span-2',
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

const GROUPS = ['overdue', 'today', 'week', 'later'] as const
type Group = (typeof GROUPS)[number]
const GROUP_LABEL: Record<Group, string> = {
  overdue: translate('overdue'),
  today: translate('today'),
  week: translate('thisWeek'),
  later: translate('later'),
}

type Item = {
  key: string
  group: Group
  /** Sorts the rows of a group: when it matters, in ms. */
  at: number
  icon: LucideIcon
  tone: Tone
  title: string
  meta: string
  /** The exact date beside `meta`, left out on phones. */
  date?: string
  overdue?: boolean
  amount?: string
  action: ReactNode
  pdf?: ReactNode
}

/** Today, this week or later, by whole days from today to a civil date. */
const groupOf = (day: string, today: string): Group => {
  const days = daysBetween(today, day)
  return days <= 0 ? 'today' : days <= WEEK_DAYS ? 'week' : 'later'
}

const sessionWhen = (iso: string, zone: string) =>
  `${relativeDay(iso, zone)}, ${formatClock(iso, zone)}`

const manage = (label: string) => (
  <Button asChild variant="outline">
    <Link href={scoped('/sessions')}>
      <CalendarClock aria-hidden />
      {label}
    </Link>
  </Button>
)

/** A session row: the next one with Join or Add to calendar, else a link to answer or manage it. */
function sessionItem({ session, reason, at }: SessionAttention, today: string): Item {
  const zone = session.time_zone
  const base = { key: session.id, at, title: session.title, icon: CalendarDays }
  if (reason === 'proposal')
    return {
      ...base,
      group: 'today',
      tone: 'blue',
      meta: translate('attentionProposal', {
        when: sessionWhen(session.request?.staff_proposal ?? session.starts_at, zone),
      }),
      action: manage(translate('attentionRespond')),
    }
  if (reason === 'deadline')
    return {
      ...base,
      group: groupOf(civilDay(new Date(at).toISOString(), zone), today),
      tone: 'amber',
      meta: translate('attentionDeadline', { when: sessionWhen(new Date(at).toISOString(), zone) }),
      action: manage(translate('attentionManage')),
    }
  return {
    ...base,
    group: groupOf(civilDay(session.starts_at, zone), today),
    tone: 'blue',
    meta: `${sessionWhen(session.starts_at, zone)}–${formatClock(session.ends_at, zone)} · ${zoneName(zone)}`,
    action: session.meeting_url ? (
      <Button asChild>
        <a href={session.meeting_url} target="_blank" rel="noreferrer">
          <Video aria-hidden />
          {translate('sessionsJoin')}
        </a>
      </Button>
    ) : (
      <DownloadLink
        href={sessionIcsUrl(session.id)}
        label={translate('sessionsAddToCalendarLabel', {
          title: session.title,
          when: sessionWhen(session.starts_at, zone),
        })}
        text={translate('sessionsAddToCalendar')}
      />
    ),
  }
}

/** Everything waiting for the client, one row each with one action: overdue first, then today, this week, later. */
function Attention({
  invoices,
  sessions,
  today,
  onPay,
}: {
  invoices: PortalInvoice[]
  sessions: ClientSession[]
  today: string
  onPay: (invoice: PortalInvoice) => void
}) {
  const items: Item[] = [
    ...byUrgency(invoices).map((invoice): Item => {
      const group = invoice.is_overdue
        ? 'overdue'
        : invoice.due_date
          ? groupOf(invoice.due_date, today)
          : 'later'
      return {
        key: invoice.id,
        group,
        at: invoice.due_date ? Date.parse(invoice.due_date) : Infinity,
        icon: FileText,
        tone: group === 'later' ? 'neutral' : 'amber',
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
    ...sessionAttention(sessions).map((entry) => sessionItem(entry, today)),
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
    <div className="grid gap-5">
      {GROUPS.map((group) => {
        const rows = items.filter((item) => item.group === group).toSorted((a, b) => a.at - b.at)
        if (rows.length === 0) return null
        return (
          <div key={group} className="grid gap-1">
            <h3
              id={`attention-${group}`}
              className="text-caption font-medium tracking-wide text-muted-foreground uppercase"
            >
              {GROUP_LABEL[group]}
            </h3>
            <ul
              aria-labelledby={`attention-${group}`}
              className="-mx-2 grid divide-y divide-border/70"
            >
              {rows.map((item) => (
                // Phones: the actions go to a line of their own, so the title and date stay readable.
                <li
                  key={item.key}
                  data-attention={item.key}
                  className="flex flex-wrap items-center gap-3 px-2 py-3"
                >
                  <ToneIcon icon={item.icon} tone={item.tone} />
                  <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                    <span className="truncate text-body font-medium">{item.title}</span>
                    <span
                      // Not cn(): tailwind-merge would drop the type-scale size for the colour.
                      className={`truncate text-body-sm ${item.overdue ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {item.amount && (
                        <span className="tabular-nums sm:hidden">{item.amount} · </span>
                      )}
                      {item.meta}
                      {item.date && <span className="max-sm:hidden"> · {item.date}</span>}
                    </span>
                  </span>
                  {item.amount && (
                    <span className="shrink-0 text-right text-body font-medium tabular-nums max-sm:hidden">
                      {item.amount}
                    </span>
                  )}
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
                <span className="truncate text-body">{documentTitle(doc)}</span>
                <span className="text-body-sm text-muted-foreground">
                  <span className="max-sm:hidden">{formatSize(doc.size)} · </span>
                  {sharedText(doc.shared_at, today)}
                </span>
              </span>
              <DownloadLink
                href={portalDocumentUrl(doc.id)}
                label={translate('download2', { name: documentTitle(doc) })}
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
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  const invoices = useQuery({ queryKey: portalKeys.invoices, queryFn: listPortalInvoices })
  const paying = invoices.data?.data.find((invoice) => invoice.id === payingID)
  // Engagements add a tile; a failure there leaves it out, its page says why.
  const engagements = useQuery({
    queryKey: portalKeys.engagements,
    queryFn: listPortalEngagements,
  })
  const sessions = useUpcomingSessions()
  const name = session.data?.client.name
  const supplier = session.data?.workspace.name

  return (
    <div className="grid gap-6 sm:gap-8">
      <header className="grid min-w-0 gap-1">
        <h1 className="truncate text-page font-semibold tracking-tight sm:text-display">
          {greeting(hour)}
          {name && `, ${shorten(name, NAME_MAX)}`}
        </h1>
        {supplier && (
          <p className="truncate text-body text-muted-foreground sm:text-title-sm" title={supplier}>
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
        <Summary invoices={invoices.data.data} engagements={engagements.data ?? []} today={today} />
      )}

      {/* Phones: one column in priority order. Wide screens: the to-do list, the next session and new files beside it. */}
      <div className="flex flex-col gap-5 sm:gap-6 lg:flex-row lg:items-start">
        {!invoices.error && (
          <section
            aria-labelledby="overview-attention"
            className={cn(cardClass, 'grid min-w-0 content-start gap-4 p-4 sm:p-6 lg:flex-1')}
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
                sessions={sessions.data ?? []}
                today={today}
                onPay={(invoice) => {
                  setPayingID(invoice.id)
                  void invoices.refetch()
                }}
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
    </div>
  )
}
