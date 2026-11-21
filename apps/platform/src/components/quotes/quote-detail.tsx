'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, Download, Ellipsis, ExternalLink, Pencil, ReceiptText, Send, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import {
  ApprovalGate,
  ApprovalPanel,
  awaitsApproval,
  showsApproval,
} from '@/components/approvals/approval-panel'
import { dropdownKit } from '@/components/data/menus'
import { Money } from '@/components/invoices/invoice-bits'
import { PdfView } from '@/components/invoices/pdf-view'
import { HeroFact, RecordHero } from '@/components/invoices/record-hero'
import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { useApproval } from '@/lib/approvals'
import { translate } from '@/lib/i18n'
import { formatAmount, formatDay, formatMoney, isZero, repeatsAmount, UNITS } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import {
  quoteCommands,
  quoteName,
  quoteNumber,
  quotePdfUrl,
  useQuote,
  type Quote,
  type QuoteCommand,
} from '@/lib/quotes'

import { QuoteRowStatus } from './quote-bits'
import { ACTIONS, commandLabel, QuoteMenuItems, useQuoteCommands } from './quote-commands'
import { EDITOR_WIDTH, QuoteEditor } from './quote-editor'

/** One quote in a drawer from the right (full screen on phones); editing happens in the same drawer. */
export function QuoteDetail({
  id,
  onClose,
  edit = false,
}: {
  id: string
  onClose: () => void
  /** Opens in the editor (a draft's Edit in a list). */
  edit?: boolean
}) {
  const query = useQuote(id)
  const quote = query.data
  const [editing, setEditing] = useState(edit)

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          'w-full! max-w-none! gap-0 overflow-y-auto bg-panel p-0 dark:bg-background',
          editing ? EDITOR_WIDTH : 'sm:w-[min(680px,100vw)]!',
        )}
      >
        <SheetTitle className="sr-only">
          {quote ? quoteName(quote) : translate('quote2')}
        </SheetTitle>
        <SheetDescription className="sr-only">{translate('quoteDetails')}</SheetDescription>
        {quote && editing ? (
          <QuoteEditor
            quote={quote}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        ) : quote ? (
          <Detail quote={quote} onClose={onClose} onEdit={() => setEditing(true)} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-title-sm">{translate('thisQuoteCouldnTBeLoaded')}</p>
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

/** The main button for the quote's state; the rest goes in the "…" menu. */
export function primaryCommand(quote: Quote): QuoteCommand | null {
  const can = quoteCommands(quote)
  if (quote.status === 'draft') return 'send'
  if (quote.status === 'sent') return 'accept'
  if (can.invoice) return 'invoice'
  if (can.revise) return 'revise'
  return null
}

function Detail({
  quote,
  onClose,
  onEdit,
}: {
  quote: Quote
  onClose: () => void
  onEdit: () => void
}) {
  const router = useRouter()
  const writable = useCan('write:invoices')
  const [pages, setPages] = useState<number | null>(null)
  const commands = useQuoteCommands({
    onEdit,
    onOpen: (copy) => router.push(`/quotes?id=${encodeURIComponent(copy)}`),
    onDeleted: onClose,
    onInvoice: (invoice) => router.push(`/invoices?id=${encodeURIComponent(invoice)}`),
  })
  const can = quoteCommands(quote)
  const primary = writable ? primaryCommand(quote) : null
  const target = { doc: 'quotes', id: quote.id } as const
  const approval = useApproval(target, quote.status === 'draft').data
  // Sending a draft (or a new revision) waits for its approval when the policy asks for one.
  const gated = quote.status === 'draft' && awaitsApproval(approval)
  const skip: QuoteCommand[] = [
    'edit',
    ...(primary ? [primary] : []),
    ...(gated ? (['send'] as const) : []),
  ]
  const name = quoteName(quote)
  const run = (command: QuoteCommand) => commands.run(command, quote)

  return (
    <Tabs defaultValue="overview" className="min-h-full gap-0">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
          <Badge size="sm" className={cn('ml-1 tabular-nums', quote.number && 'font-code')}>
            {quoteNumber(quote)}
          </Badge>
          <span className="ml-1.5 text-body-sm text-muted-foreground">{translate('quote2')}</span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={translate('moreActions')}>
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{translate('moreActions')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="min-w-52">
                <QuoteMenuItems
                  kit={dropdownKit}
                  quote={quote}
                  writable={writable}
                  run={commands.run}
                  skip={skip}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {writable && can.edit && (
              <Button variant="outline" className="gap-1.5" onClick={onEdit}>
                <Pencil className="size-3.5" />
                {translate('edit4')}
              </Button>
            )}
            {gated && primary === 'send' ? (
              <ApprovalGate target={target} approval={approval}>
                <Send /> {ACTIONS.send.label}
              </ApprovalGate>
            ) : (
              <PrimaryButton quote={quote} command={primary} busy={commands.busy} onRun={run} />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('close')}
                  onClick={onClose}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('close')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="grid gap-5 px-6 pt-6">
          <RecordHero
            label={translate('quoteFor')}
            client={quote.client}
            currency={quote.currency}
            amount={formatAmount(quote.payable_total)}
            badge={<QuoteRowStatus quote={quote} />}
          >
            <HeroFact
              label={translate('issueDate')}
              note={
                quote.status === 'draft' &&
                (quote.number ? translate('revisedNotSentAgainYet') : translate('notSentYet'))
              }
            >
              {formatDay(quote.issue_date)}
            </HeroFact>
            <HeroFact
              label={translate('validUntilLabel')}
              note={quote.status === 'expired' && translate('expired')}
              urgent={quote.status === 'expired'}
            >
              {formatDay(quote.valid_until)}
            </HeroFact>
          </RecordHero>

          {quote.decided_at && (
            <Callout
              tone={quote.status === 'accepted' ? 'success' : 'neutral'}
              icon={quote.status === 'accepted' ? Check : X}
            >
              <span className="font-medium">
                {quote.status === 'accepted' ? translate('accepted') : translate('declined')}{' '}
                {quote.decided_by === 'client'
                  ? translate('byTheClientInThePortal')
                  : translate('asRecordedByYourTeam')}{' '}
                {translate('on3')}
                {formatDate(quote.decided_at)}
              </span>
              {quote.decision_note && (
                <span className="block text-muted-foreground">“{quote.decision_note}”</span>
              )}
            </Callout>
          )}

          {quote.invoice && (
            <Callout tone="info" icon={ReceiptText}>
              {quote.invoice.number ? translate('invoicedAs') : translate('turnedIntoA')}
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(quote.invoice.id)}`}
                className="font-medium underline underline-offset-4 hover:no-underline"
              >
                {quote.invoice.number || translate('draftInvoice')}
              </RecordLink>
              {quote.invoice.number ? '.' : translate('issueItFromThere')}
            </Callout>
          )}

          <TabsList variant="line" className="-mb-px h-10 gap-4 p-0">
            {[
              { value: 'overview', label: translate('overview') },
              { value: 'pdf', label: 'PDF' },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-full flex-none px-0 text-body font-normal after:bottom-0! after:h-[2px] after:bg-primary"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="border-b border-border/60" />
      </header>

      <TabsContent value="overview" className="grid content-start gap-3 p-4 sm:p-5">
        {showsApproval(approval) && <ApprovalPanel target={target} approval={approval} />}
        <Panel title={translate('lines')}>
          <ul className="divide-y divide-border/60">
            {quote.lines.map((line) => (
              <li key={line.id} className="flex items-center gap-3 py-2 first:pt-0.5">
                <span className="w-5 shrink-0 text-caption text-muted-foreground tabular-nums">
                  {line.position}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="text-body whitespace-pre-line">{line.description}</span>
                  {!repeatsAmount(line, quote.vat_mode) && (
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {line.quantity}
                      {line.unit &&
                        ` ${UNITS.find((unit) => unit.value === line.unit)?.short ?? line.unit}`}{' '}
                      × {formatMoney(line.unit_price, quote.currency)}
                      {!isZero(line.discount_percent) && ` · −${line.discount_percent}%`}
                      {quote.vat_mode !== 'none' &&
                        translate('vat3', {
                          value1:
                            line.vat_category === 'S' ? `${line.vat_rate}%` : line.vat_category,
                        })}
                    </span>
                  )}
                </span>
                <Money value={line.amount} currency={quote.currency} className="text-body" />
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-1.5 border-t border-border/60 pt-3 text-body-sm">
            <Total
              label={translate('subtotal')}
              value={formatMoney(quote.subtotal, quote.currency)}
            />
            {!isZero(quote.discount_amount) && (
              <Total
                label={translate('discount', { discount_percent: quote.discount_percent })}
                value={`−${formatMoney(quote.discount_amount, quote.currency)}`}
              />
            )}
            {quote.vat_mode !== 'none' &&
              quote.vat_breakdown.map((group) => (
                <Total
                  key={`${group.category}${group.rate}`}
                  muted
                  label={translate('vatOn2', {
                    value1: group.category === 'S' ? `${group.rate}%` : group.category,
                    value2: formatMoney(group.taxable_amount, quote.currency),
                  })}
                  value={formatMoney(group.vat_amount, quote.currency)}
                />
              ))}
            {!isZero(quote.rounding_amount) && (
              <Total
                muted
                label={translate('rounding')}
                value={formatMoney(quote.rounding_amount, quote.currency)}
              />
            )}
            <Total
              strong
              label={translate('total')}
              value={formatMoney(quote.payable_total, quote.currency)}
            />
          </dl>
        </Panel>

        <Panel title={translate('details')}>
          <Row label={translate('date')}>{formatDay(quote.issue_date)}</Row>
          <Row label={translate('validUntil3')}>{formatDay(quote.valid_until)}</Row>
          {quote.revision > 1 && <Row label={translate('revision')}>{quote.revision}</Row>}
          {quote.reference && <Row label={translate('reference')}>{quote.reference}</Row>}
          <Row label={translate('languageVAT')}>
            {quote.language.toUpperCase()} ·{' '}
            {quote.vat_mode === 'none'
              ? translate('noVAT')
              : quote.vat_mode === 'inclusive'
                ? translate('pricesInclVAT')
                : translate('pricesExclVAT')}
          </Row>
          {quote.sent_at && <Row label={translate('lastSent')}>{formatDate(quote.sent_at)}</Row>}
        </Panel>

        {(quote.intro || quote.footer || quote.note) && (
          <Panel title={translate('texts')}>
            {quote.intro && <Row label={translate('intro')}>{quote.intro}</Row>}
            {quote.footer && <Row label={translate('footer')}>{quote.footer}</Row>}
            {quote.note && (
              <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2.5 text-body-sm leading-relaxed whitespace-pre-wrap">
                <span className="mb-0.5 block text-caption text-muted-foreground">
                  {translate('internalNote')}
                </span>
                {quote.note}
              </p>
            )}
          </Panel>
        )}

        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {translate('created5')}
          {formatDate(quote.created_at)}
          {translate('updated')}
          {formatDate(quote.updated_at)}
        </p>
      </TabsContent>

      <TabsContent value="pdf" className="flex min-h-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto pl-1 text-body-sm text-muted-foreground">
            {quote.status === 'draft'
              ? translate('draftPrintedWithADRAFTMarkUntilItIs')
              : pages
                ? translate('asLastSent', { pages: pages, value2: pages === 1 ? 'page' : 'pages' })
                : translate('loading')}
          </span>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={localizedHref(quotePdfUrl(quote.id))} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              {translate('openInNewTab')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={localizedHref(quotePdfUrl(quote.id, true))} download>
              <Download className="size-3.5" />
              {translate('download3')}
            </a>
          </Button>
        </div>
        <PdfView
          key={quote.updated_at}
          title={translate('pdfOf2', { name: name })}
          src={quotePdfUrl(quote.id)}
          onPages={setPages}
          className="min-h-[420px] flex-1 basis-0 rounded-lg"
        />
      </TabsContent>

      {commands.dialogs}
    </Tabs>
  )
}

/** "Valid until 3 Dec 2026", or what the draft or answer means for it. */
function PrimaryButton({
  quote,
  command,
  busy,
  onRun,
}: {
  quote: Quote
  command: QuoteCommand | null
  busy: boolean
  onRun: (command: QuoteCommand) => void
}) {
  if (command === null)
    return quote.invoice ? (
      <Button asChild className="gap-1.5">
        <RecordLink href={`/invoices?id=${encodeURIComponent(quote.invoice.id)}`}>
          <ReceiptText />
          {translate('openInvoice')}
        </RecordLink>
      </Button>
    ) : (
      <Button asChild className="gap-1.5">
        <a href={localizedHref(quotePdfUrl(quote.id, true))} download>
          <Download />
          {translate('downloadPDF2')}
        </a>
      </Button>
    )
  const Icon = ACTIONS[command].icon
  return (
    <Button className="gap-1.5" disabled={busy} onClick={() => onRun(command)}>
      <Icon /> {commandLabel(command, quote)}
    </Button>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-3 border-t border-border/60 first:border-t-0">
      <span className="w-36 shrink-0 text-body-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-body">{children}</span>
    </div>
  )
}

function Total({
  label,
  value,
  muted,
  strong,
}: {
  label: string
  value: string
  muted?: boolean
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3',
        muted && 'text-muted-foreground',
        strong && 'pt-1 text-body font-medium',
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
