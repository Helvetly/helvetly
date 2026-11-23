'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { AlertCircle, Check, Copy, FileText, RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { lazy, Suspense, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useOpenHref } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import type { HeidiAction } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { documentName, useSendInvoice } from '@/lib/invoices'

import { ActivityLine } from './activity-line'
import { HeidiFormView } from './heidi-form'
import { ImportCard } from './import-card'
import { MessageMenu } from './message-menu'
import { splitQuote } from './quote'
import { Records, recordsText } from './records'
import type { ChatMessage } from './use-heidi'

// react-markdown and remark-gfm load with the first answer, not with every page that has the panel.
const Markdown = lazy(() => import('./markdown').then((module) => ({ default: module.Markdown })))

/** What an action button does: a page of ours, or (for sending) a confirmation first. */
function Actions({ actions }: { actions: HeidiAction[] }) {
  const router = useRouter()
  const openHref = useOpenHref()
  const [sending, setSending] = useState<Extract<HeidiAction, { id: 'send_invoice' }> | null>(null)
  const send = useSendInvoice()

  const run = (action: HeidiAction) => {
    switch (action.id) {
      case 'open_client':
        return openHref(`/clients?id=${encodeURIComponent(action.client_id)}`)
      case 'open_engagement':
        return openHref(`/engagements?id=${encodeURIComponent(action.engagement_id)}`)
      case 'open_invoice':
        return openHref(`/invoices?id=${encodeURIComponent(action.invoice_id)}`)
      case 'open_session':
        return openHref(`/scheduling?session=${encodeURIComponent(action.occurrence_id)}`)
      case 'list_overdue_invoices':
        return router.push('/invoices?status=overdue&kind=invoice')
      case 'create_invoice':
        return openHref('/invoices/new')
      case 'send_invoice':
        return setSending(action)
    }
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.slice(0, 2).map((action) => (
        <Button key={action.label} variant="outline" size="sm" onClick={() => run(action)}>
          {action.label}
        </Button>
      ))}
      {sending && (
        <ConfirmDialog
          key={sending.invoice_id}
          title={translate('sendThisInvoice')}
          body={translate('itGoesToTheClientByEmailWithThe', { subject: sending.subject })}
          confirmLabel={translate('sendInvoice')}
          tone="default"
          onDecide={(approved) => {
            setSending(null)
            if (approved)
              send.mutate(
                { id: sending.invoice_id, input: { subject: sending.subject } },
                {
                  onSuccess: (invoice) =>
                    toast.success(translate('sent2', { value1: documentName(invoice) })),
                  onError: (error) => toast.error(errorMessage(error)),
                },
              )
          }}
        />
      )}
    </div>
  )
}

/** A quiet icon button under a finished answer; a check confirms the copy. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const label = copied ? translate('copied2') : translate('copy5')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          // Keeps the row shown while "Copied" confirms the click.
          data-copied={copied || undefined}
          className="text-muted-foreground"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              },
              () => toast.error(translate('couldnTCopyTheAnswer')),
            )
          }
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const clock = new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit' })
const dayAndClock = new Intl.DateTimeFormat(languageTag, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const fullDate = new Intl.DateTimeFormat(languageTag, { dateStyle: 'full', timeStyle: 'short' })

/** "08:31" today, "10 Nov, 08:31" on another day. */
export function messageTime(at: Date, now = new Date()) {
  return (at.toDateString() === now.toDateString() ? clock : dayAndClock).format(at)
}

function Time({ at, className }: { at?: Date; className?: string }) {
  if (!at) return null
  return (
    <time dateTime={at.toISOString()} title={fullDate.format(at)} className={className}>
      {messageTime(at)}
    </time>
  )
}

