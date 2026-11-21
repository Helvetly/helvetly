'use client'
import { localizedHref } from '@helvetly/i18n'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Check,
  Copy,
  Download,
  FilePen,
  PanelRightOpen,
  Pencil,
  ReceiptText,
  Send,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import type { MenuKit } from '@/components/data/menus'
import { translate } from '@/lib/i18n'
import {
  quoteCommands,
  quoteName,
  quotePdfUrl,
  quotesApi,
  useDeleteQuote,
  useQuoteAction,
  type Quote,
  type QuoteCommand,
} from '@/lib/quotes'

import { failQuote, QuoteDecisionDialog, QuoteSendDialog } from './quote-dialogs'

type Action = { label: string; icon: LucideIcon }

export const ACTIONS: Record<QuoteCommand, Action> = {
  edit: { label: translate('editDraft2'), icon: Pencil },
  send: { label: translate('send'), icon: Send },
  accept: { label: translate('accept'), icon: Check },
  decline: { label: translate('decline'), icon: X },
  revise: { label: translate('revise'), icon: FilePen },
  invoice: { label: translate('createInvoice'), icon: ReceiptText },
  duplicate: { label: translate('duplicateQuote'), icon: Copy },
  delete: { label: translate('deleteDraft2'), icon: Trash2 },
}

/** The menus' order; delete goes last, apart. */
const MENU: QuoteCommand[] = ['send', 'accept', 'decline', 'revise', 'invoice', 'duplicate']

/** "Send again" for a quote that went out before, the command's own label otherwise. */
export const commandLabel = (command: QuoteCommand, quote: Quote) =>
  command === 'send' && quote.sent_at ? translate('sendAgain') : ACTIONS[command].label

type Handlers = {
  /** Edit, and a revised quote: open it in the editor. */
  onEdit: (quote: Quote) => void
  /** A quote was made (a copy): show it. */
  onOpen: (id: string) => void
  onDeleted?: (quote: Quote) => void
  /** The invoice made from an accepted quote. */
  onInvoice: (id: string) => void
}

/**
 * A quote's commands for its drawer and its row in a list: `run` starts one, opening its dialog where
 * it has one; `dialogs` renders that dialog.
 */
export function useQuoteCommands(handlers: Handlers) {
  const [pending, setPending] = useState<{ command: QuoteCommand; quote: Quote } | null>(null)
  const remove = useDeleteQuote()
  const revise = useQuoteAction((id: string) => quotesApi.revise(id))
  const invoice = useQuoteAction((id: string) => quotesApi.invoice(id))
  const duplicate = useQuoteAction((id: string) => quotesApi.duplicate(id))
  const busy = revise.isPending || invoice.isPending || remove.isPending || duplicate.isPending

  const run = (command: QuoteCommand, quote: Quote) => {
    if (command === 'edit') return handlers.onEdit(quote)
    if (command === 'duplicate')
      return duplicate.mutate(quote.id, {
        onSuccess: (copy) => {
          toast.success(translate('quoteDuplicated', { name: quoteName(quote) }))
          handlers.onOpen(copy.id)
        },
        onError: failQuote,
      })
    setPending({ command, quote })
  }

  const decide = (approved: boolean) => {
    const current = pending
    setPending(null)
    if (!approved || !current) return
    const { command, quote } = current
    const name = quoteName(quote)
    if (command === 'revise')
      revise.mutate(quote.id, {
        onSuccess: (revised) => {
          toast.success(
            translate('isADraftAgainChangeItThenSendIt', { value1: quoteName(revised) }),
          )
          handlers.onEdit(revised)
        },
        onError: failQuote,
      })
    if (command === 'invoice')
      invoice.mutate(quote.id, {
        onSuccess: (converted) => {
          toast.success(translate('draftInvoiceCreatedFrom', { name }))
          if (converted.invoice) handlers.onInvoice(converted.invoice.id)
        },
        onError: failQuote,
      })
    if (command === 'delete')
      remove.mutate(quote.id, {
        onSuccess: () => {
          toast.success(translate('draftQuoteDeleted'))
          handlers.onDeleted?.(quote)
        },
        onError: failQuote,
      })
  }

  const close = () => setPending(null)
  const quote = pending?.quote
  const name = quote ? quoteName(quote) : ''
  const dialogs = quote && (
    <>
      {pending.command === 'send' && <QuoteSendDialog quote={quote} onClose={close} />}
      {(pending.command === 'accept' || pending.command === 'decline') && (
        <QuoteDecisionDialog quote={quote} accept={pending.command === 'accept'} onClose={close} />
      )}
      {pending.command === 'revise' && (
        <ConfirmDialog
          title={translate('revise2', { name })}
          body={translate('itBecomesADraftAgainAsRevisionWithThe', { value1: quote.revision + 1 })}
          confirmLabel={translate('revise')}
          tone="default"
          onDecide={decide}
        />
      )}
      {pending.command === 'invoice' && (
        <ConfirmDialog
          title={translate('createAnInvoiceFrom', { name })}
          body={translate('aDraftInvoiceWithThisQuoteSClientLines')}
          confirmLabel={translate('createInvoice')}
          tone="default"
          onDecide={decide}
        />
      )}
      {pending.command === 'delete' && (
        <ConfirmDialog
          title={translate('deleteThisDraftQuote')}
          body={translate('theDraftForIsRemovedForGoodItWas', { name: quote.client.name })}
          confirmLabel={translate('deleteDraft2')}
          tone="destructive"
          onDecide={decide}
        />
      )}
    </>
  )

  return { run, busy, dialogs }
}

/**
 * A quote's menu items, for the drawer's "…" and a row's "…" and right-click menus: the commands its
 * state allows (writers only), the PDF, then deleting a draft apart. `skip` leaves out those shown as
 * buttons beside the menu.
 */
export function QuoteMenuItems({
  kit: { Item, Separator },
  quote,
  writable,
  run,
  onOpen,
  skip,
}: {
  kit: MenuKit
  quote: Quote
  writable: boolean
  run: (command: QuoteCommand, quote: Quote) => void
  onOpen?: () => void
  skip?: QuoteCommand[]
}) {
  const can = quoteCommands(quote)
  const allowed = (command: QuoteCommand) => writable && can[command] && !skip?.includes(command)
  return (
    <>
      {onOpen && (
        <Item onSelect={onOpen}>
          <PanelRightOpen />
          {translate('openDetails')}
        </Item>
      )}
      {allowed('edit') && (
        <Item onSelect={() => run('edit', quote)}>
          <Pencil />
          {translate('edit4')}
        </Item>
      )}
      {MENU.filter(allowed).map((command) => {
        const Icon = ACTIONS[command].icon
        return (
          <Item key={command} onSelect={() => run(command, quote)}>
            <Icon />
            {commandLabel(command, quote)}
          </Item>
        )
      })}
      <Item asChild>
        <a href={localizedHref(quotePdfUrl(quote.id, true))} download>
          <Download />
          {translate('downloadPDF2')}
        </a>
      </Item>
      {allowed('delete') && (
        <>
          <Separator />
          <Item variant="destructive" onSelect={() => run('delete', quote)}>
            <Trash2 />
            {translate('deleteDraft')}
          </Item>
        </>
      )}
    </>
  )
}
