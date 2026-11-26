'use client'
import { localizedHref } from '@helvetly/i18n'
import { ActionMenuContent, type Action } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Switch } from '@helvetly/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowRightLeft,
  Check,
  CircleHelp,
  Download,
  Ellipsis,
  FileCode2,
  ExternalLink,
  FolderOpen,
  Mail,
  Pencil,
  Send,
  Stamp,
  Trash2,
  Undo2,
  Wallet,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  ApprovalGate,
  ApprovalPanel,
  awaitsApproval,
  showsApproval,
} from '@/components/approvals/approval-panel'
import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { useMarkSent } from '@/components/invoices/invoice-dialogs'
import { HeroFact, HeroLink, RecordHero } from '@/components/invoices/record-hero'
import { RecordLink, RecordPageButton } from '@/components/record-link'
import { tabIcons } from '@/components/tab-icons'
import { errorMessage } from '@/lib/api'
import { useInvoiceApproval, type Approval } from '@/lib/approvals'
import { translate } from '@/lib/i18n'
import { downloadEinvoice } from '@/lib/invoice-download'
import {
  documentName,
  dueLabel,
  einvoiceBlock,
  einvoiceFormatsFor,
  formatAmount,
  formatDay,
  formatIban,
  formatMoney,
  fromCents,
  invoicesApi,
  groupReference,
  isPositive,
  isReceivable,
  isZero,
  repeatsAmount,
  kindInfo,
  PAYMENT_METHODS,
  pdfUrl,
  toCents,
  UNITS,
  useDeletePayment,
  useDeleteRefund,
  useInvoice,
  useInvoiceAction,
  useInvoiceDeliveries,
  type Invoice,
  type InvoiceListItem,
} from '@/lib/invoices'

import { editHref } from './compose'
import { DunningCard, dunnable } from './dunning-card'
import { InstalmentSchedule } from './instalment-schedule'
import { ApprovalBadge, InvoiceStatusBadge, Money } from './invoice-bits'
import { invoiceActions, useInvoiceActionState, type InvoiceCommand } from './invoice-commands'
import { PaymentSummary } from './payment-methods'
import { PdfView } from './pdf-view'
import { PlanCard } from './plan-card'
import { TransmissionsCard } from './transmissions-card'

type Run = (command: InvoiceCommand, invoice: InvoiceListItem) => void