export function Message({
  message,
  answer,
  busy,
  highlighted,
  onRetry,
  onSubmitForm,
  onQuote,
  turnFiles,
}: {
  message: ChatMessage
  /** The message that answered this one's form, if any. */
  answer?: string
  busy: boolean
  highlighted: boolean
  onRetry: () => void
  onSubmitForm: (text: string, files: File[]) => void
  /** Quotes part of this message in the next one (from the right-click menu). */
  onQuote: (quote: string) => void
  /** Files of the question this answer replies to, kept in this browser. */
  turnFiles?: File[]
}) {
  const answerText = useRef<HTMLDivElement>(null)

  if (message.role === 'user') {
    const { quote, body } = splitQuote(message.text)
    return (
      <li data-message={message.id} className="grid justify-items-end gap-1">
        <MessageMenu plain={() => body} onQuote={onQuote}>
          <div
            className={cn(
              'grid max-w-[85%] justify-items-end gap-1.5 rounded-2xl rounded-br-md bg-heidi-soft px-3.5 py-2 text-body-sm leading-relaxed whitespace-pre-wrap text-foreground @sm/heidi:text-body',
              highlighted && 'ring-2 ring-heidi/50',
            )}
          >
            {quote && (
              <blockquote className="line-clamp-3 justify-self-stretch border-l-2 border-heidi/50 pl-2 text-body-sm text-muted-foreground">
                {quote}
              </blockquote>
            )}
            {body}
            {message.attachments.length > 0 && (
              <ul className="flex flex-wrap justify-end gap-1">
                {message.attachments.map((name) => (
                  <li
                    key={name}
                    className="flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-caption text-muted-foreground"
                  >
                    <FileText className="size-3" /> {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </MessageMenu>
        <Time at={message.at} className="px-1 text-caption text-muted-foreground" />
      </li>
    )
  }

  const streaming = message.state === 'streaming'
  const records = message.records?.length ? recordsText(message.records) : ''
  const markdown = records ? `${message.text}\n\n${records}` : message.text
  return (
    <li
      data-message={message.id}
      className="group/answer grid gap-1.5 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
    >
      <div className="flex items-center gap-1.5 px-1 text-caption text-muted-foreground">
        <HeidiSparkle className="size-3.5" />
        <span className="font-medium text-foreground">{translate('heidi')}</span>
        <Time at={message.at} />
      </div>
      <MessageMenu
        markdown={markdown}
        plain={() => {
          const text = answerText.current?.innerText || answerText.current?.textContent || ''
          return records ? `${text.trim()}\n\n${records}` : text.trim()
        }}
        onQuote={onQuote}
      >
        <div
          className={cn(
            // The answer sits on the panel itself, like a page of text; only the question is a bubble.
            'min-w-0 rounded-lg px-1 text-body-sm leading-relaxed text-foreground @sm/heidi:text-body',
            highlighted && 'ring-2 ring-heidi/50 ring-offset-4 ring-offset-background',
          )}
        >
          <ActivityLine message={message} />
          {message.text && (
            <div
              ref={answerText}
              // A finished answer's text can be selected and quoted in a reply (see the panel).
              data-answer={streaming ? undefined : ''}
            >
              <Suspense fallback={<p className="whitespace-pre-wrap">{message.text}</p>}>
                <Markdown text={message.text} streaming={streaming} />
              </Suspense>
              {streaming && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse rounded-full bg-heidi/70 motion-reduce:animate-none"
                />
              )}
            </div>
          )}
          {message.records && message.records.length > 0 && <Records records={message.records} />}
          {message.importId && <ImportCard batchId={message.importId} />}
          {message.form && (
            <HeidiFormView
              form={message.form}
              answer={answer}
              disabled={busy}
              attachments={turnFiles}
              onSubmit={onSubmitForm}
            />
          )}
          {message.actions.length > 0 && message.state !== 'streaming' && (
            <Actions actions={message.actions} />
          )}
          {message.state === 'stopped' && (
            <p className="mt-1 text-body-sm text-muted-foreground">{translate('stopped')}</p>
          )}
          {message.state === 'error' && (
            <div
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-lg bg-destructive-surface/60 px-3 py-2 text-body-sm text-destructive"
            >
              {/* The icon sits on the first line; Retry follows the text, however many lines it takes. */}
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="text-pretty">
                  {message.error ?? translate('somethingWentWrong2')}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 px-2 text-inherit hover:bg-background/50"
                  disabled={busy}
                  onClick={onRetry}
                >
                  <RotateCw />
                  {translate('retry2')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </MessageMenu>
      {message.state === 'done' && message.text && (
        // Quiet until the answer is hovered or focused; always there on touch screens.
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/answer:opacity-100 group-hover/answer:opacity-100 has-data-copied:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
          <CopyButton text={markdown} />
        </div>
      )}
    </li>
  )
}
