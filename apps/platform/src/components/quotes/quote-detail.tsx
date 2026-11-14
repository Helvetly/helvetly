'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowUpRight,
  Check,
  Download,
  Ellipsis,
  ExternalLink,
  FilePen,
  Pencil,
  ReceiptText,
  Send,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Money } from '@/components/invoices/invoice-bits'
import { PdfView } from '@/components/invoices/pdf-view'
import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { formatAmount, formatDay, formatMoney, isZero, UNITS } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import {
  quoteCommands,
  quoteName,
  quoteNumber,
  quotePdfUrl,
  quotesApi,
  useDeleteQuote,
  useQuote,
  useQuoteAction,
  type Quote,
  type QuoteCommand,
} from '@/lib/quotes'

import { QuoteStatusBadge } from './quote-bits'
import { failQuote, QuoteDecisionDialog, QuoteSendDialog } from './quote-dialogs'
import { EDITOR_WIDTH, QuoteEditor } from './quote-editor'

/** One quote in a drawer from the right (full screen on phones); editing happens in the same drawer. */
export function QuoteDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuote(id)
  const quote = query.data
  const [editing, setEditing] = useState(false)

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
        <SheetTitle className="sr-only">{quote ? quoteName(quote) : 'Quote'}</SheetTitle>
        <SheetDescription className="sr-only">Quote details</SheetDescription>
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
            <p className="text-title-sm">This quote couldn’t be loaded.</p>
            <p className="text-sm text-muted-foreground">{errorMessage(query.error)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
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

type Action = { command: QuoteCommand; label: string; icon: LucideIcon }

const ACTIONS: Record<QuoteCommand, Action> = {
  edit: { command: 'edit', label: 'Edit draft', icon: Pencil },
  send: { command: 'send', label: 'Send', icon: Send },
  accept: { command: 'accept', label: 'Accept', icon: Check },
  decline: { command: 'decline', label: 'Decline', icon: X },
  revise: { command: 'revise', label: 'Revise', icon: FilePen },
  invoice: { command: 'invoice', label: 'Create invoice', icon: ReceiptText },
  delete: { command: 'delete', label: 'Delete draft', icon: Trash2 },
}

/** The "…" menu's order; Edit has its own button. */
const MENU: QuoteCommand[] = ['send', 'accept', 'decline', 'revise', 'invoice', 'delete']

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
  const [dialog, setDialog] = useState<QuoteCommand | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const remove = useDeleteQuote()
  const revise = useQuoteAction(() => quotesApi.revise(quote.id))
  const invoice = useQuoteAction(() => quotesApi.invoice(quote.id))
  const busy = revise.isPending || invoice.isPending || remove.isPending
  const can = quoteCommands(quote)
  const primary = writable ? primaryCommand(quote) : null
  const menu = MENU.filter((command) => writable && can[command] && command !== primary)
  const name = quoteName(quote)

  const run = (command: QuoteCommand) => (command === 'edit' ? onEdit() : setDialog(command))
  const decide = (approved: boolean) => {
    const command = dialog
    setDialog(null)
    if (!approved) return
    if (command === 'revise')
      revise.mutate(undefined, {
        onSuccess: (revised) => {
          toast.success(`${quoteName(revised)} is a draft again. Change it, then send it.`)
          onEdit()
        },
        onError: failQuote,
      })
    if (command === 'invoice')
      invoice.mutate(undefined, {
        onSuccess: (converted) => {
          toast.success(`Draft invoice created from ${name}.`)
          if (converted.invoice)
            router.push(`/invoices?id=${encodeURIComponent(converted.invoice.id)}`)
        },
        onError: failQuote,
      })
    if (command === 'delete')
      remove.mutate(quote.id, {
        onSuccess: () => {
          toast.success('Draft quote deleted.')
          onClose()
        },
        onError: failQuote,
      })
  }

  return (
    <Tabs defaultValue="overview" className="min-h-full gap-0">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
          <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground tabular-nums">
            {quoteNumber(quote)}
          </span>
          <span className="ml-1.5 text-body-sm text-muted-foreground">Quote</span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More actions">
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>More actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="min-w-52">
                {menu
                  .filter((command) => command !== 'delete')
                  .map((command) => {
                    const { label, icon: Icon } = ACTIONS[command]
                    return (
                      <DropdownMenuItem key={command} onSelect={() => run(command)}>
                        <Icon /> {command === 'send' && quote.sent_at ? 'Send again' : label}
                      </DropdownMenuItem>
                    )
                  })}
                <DropdownMenuItem asChild>
                  <a href={quotePdfUrl(quote.id, true)} download>
                    <Download /> Download PDF
                  </a>
                </DropdownMenuItem>
                {menu.includes('delete') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => run('delete')}>
                      <Trash2 /> Delete draft
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {writable && can.edit && (
              <Button variant="outline" className="gap-1.5" onClick={onEdit}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            <PrimaryButton quote={quote} command={primary} busy={busy} onRun={run} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="grid gap-5 px-6 pt-6">
          <div className="grid gap-2">
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-body-sm text-muted-foreground">
              Quote for
              <RecordLink
                href={`/clients?id=${encodeURIComponent(quote.client.id)}`}
                className="group inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                {quote.client.name}
                <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </RecordLink>
              <span className="text-caption tabular-nums">· client {quote.client.number}</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex items-baseline gap-2 text-display font-normal tabular-nums">
                <span className="text-title-sm text-muted-foreground">{quote.currency}</span>
                {formatAmount(quote.payable_total)}
              </h2>
              <QuoteStatusBadge status={quote.status} />
            </div>
            <p className="text-body-sm text-muted-foreground">{validity(quote)}</p>
          </div>

          {quote.decided_at && (
            <Callout
              tone={quote.status === 'accepted' ? 'success' : 'neutral'}
              icon={quote.status === 'accepted' ? Check : X}
            >
              <span className="font-medium">
                {quote.status === 'accepted' ? 'Accepted' : 'Declined'}{' '}
                {quote.decided_by === 'client'
                  ? 'by the client in the portal'
                  : 'as recorded by your team'}{' '}
                on {formatDate(quote.decided_at)}
              </span>
              {quote.decision_note && (
                <span className="block text-muted-foreground">“{quote.decision_note}”</span>
              )}
            </Callout>
          )}

          {quote.invoice && (
            <Callout tone="info" icon={ReceiptText}>
              {quote.invoice.number ? 'Invoiced as ' : 'Turned into a '}
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(quote.invoice.id)}`}
                className="font-medium underline underline-offset-4 hover:no-underline"
              >
                {quote.invoice.number || 'draft invoice'}
              </RecordLink>
              {quote.invoice.number ? '.' : ': issue it from there.'}
            </Callout>
          )}

          <TabsList variant="line" className="-mb-px h-10 gap-4 p-0">
            {[
              { value: 'overview', label: 'Overview' },
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
        <Panel title="Lines">
          <ul className="divide-y divide-border/60">
            {quote.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3 py-2.5 first:pt-1">
                <span className="w-5 shrink-0 pt-px text-caption text-muted-foreground tabular-nums">
                  {line.position}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-body whitespace-pre-line">{line.description}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {line.quantity}
                    {line.unit &&
                      ` ${UNITS.find((unit) => unit.value === line.unit)?.short ?? line.unit}`}{' '}
                    × {formatMoney(line.unit_price, quote.currency)}
                    {!isZero(line.discount_percent) && ` · −${line.discount_percent}%`}
                    {quote.vat_mode !== 'none' &&
                      ` · VAT ${line.vat_category === 'S' ? `${line.vat_rate}%` : line.vat_category}`}
                  </span>
                </span>
                <Money value={line.amount} currency={quote.currency} className="text-body" />
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-1.5 border-t border-border/60 pt-3 text-body-sm">
            <Total label="Subtotal" value={formatMoney(quote.subtotal, quote.currency)} />
            {!isZero(quote.discount_amount) && (
              <Total
                label={`Discount ${quote.discount_percent}%`}
                value={`−${formatMoney(quote.discount_amount, quote.currency)}`}
              />
            )}
            {quote.vat_mode !== 'none' &&
              quote.vat_breakdown.map((group) => (
                <Total
                  key={`${group.category}${group.rate}`}
                  muted
                  label={`VAT ${group.category === 'S' ? `${group.rate}%` : group.category} on ${formatMoney(group.taxable_amount, quote.currency)}`}
                  value={formatMoney(group.vat_amount, quote.currency)}
                />
              ))}
            {!isZero(quote.rounding_amount) && (
              <Total
                muted
                label="Rounding"
                value={formatMoney(quote.rounding_amount, quote.currency)}
              />
            )}
            <Total strong label="Total" value={formatMoney(quote.payable_total, quote.currency)} />
          </dl>
        </Panel>

        <Panel title="Details">
          <Row label="Date">{formatDay(quote.issue_date)}</Row>
          <Row label="Valid until">{formatDay(quote.valid_until)}</Row>
          {quote.revision > 1 && <Row label="Revision">{quote.revision}</Row>}
          {quote.reference && <Row label="Reference">{quote.reference}</Row>}
          <Row label="Language · VAT">
            {quote.language.toUpperCase()} ·{' '}
            {quote.vat_mode === 'none'
              ? 'No VAT'
              : quote.vat_mode === 'inclusive'
                ? 'Prices incl. VAT'
                : 'Prices excl. VAT'}
          </Row>
          {quote.sent_at && <Row label="Last sent">{formatDate(quote.sent_at)}</Row>}
        </Panel>

        {(quote.intro || quote.footer || quote.note) && (
          <Panel title="Texts">
            {quote.intro && <Row label="Intro">{quote.intro}</Row>}
            {quote.footer && <Row label="Footer">{quote.footer}</Row>}
            {quote.note && (
              <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2.5 text-body-sm leading-relaxed whitespace-pre-wrap">
                <span className="mb-0.5 block text-caption text-muted-foreground">
                  Internal note
                </span>
                {quote.note}
              </p>
            )}
          </Panel>
        )}

        <p className="px-1 pt-1 text-xs text-muted-foreground">
          Created {formatDate(quote.created_at)} · Updated {formatDate(quote.updated_at)}
        </p>
      </TabsContent>

      <TabsContent value="pdf" className="grid content-start gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto pl-1 text-body-sm text-muted-foreground">
            {quote.status === 'draft'
              ? 'Draft: printed with a DRAFT mark until it is sent'
              : pages
                ? `${pages} ${pages === 1 ? 'page' : 'pages'}, as last sent`
                : 'Loading…'}
          </span>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={quotePdfUrl(quote.id)} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" /> Open in new tab
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={quotePdfUrl(quote.id, true)} download>
              <Download className="size-3.5" /> Download
            </a>
          </Button>
        </div>
        <PdfView
          key={quote.updated_at}
          title={`PDF of ${name}`}
          src={quotePdfUrl(quote.id)}
          onPages={setPages}
          className="overflow-visible rounded-xl"
        />
      </TabsContent>

      {dialog === 'send' && <QuoteSendDialog quote={quote} onClose={() => setDialog(null)} />}
      {(dialog === 'accept' || dialog === 'decline') && (
        <QuoteDecisionDialog
          quote={quote}
          accept={dialog === 'accept'}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'revise' && (
        <ConfirmDialog
          title={`Revise ${name}?`}
          body={`It becomes a draft again as revision ${quote.revision + 1}, with the same number. The client sees it again once you send it.`}
          confirmLabel="Revise"
          tone="default"
          onDecide={decide}
        />
      )}
      {dialog === 'invoice' && (
        <ConfirmDialog
          title={`Create an invoice from ${name}?`}
          body="A draft invoice with this quote’s client, lines and texts opens. Its dates and payment methods are your invoice defaults."
          confirmLabel="Create invoice"
          tone="default"
          onDecide={decide}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this draft quote?"
          body={`The draft for ${quote.client.name} is removed for good. It was never sent, so no number goes missing.`}
          confirmLabel="Delete draft"
          tone="destructive"
          onDecide={decide}
        />
      )}
    </Tabs>
  )
}

/** "Valid until 3 Dec 2026", or what the draft or answer means for it. */
function validity(quote: Quote) {
  const until = formatDay(quote.valid_until)
  if (quote.status === 'draft')
    return `${quote.number ? 'Revised, not sent again yet' : 'Not sent yet'} · dated ${formatDay(quote.issue_date)}`
  if (quote.status === 'expired') return `Expired on ${until}`
  if (quote.status === 'sent') return `Valid until ${until}`
  return `Dated ${formatDay(quote.issue_date)} · valid until ${until}`
}

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
          <ReceiptText /> Open invoice
        </RecordLink>
      </Button>
    ) : (
      <Button asChild className="gap-1.5">
        <a href={quotePdfUrl(quote.id, true)} download>
          <Download /> Download PDF
        </a>
      </Button>
    )
  const { label, icon: Icon } = ACTIONS[command]
  return (
    <Button className="gap-1.5" disabled={busy} onClick={() => onRun(command)}>
      <Icon /> {command === 'send' && quote.sent_at ? 'Send again' : label}
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