/** One invoice, in a sheet from the right (full screen on phones). */
export function InvoiceDetail({
  id,
  canManage,
  onClose,
  run,
  busy,
}: {
  id: string
  canManage: boolean
  onClose: () => void
  run: Run
  busy: boolean
}) {
  const query = useInvoice(id)
  const invoice = query.data

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto bg-panel p-0 sm:w-[min(760px,100vw)]! dark:bg-background"
      >
        <SheetTitle className="sr-only">
          {invoice ? documentName(invoice) : translate('invoice2')}
        </SheetTitle>
        <SheetDescription className="sr-only">{translate('invoiceDetails')}</SheetDescription>
        {invoice ? (
          // Keyed, so another invoice shown in this drawer starts fresh (tabs, page count).
          <Detail
            key={invoice.id}
            invoice={invoice}
            canManage={canManage}
            onClose={onClose}
            run={run}
            busy={busy}
          />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-[15px]">{translate('thisInvoiceCouldnTBeLoaded')}</p>
            <p className="text-sm text-muted-foreground">{errorMessage(query.error)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {translate('tryAgain')}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {translate('close')}
              </Button>
            </div>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** The main button for the invoice's state; the rest lives in the "…" menu. */
function primaryFor(invoice: Invoice): {
  command: InvoiceCommand | null
  label: string
  icon: ReactNode
} {
  // A plan's source draft is never issued itself: the plan issues its partials.
  if (invoice.status === 'draft' && invoice.plan?.seq !== 0)
    return { command: 'issue', label: translate('issue3'), icon: <Stamp /> }
  if (invoice.status === 'open' && invoice.kind !== 'credit_note') {
    if (!invoice.sent_at) return { command: 'send', label: translate('send'), icon: <Send /> }
    if (invoice.kind === 'proforma')
      return {
        command: 'convert_invoice',
        label: translate('convertToInvoice2'),
        icon: <ArrowRightLeft />,
      }
    return { command: 'payment', label: translate('recordPayment2'), icon: <Wallet /> }
  }
  // Settled documents: the PDF is what people come for.
  return { command: null, label: translate('downloadPDF'), icon: <Download /> }
}

/** The header's main button; a tip says what it does when its label alone could worry (Send only opens a review). */
function PrimaryButton({
  tip,
  ...props
}: ComponentProps<typeof Button> & { tip: string | undefined }) {
  const button = <Button className="gap-1.5" {...props} />
  if (!tip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent className="max-w-64">{tip}</TooltipContent>
    </Tooltip>
  )
}

/** `wrap` lets long text and controls (whose focus ring a truncate would clip) flow onto more lines. */
function Row({ label, wrap, children }: { label: string; wrap?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-3 border-t border-border/60 first:border-t-0">
      <span className="w-36 shrink-0 text-[13.5px] text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 flex-1 text-[14px]', wrap ? 'py-2 break-words' : 'truncate')}>
        {children}
      </span>
    </div>
  )
}

const unitShort = (unit: Invoice['lines'][number]['unit']) =>
  unit ? (UNITS.find((entry) => entry.value === unit)?.short ?? unit) : ''

/** When the draft was approved: the last approval of its approved request. */
const approvedAt = (approval: Approval) =>
  approval.state === 'approved'
    ? (approval.trail.findLast((entry) => entry.kind === 'approved')?.at ?? null)
    : null

/**
 * Created → (Approval →) Issued → Sent → Paid, with the dates each step happened. Sent is optional (the PDF may go by
 * post, by hand or through the portal), so it can be marked from here and never blocks Paid.
 */
function Timeline({
  invoice,
  canManage,
  approval,
}: {
  invoice: Invoice
  canManage: boolean
  approval?: Approval
}) {
  const credit = invoice.kind === 'credit_note'
  const proforma = invoice.kind === 'proforma'
  const markSent = useMarkSent()
  const steps = [
    { label: translate('created3'), at: invoice.created_at, optional: false },
    ...(showsApproval(approval)
      ? [{ label: translate('approval'), at: approvedAt(approval), optional: false }]
      : []),
    { label: translate('issued4'), at: invoice.issued_at, optional: false },
    // A proforma ends when it is sent, so there it is the last step, not an optional one.
    ...(credit ? [] : [{ label: translate('sent3'), at: invoice.sent_at, optional: !proforma }]),
    ...(proforma
      ? []
      : [
          {
            label: credit
              ? translate('applied')
              : invoice.status === 'void'
                ? translate('voided2')
                : invoice.status === 'replaced'
                  ? translate('replaced')
                  : translate('paid'),
            at: ['paid', 'void', 'replaced'].includes(invoice.status) ? invoice.updated_at : null,
            optional: false,
          },
        ]),
  ]
  const current = steps.findIndex((step) => !step.at && !step.optional)
  const canMark = canManage && invoice.status === 'open'
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, i) => {
        const done = Boolean(step.at)
        const skippable = step.optional && !done
        const skippedAt = (j: number) =>
          Boolean(steps[j]?.optional && !steps[j]?.at && steps.slice(j + 1).some((s) => s.at))
        // An optional step the document went past without it: amber, with its lines to and from it.
        const skipped = skippedAt(i)
        return (
          <li key={step.label} className="relative grid gap-1.5 pr-2">
            <span className="flex items-center">
              {skipped ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={translate('stepNotRecorded')}
                      data-step-state="skipped"
                      className="z-10 flex size-[18px] shrink-0 cursor-default items-center justify-center rounded-full border border-dashed border-warning-solid bg-warning-surface text-warning outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <CircleHelp className="size-3" strokeWidth={2.5} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{translate('stepNotRecorded')}</TooltipContent>
                </Tooltip>
              ) : (
                <span
                  className={cn(
                    'z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full',
                    done
                      ? 'bg-success-solid text-white'
                      : skippable
                        ? 'border border-dashed border-muted-foreground/50 bg-card'
                        : i === current
                          ? 'bg-card ring-[1.5px] ring-brand-solid ring-inset'
                          : 'bg-card ring-1 ring-border ring-inset',
                  )}
                >
                  {done && <Check className="size-3" strokeWidth={3} />}
                </span>
              )}
              {i < steps.length - 1 && (
                <span
                  className={cn(
                    'h-px flex-1',
                    skipped || skippedAt(i + 1)
                      ? 'bg-warning-solid'
                      : done && steps[i + 1]?.at
                        ? 'bg-success-solid'
                        : 'bg-border',
                  )}
                />
              )}
            </span>
            <span className={cn('text-[13px]', done ? 'text-foreground' : 'text-muted-foreground')}>
              {step.label}
              {skippable && (
                <>
                  {' '}
                  <span className="whitespace-nowrap text-muted-foreground/80">
                    · {translate('optionalStep')}
                  </span>
                </>
              )}
            </span>
            <span className="-mt-1 text-[12px] text-muted-foreground tabular-nums">
              {step.at ? (
                formatDate(step.at)
              ) : skippable && canMark ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={markSent.pending}
                      onClick={() => markSent.mark(invoice)}
                      className="rounded-sm underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    >
                      {translate('markAsSent')}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{translate('markAsSentTip')}</TooltipContent>
                </Tooltip>
              ) : i === current ? (
                translate('next2')
              ) : (
                '—'
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Detail({
  invoice,
  canManage,
  onClose,
  run,
  busy,
}: {
  invoice: Invoice
  canManage: boolean
  onClose: () => void
  run: Run
  busy: boolean
}) {
  const primary = primaryFor(invoice)
  // Only a draft has something to approve; a plan's source draft is never issued itself.
  const approvalQuery = useInvoiceApproval(
    invoice.id,
    invoice.status === 'draft' && invoice.plan?.seq !== 0,
  )
  const approval = approvalQuery.data
  const gated = primary.command === 'issue' && awaitsApproval(approval)
  const [pages, setPages] = useState<number | null>(null)
  const credit = invoice.kind === 'credit_note'
  const proforma = invoice.kind === 'proforma'
  const payable = toCents(invoice.payable_total)
  const paidShare =
    payable > 0n ? Number(((payable - toCents(invoice.amount_due)) * 1000n) / payable) / 10 : 0
  const deliveries = useInvoiceDeliveries(invoice.id, invoice.status !== 'draft')
  // The refund has its own button in the callout.
  const skip: InvoiceCommand[] = [
    ...(primary.command ? [primary.command] : []),
    'refund',
    ...(gated ? (['issue'] as const) : []),
  ]
  // The server voids only open invoices with neither payments nor credit notes.
  if (!isZero(invoice.amount_paid) || !isZero(invoice.amount_credited)) skip.push('void')
  const actionState = useInvoiceActionState()
  const einvoice = useEinvoiceAction(invoice)

  return (
    <Tabs defaultValue="overview" className="min-h-full gap-0">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
          <Badge size="sm" className={cn('ml-1 tabular-nums', invoice.number && 'font-code')}>
            {invoice.number ?? translate('draft')}
          </Badge>
          <span className="ml-1.5 text-[13px] text-muted-foreground">
            {kindInfo(invoice.kind).label}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={translate('moreActions')}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <ActionMenuContent
                kind="dropdown"
                menu={{
                  header: `${invoice.number ?? translate('draft')} · ${invoice.client.name}`,
                  actions: [
                    ...invoiceActions({ invoice, canManage, state: actionState, run, skip }),
                    invoice.status !== 'draft' && einvoice,
                  ],
                }}
              />
            </DropdownMenu>
            {invoice.status === 'draft' && invoice.plan?.seq !== 0 && (
              <Button asChild variant="outline" className="gap-1.5">
                <RecordLink inPlace href={editHref(invoice.id)}>
                  <Pencil className="size-3.5" />
                  {translate('edit4')}
                </RecordLink>
              </Button>
            )}
            {gated ? (
              <ApprovalGate target={{ doc: 'invoices', id: invoice.id }} approval={approval}>
                {primary.icon} {primary.label}
              </ApprovalGate>
            ) : primary.command === null ? (
              <Button asChild className="gap-1.5">
                <a href={localizedHref(pdfUrl(invoice.id, true))} download>
                  {primary.icon} {primary.label}
                </a>
              </Button>
            ) : (
              <PrimaryButton
                tip={primary.command === 'send' ? translate('sendTip') : undefined}
                // Issue waits for the draft's approval to be known, so it never flips under the pointer.
                disabled={busy || (primary.command === 'issue' && approvalQuery.isPending)}
                onClick={() => primary.command && run(primary.command, invoice)}
              >
                {primary.icon} {primary.label}
              </PrimaryButton>
            )}
            <RecordPageButton />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={translate('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>

        <div className="grid gap-5 px-6 pt-6">
          <InvoiceHero
            invoice={invoice}
            payable={payable}
            credit={credit}
            progress={
              invoice.status !== 'draft' &&
              !credit &&
              !proforma && (
                <PaymentProgress invoice={invoice} payable={payable} paidShare={paidShare} />
              )
            }
          />

          {isPositive(invoice.refund_due) && (
            <Callout
              tone="warning"
              icon={Undo2}
              actions={
                <Button onClick={() => run('refund', invoice)}>{translate('recordRefund2')}</Button>
              }
            >
              <span className="font-medium tabular-nums">
                {translate('refundDue2')}
                {formatMoney(invoice.refund_due, invoice.currency)}
              </span>
              <span className="text-muted-foreground">
                {' '}
                {translate('theCustomerWasCreditedAfterPaying')}
              </span>
            </Callout>
          )}

          <Timeline invoice={invoice} canManage={canManage} approval={approval} />

          <TabsList variant="line" className="-mb-px h-10 gap-4 p-0">
            {[
              { value: 'overview' as const, label: translate('overview') },
              {
                value: 'payments' as const,
                label: translate('payments'),
                count: invoice.payments.length + invoice.refunds.length,
                hidden: credit || proforma || invoice.status === 'draft',
              },
              {
                value: 'emails' as const,
                label: translate('emails'),
                count: deliveries.data?.length,
                hidden: invoice.status === 'draft',
              },
              { value: 'pdf' as const, label: 'PDF' },
            ]
              .filter((tab) => !tab.hidden)
              .map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  icon={tabIcons[tab.value]}
                  count={tab.count}
                  className="h-full flex-none px-0 text-[14px] font-normal after:bottom-0! after:h-[2px] after:bg-primary"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
          </TabsList>
        </div>
        <div className="border-b border-border/60" />
      </header>

      <TabsContent value="overview" className="grid grid-cols-1 content-start gap-3 p-4 sm:p-5">
        {showsApproval(approval) && (
          <ApprovalPanel target={{ doc: 'invoices', id: invoice.id }} approval={approval} />
        )}
        <Panel title={credit ? translate('creditedLines') : translate('lines')}>
          <ul className="divide-y divide-border/60">
            {invoice.lines.map((line) => (
              <li key={line.id} className="flex items-center gap-3 py-2 first:pt-0.5">
                <span className="w-5 shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
                  {line.position}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="text-[14px] whitespace-pre-line">{line.description}</span>
                  {!repeatsAmount(line, invoice.vat_mode) && (
                    <span className="text-[12.5px] text-muted-foreground tabular-nums">
                      {line.quantity}
                      {line.unit && ` ${unitShort(line.unit)}`} ×{' '}
                      {formatMoney(line.unit_price, invoice.currency)}
                      {!isZero(line.discount_percent) && ` · −${line.discount_percent}%`}
                      {invoice.vat_mode !== 'none' &&
                        translate('vat3', {
                          value1:
                            line.vat_category === 'S' ? `${line.vat_rate}%` : line.vat_category,
                        })}
                    </span>
                  )}
                </span>
                <Money value={line.amount} currency={invoice.currency} className="text-[14px]" />
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-1.5 border-t border-border/60 pt-3 text-[13.5px]">
            <TotalRow
              label={translate('subtotal')}
              value={formatMoney(invoice.subtotal, invoice.currency)}
            />
            {!isZero(invoice.discount_amount) && (
              <TotalRow
                label={translate('discount', { discount_percent: invoice.discount_percent })}
                value={`−${formatMoney(invoice.discount_amount, invoice.currency)}`}
              />
            )}
            {invoice.vat_mode !== 'none' &&
              invoice.vat_breakdown.map((group) => (
                <TotalRow
                  key={`${group.category}${group.rate}`}
                  muted
                  label={translate('vatOn2', {
                    value1: group.category === 'S' ? `${group.rate}%` : group.category,
                    value2: formatMoney(group.taxable_amount, invoice.currency),
                  })}
                  value={formatMoney(group.vat_amount, invoice.currency)}
                />
              ))}
            {!isZero(invoice.rounding_amount) && (
              <TotalRow
                muted
                label={translate('rounding')}
                value={formatMoney(invoice.rounding_amount, invoice.currency)}
              />
            )}
            <TotalRow
              strong
              label={`Total ${invoice.vat_mode === 'exclusive' ? 'incl. VAT' : ''}`.trim()}
              value={formatMoney(fromCents(payable), invoice.currency)}
            />
            {invoice.prepayments.map((prepayment) => (
              <TotalRow
                key={prepayment.id}
                muted
                label={`Prepayment ${prepayment.number ?? ''}`.trim()}
                value={`−${formatMoney(prepayment.payable_total, invoice.currency)}`}
              />
            ))}
          </dl>
        </Panel>

        <InstalmentSchedule invoice={invoice} />
        {invoice.plan && <PlanCard planId={invoice.plan.id} canManage={canManage} />}
        {dunnable(invoice) && <DunningCard invoice={invoice} canManage={canManage} />}
        {invoice.status !== 'draft' && (
          <TransmissionsCard invoiceId={invoice.id} canManage={canManage} />
        )}

        <Panel title={translate('details')}>
          {invoice.plan && invoice.plan.seq > 0 && (
            <Row label={translate('instalment')}>
              {invoice.plan.seq}
              {translate('of5')}
              {invoice.plan.count}
            </Row>
          )}
          {invoice.status !== 'draft' && (invoice.instalments || invoice.plan) && (
            <RemindersRow invoice={invoice} canManage={canManage} />
          )}
          <Row label={translate('issueDate')}>{formatDay(invoice.issue_date)}</Row>
          <Row label={translate('dueDate')}>{formatDay(invoice.due_date)}</Row>
          {invoice.service_date && (
            <Row label={translate('service')}>
              {formatDay(invoice.service_date)}
              {invoice.service_date_end && ` – ${formatDay(invoice.service_date_end)}`}
            </Row>
          )}
          {invoice.reference && (
            <Row label={translate('clientReference')}>
              <span className="font-code">{invoice.reference}</span>
            </Row>
          )}
          <Row label={translate('languageVAT')}>
            {invoice.language.toUpperCase()} ·{' '}
            {invoice.vat_mode === 'none'
              ? translate('noVAT')
              : invoice.vat_mode === 'inclusive'
                ? translate('pricesInclVAT')
                : translate('pricesExclVAT')}
          </Row>
          {invoice.payment.reference && (
            <Row
              label={
                invoice.payment.reference_type === 'QRR'
                  ? translate('qrReference')
                  : translate('creditorReference')
              }
            >
              <span className="font-code">{groupReference(invoice.payment.reference)}</span>
            </Row>
          )}
          <Row label={translate('payTo')}>
            <span className="font-code">
              {invoice.payment.iban ? formatIban(invoice.payment.iban) : '—'}
            </span>
          </Row>
          {isReceivable(invoice.kind) && (
            <Row label={translate('paymentMethods')}>
              <PaymentSummary payment={invoice.payment} />
            </Row>
          )}
          {!isZero(invoice.amount_credited) && (
            <Row label={translate('creditNotes')}>
              <Link
                href={`/invoices?kind=credit_note&credited=${encodeURIComponent(invoice.id)}`}
                className="underline underline-offset-4 hover:no-underline"
              >
                {formatMoney(invoice.amount_credited, invoice.currency)}
                {translate('credited')}
              </Link>
            </Row>
          )}
        </Panel>

        {(invoice.intro || invoice.footer || invoice.note) && (
          <Panel title={translate('texts')}>
            {invoice.intro && (
              <Row label={translate('intro')} wrap>
                {invoice.intro}
              </Row>
            )}
            {invoice.footer && (
              <Row label={translate('footer')} wrap>
                {invoice.footer}
              </Row>
            )}
            {invoice.note && (
              <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">
                <span className="mb-0.5 block text-[12px] text-muted-foreground">
                  {translate('internalNote')}
                </span>
                {invoice.note}
              </p>
            )}
          </Panel>
        )}

        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {translate('created5')}
          {formatDate(invoice.created_at)}
          {translate('updated')}
          {formatDate(invoice.updated_at)}
        </p>
      </TabsContent>

      <TabsContent value="payments" className="p-4 sm:p-5">
        <Payments invoice={invoice} canManage={canManage} run={run} />
      </TabsContent>

      <TabsContent value="emails" className="p-4 sm:p-5">
        <Panel
          title={translate('sentByEmail')}
          action={
            (invoice.status === 'open' || invoice.status === 'paid') && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => run('send', invoice)}
              >
                <Send className="size-3.5" /> {invoice.sent_at ? 'Send again' : 'Send'}
              </Button>
            )
          }
        >
          {invoice.send_uncertain_at && (
            <p className="py-2 text-sm">
              {formatDate(invoice.send_uncertain_at)} · {translate('reminderDeliveryUnconfirmed')}
            </p>
          )}
          {invoice.unconfirmed_reminders?.map((r) => (
            <p key={`${r.seq}-${r.kind}-${r.offset_days}`} className="py-2 text-sm">
              {translate('instalment')} {r.seq} · {formatDate(r.at)} ·{' '}
              {translate('reminderDeliveryUnconfirmed')}
            </p>
          ))}
          {deliveries.data?.length ? (
            <ul className="divide-y divide-border/60">
              {deliveries.data.map((delivery) => (
                <li key={delivery.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Mail className="size-4 stroke-[1.5]" />
                  </span>
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate text-[14px]">{delivery.to.join(', ')}</span>
                    <span className="text-[12.5px] text-muted-foreground">
                      {delivery.kind === 'payment_confirmation' &&
                        `${translate('paymentConfirmation')} · `}
                      {translate('by2')}
                      {delivery.sent_by?.name ?? translate('system')}
                    </span>
                  </span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {formatDate(delivery.sent_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : invoice.send_uncertain_at || invoice.unconfirmed_reminders?.length ? null : (
            <p className="py-6 text-center text-[13.5px] text-muted-foreground">
              {deliveries.isLoading
                ? translate('loading')
                : translate('notSentYetSendItFromHereOrDownload')}
            </p>
          )}
        </Panel>
      </TabsContent>

      <TabsContent value="pdf" className="flex min-h-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto pl-1 text-[13px] text-muted-foreground">
            {pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : translate('loading')}
          </span>
          {invoice.pdf_document && (
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <RecordLink href={`/documents?file=${encodeURIComponent(invoice.pdf_document.id)}`}>
                <FolderOpen className="size-3.5" />
                {translate('openInDocuments')}
              </RecordLink>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={localizedHref(pdfUrl(invoice.id))} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              {translate('openInNewTab')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={localizedHref(pdfUrl(invoice.id, true))} download>
              <Download className="size-3.5" />
              {translate('download3')}
            </a>
          </Button>
        </div>
        {/* The viewer fills the rest of the drawer and scrolls its own pages. */}
        <PdfView
          key={invoice.updated_at}
          title={translate('pdfOf', { value1: documentName(invoice) })}
          src={pdfUrl(invoice.id)}
          onPages={setPages}
          className="min-h-[420px] flex-1 basis-0"
        />
      </TabsContent>
    </Tabs>
  )
}

/** The structured XML of an issued invoice: XRechnung or Peppol, e-Factura for a Romanian buyer and KSeF for a Polish seller. */
/** The e-invoice XML download, a choice of the formats the two countries allow. */
function useEinvoiceAction(invoice: Invoice): Action {
  const [busy, setBusy] = useState(false)
  const lock = useFeatureLock('einvoice_xml')
  const blocked = einvoiceBlock(invoice)
  const download = async (format: Parameters<typeof downloadEinvoice>[1]) => {
    if (busy) return
    setBusy(true)
    try {
      await downloadEinvoice(invoice.id, format)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return {
    id: 'einvoice',
    group: 'view',
    icon: <FileCode2 />,
    label: (
      <span className="grid">
        {translate('eInvoiceXML')}
        {blocked && (
          <span className="max-w-60 text-[12px] text-pretty text-muted-foreground">{blocked}</span>
        )}
      </span>
    ),
    disabled: Boolean(blocked),
    extra: lock && <PlanTag lock={lock} className="ml-1.5" />,
    submenu: einvoiceFormatsFor(invoice.seller?.country, invoice.buyer?.country).map((format) => ({
      id: format.value,
      group: 'view',
      icon: <FileCode2 />,
      label: (
        <span className="grid">
          {format.label}
          {format.hint && <span className="text-[12px] text-muted-foreground">{format.hint}</span>}
        </span>
      ),
      disabled: busy,
      disabledReason: lock?.hint,
      onSelect: () => void download(format.value),
    })),
  }
}

const useToggleReminders = () =>
  useInvoiceAction(({ id, on }: { id: string; on: boolean }) =>
    invoicesApi.update(id, { reminders_enabled: on }),
  )

/** Issued invoices keep one switch: whether the client gets payment reminders. */
function RemindersRow({ invoice, canManage }: { invoice: Invoice; canManage: boolean }) {
  const toggle = useToggleReminders()
  return (
    <Row label={translate('reminders')} wrap>
      <span className="flex items-center gap-2">
        <Switch
          aria-label={translate('paymentReminders')}
          checked={invoice.reminders_enabled}
          disabled={!canManage || toggle.isPending}
          onCheckedChange={(on) =>
            toggle.mutate(
              { id: invoice.id, on },
              {
                onSuccess: () =>
                  toast.success(on ? translate('remindersOn') : translate('remindersOff')),
                onError: toastError,
              },
            )
          }
        />
        <span className="text-[13px] text-muted-foreground">
          {invoice.reminders_enabled
            ? translate('sentBeforeAndAfterEachDueDate')
            : translate('off')}
        </span>
      </span>
    </Row>
  )
}

function TotalRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-4',
        muted && 'text-muted-foreground',
        strong && 'pt-1.5 text-[15px] font-medium',
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

/** Money in and back out, oldest first: payments and refunds (negative) in one list. */
export function moneyMovements(invoice: Pick<Invoice, 'payments' | 'refunds'>) {
  return [
    ...invoice.payments.map((payment) => ({
      kind: 'payment' as const,
      on: payment.paid_on,
      ...payment,
    })),
    ...invoice.refunds.map((refund) => ({
      kind: 'refund' as const,
      on: refund.refunded_on,
      ...refund,
    })),
  ].toSorted((a, b) => a.on.localeCompare(b.on) || a.created_at.localeCompare(b.created_at))
}

function Payments({ invoice, canManage, run }: { invoice: Invoice; canManage: boolean; run: Run }) {
  const rows = moneyMovements(invoice)
  const removePayment = useDeletePayment(invoice.id)
  const removeRefund = useDeleteRefund(invoice.id)
  const [deleting, setDeleting] = useState<{ kind: 'payment' | 'refund'; id: string } | null>(null)
  const open = invoice.status === 'open'
  const refundDue = isPositive(invoice.refund_due)
  return (
    <Panel
      title={translate('paymentsAndRefunds')}
      action={
        (open || refundDue) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => run(refundDue ? 'refund' : 'payment', invoice)}
          >
            {refundDue ? <Undo2 className="size-3.5" /> : <Wallet className="size-3.5" />}
            {refundDue ? 'Record refund' : 'Record payment'}
          </Button>
        )
      }
    >
      {rows.length ? (
        <ul className="divide-y divide-border/60">
          {rows.map((row) => {
            const refund = row.kind === 'refund'
            return (
              <li key={row.id} className="group/row flex items-center gap-3 py-2.5">
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    refund ? 'bg-warning-surface text-warning' : 'bg-success-surface text-success',
                  )}
                >
                  {refund ? (
                    <Undo2 className="size-4 stroke-[1.5]" />
                  ) : (
                    <Wallet className="size-4 stroke-[1.5]" />
                  )}
                </span>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="text-[14px]">
                    {refund && translate('refund')}
                    {PAYMENT_METHODS.find((method) => method.value === row.method)?.label} ·{' '}
                    {formatDay(row.on)}
                  </span>
                  <span className="truncate text-[12.5px] text-muted-foreground">
                    {[row.note, row.created_by?.name && `recorded by ${row.created_by.name}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Money
                  value={row.amount}
                  currency={invoice.currency}
                  negative={refund}
                  className="text-[14px]"
                />
                {canManage && (
                  <Button
                    variant="destructive-ghost"
                    size="icon-xs"
                    aria-label={translate('deleteOf', { kind: row.kind, amount: row.amount })}
                    className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                    onClick={() => setDeleting({ kind: row.kind, id: row.id })}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-[13.5px] text-muted-foreground">
          {open ? translate('noPaymentsYet') : translate('noPaymentsRecorded')}
        </p>
      )}
      {deleting && (
        <ConfirmDialog
          title={
            deleting.kind === 'refund'
              ? translate('deleteThisRefund')
              : translate('deleteThisPayment')
          }
          body={
            deleting.kind === 'refund'
              ? translate('theAmountCountsAsOwedBackToTheCustomer')
              : translate('theAmountCountsAsOwedAgainAndTheStatus')
          }
          confirmLabel={
            deleting.kind === 'refund' ? translate('deleteRefund') : translate('deletePayment')
          }
          tone="destructive"
          onDecide={(approved) => {
            const target = deleting
            setDeleting(null)
            if (!approved) return
            // A payment that funded a refund is refused (409): its message says why.
            const done = {
              onSuccess: () =>
                toast.success(
                  target.kind === 'refund'
                    ? translate('refundDeleted')
                    : translate('paymentDeleted'),
                ),
              onError: (error: unknown) => toast.error(errorMessage(error)),
            }
            if (target.kind === 'refund') removeRefund.mutate(target.id, done)
            else removePayment.mutate(target.id, done)
          }}
        />
      )}
    </Panel>
  )
}

/** How the summary names the invoice this one changes (BT-25). */
const RELATION: Partial<Record<Invoice['kind'], string>> = {
  debit_note: translate('relatedAddsTo'),
  corrected: translate('relatedCorrects'),
}

/** The invoice at a glance: who pays, how much, its state, and its dates and linked records. */
function InvoiceHero({
  invoice,
  payable,
  credit,
  progress,
}: {
  invoice: Invoice
  payable: bigint
  credit: boolean
  progress?: ReactNode
}) {
  const nextInstalment = invoice.instalments?.items.find((item) => isPositive(item.open))
  const dueDate = nextInstalment?.due_date ?? invoice.due_date
  return (
    <RecordHero
      progress={progress}
      label={credit ? translate('creditTo') : translate('billedTo')}
      client={invoice.client}
      currency={invoice.currency}
      amount={`${credit ? '−' : ''}${formatAmount(fromCents(payable))}`}
      // A draft says so in the header already.
      badge={
        invoice.status !== 'draft' ? (
          <InvoiceStatusBadge invoice={invoice} />
        ) : (
          <ApprovalBadge state={invoice.approval_state} />
        )
      }
    >
      <HeroFact
        label={translate('issueDate')}
        note={invoice.status === 'draft' && translate('notIssuedYet')}
      >
        {formatDay(invoice.issue_date)}
      </HeroFact>
      {invoice.status === 'open' && !credit && (
        <HeroFact
          label={
            nextInstalment
              ? translate('instalmentDueDate', { value1: nextInstalment.seq })
              : translate('dueDate')
          }
          note={dueLabel(dueDate)}
          urgent={invoice.is_overdue}
        >
          {formatDay(dueDate)}
        </HeroFact>
      )}
      {invoice.credited_invoice && (
        <HeroLink
          label={RELATION[invoice.kind] ?? translate('relatedCredits')}
          href={`/invoices?id=${encodeURIComponent(invoice.credited_invoice.id)}`}
          number={invoice.credited_invoice.number}
        />
      )}
      {invoice.quote && (
        <HeroLink
          label={translate('relatedQuote')}
          href={`/quotes?id=${encodeURIComponent(invoice.quote.id)}`}
          number={invoice.quote.number}
        />
      )}
      {invoice.deducted_on && (
        <HeroLink
          label={translate('relatedDeductedOn')}
          href={`/invoices?id=${encodeURIComponent(invoice.deducted_on.id)}`}
          number={invoice.deducted_on.number}
        />
      )}
    </RecordHero>
  )
}

/** What is paid of the invoice and what is still due, under its amount. */
function PaymentProgress({
  invoice,
  payable,
  paidShare,
}: {
  invoice: Invoice
  payable: bigint
  paidShare: number
}) {
  return (
    <div className="grid gap-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            isPositive(invoice.refund_due)
              ? 'bg-warning-solid'
              : invoice.status === 'void'
                ? 'bg-muted-foreground/40'
                : 'bg-success-solid',
          )}
          style={{ width: `${Math.min(100, paidShare)}%` }}
        />
      </div>
      {/* Every movement under its own name, so a credit and a refund are never read as payments. */}
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {!isZero(invoice.amount_credited) && (
          <div>
            <dt className="text-muted-foreground">{translate('total')}</dt>
            <dd className="text-title-sm tabular-nums">
              {formatMoney(fromCents(payable), invoice.currency)}
            </dd>
            {!isZero(invoice.amount_credited) && (
              <dd className="text-xs text-muted-foreground tabular-nums">
                {translate('netAfterCredits', {
                  amount: formatMoney(
                    fromCents(payable - toCents(invoice.amount_credited)),
                    invoice.currency,
                  ),
                })}
              </dd>
            )}
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">{translate('paid')}</dt>
          <dd className="text-title-sm tabular-nums">
            {formatMoney(invoice.amount_paid, invoice.currency)}
          </dd>
        </div>
        {!isZero(invoice.amount_credited) && (
          <div>
            <dt className="text-muted-foreground">{translate('creditedStatus')}</dt>
            <dd className="text-title-sm tabular-nums">
              {formatMoney(invoice.amount_credited, invoice.currency)}
            </dd>
          </div>
        )}
        {!isZero(invoice.amount_refunded) && (
          <div>
            <dt className="text-muted-foreground">{translate('refundedStatus')}</dt>
            <dd className="text-title-sm tabular-nums">
              {formatMoney(invoice.amount_refunded, invoice.currency)}
            </dd>
          </div>
        )}
        <div className="ml-auto text-right">
          <dt className="text-muted-foreground">
            {isPositive(invoice.refund_due) ? translate('owedBack') : translate('due')}
          </dt>
          <dd className="text-title-sm font-medium tabular-nums">
            {formatMoney(
              isPositive(invoice.refund_due) ? invoice.refund_due : invoice.amount_due,
              invoice.currency,
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
