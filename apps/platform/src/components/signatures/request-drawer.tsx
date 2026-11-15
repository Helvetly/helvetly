'use client'
import { languageTag, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetTitle } from '@helvetly/ui/components/sheet'
import { formatDate, formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BellRing, Ban, Download, FileSignature, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { PdfView } from '@/components/invoices/pdf-view'
import { RecordPageButton } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { contentUrl, downloadUrl } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import {
  originalUrl,
  progressOf,
  signaturesApi,
  signerColor,
  useSignatureMutation,
  useSignatureRequest,
  type SignatureEvent,
  type SignatureRequest,
  type Signer,
} from '@/lib/signatures'

import { RequestBadge, SignerBadge } from './parts'

const EVENT_LABELS: Record<SignatureEvent['type'], string> = {
  created: translate('created3'),
  sent: translate('linkEmailed'),
  viewed: translate('openedTheDocument'),
  signed: translate('signed'),
  declined: translate('declined'),
  reminded: translate('reminderEmailed'),
  revoked: translate('revoked'),
  completed: translate('completedSignedPDFFiled'),
}

const SIGNER_VERBS: Record<Signer['status'], string> = {
  waiting: translate('waiting'),
  sent: translate('emailed'),
  viewed: translate('opened'),
  signed: translate('signed'),
  declined: translate('declined'),
}

const time = new Intl.DateTimeFormat(languageTag, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** One request: the document, each signer's progress, the audit trail and what can be done. */
export function RequestDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useSignatureRequest(id)
  const request = query.data
  const remind = useSignatureMutation(signaturesApi.remind)
  const revoke = useSignatureMutation(signaturesApi.revoke)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const pending = request?.status === 'pending'
  // The finished PDF once there is one, the frozen original before.
  const src = request?.signed_document ? contentUrl(request.signed_document.id) : originalUrl(id)

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-full! max-w-none! gap-0 overflow-hidden bg-card p-0 sm:w-[min(1120px,calc(100vw-2rem))]!"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-icon-surface text-section-icon">
            <FileSignature className="size-4 stroke-[1.75]" />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[15px] font-medium">
              {request?.title ?? translate('loading')}
            </SheetTitle>
            {request && (
              <p className="truncate text-[12px] text-muted-foreground">
                {progressOf(request).signed}
                {translate('of5')}
                {progressOf(request).total}
                {translate('signed2')}{' '}
                {request.status === 'completed' && request.completed_at
                  ? translate('dynamicCompleted', { value1: formatDate(request.completed_at) })
                  : translate('dynamicExpires', { value1: formatDate(request.expires_at) })}
              </p>
            )}
          </div>
          {request?.signed_document && (
            <Button asChild className="cursor-pointer gap-1.5">
              <a href={localizedHref(downloadUrl(request.signed_document.id))}>
                <Download className="size-4" />
                <span className="max-sm:sr-only">{translate('downloadSignedPDF')}</span>
              </a>
            </Button>
          )}
          {pending && (
            <>
              <Button
                variant="outline"
                className="cursor-pointer gap-1.5"
                disabled={remind.isPending}
                onClick={() =>
                  remind.mutate(id, {
                    onSuccess: () => toast.success(translate('reminderSentWithAFreshLink')),
                    onError: toastError,
                  })
                }
              >
                <BellRing className="size-4" />
                <span className="max-sm:sr-only">{translate('remind')}</span>
              </Button>
              <Button
                variant="destructive-ghost"
                className="cursor-pointer gap-1.5"
                onClick={() => setConfirmRevoke(true)}
              >
                <Ban className="size-4" />
                <span className="max-sm:sr-only">{translate('revoke')}</span>
              </Button>
            </>
          )}
          <span className="mx-1 h-5 w-px bg-border" />
          <RecordPageButton />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('close')}
            className="cursor-pointer"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="relative hidden min-w-0 flex-1 md:block">
            {request && (
              <PdfView key={src} src={src} title={request.title} className="absolute inset-0" />
            )}
          </div>
          <aside className="w-full shrink-0 overflow-y-auto md:w-[360px] md:border-l">
            {request ? (
              <Details request={request} />
            ) : query.error ? (
              <p className="p-5 text-[13.5px] text-muted-foreground">{errorMessage(query.error)}</p>
            ) : (
              <Loader className="min-h-48" />
            )}
          </aside>
        </div>
        {confirmRevoke && (
          <ConfirmDialog
            title={translate('revokeThisRequest')}
            body={translate('everySigningLinkStopsWorkingAtOnceSignaturesAlready')}
            confirmLabel={translate('revoke')}
            tone="destructive"
            confirmIcon={<Ban />}
            onDecide={(approved) => {
              setConfirmRevoke(false)
              if (approved)
                revoke.mutate(id, {
                  onSuccess: () => toast.success(translate('requestRevoked')),
                  onError: toastError,
                })
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Heading({ children }: { children: string }) {
  return (
    <h3 className="text-[12px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function Details({ request }: { request: SignatureRequest }) {
  return (
    <div className="grid gap-6 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <RequestBadge status={request.status} />
        <span className="text-[12.5px] text-muted-foreground">
          {request.signing_order === 'sequential'
            ? translate('oneAfterAnother')
            : translate('everyoneAtOnce')}
        </span>
      </div>
      {request.message && (
        <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] whitespace-pre-line text-muted-foreground">
          {request.message}
        </p>
      )}
      <section className="grid gap-2">
        <Heading>{translate('signers')}</Heading>
        <ol className="grid gap-1.5">
          {request.signers.map((signer, index) => (
            <SignerRow key={signer.id} signer={signer} index={index} />
          ))}
        </ol>
      </section>
      <section className="grid gap-2">
        <Heading>{translate('files')}</Heading>
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[13.5px]">
          <dt className="text-muted-foreground">{translate('original')}</dt>
          <dd className="min-w-0 truncate">
            <a
              href={localizedHref(originalUrl(request.id))}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:no-underline"
            >
              {request.document?.name ?? translate('frozenOriginal')}
            </a>
          </dd>
          <dt className="text-muted-foreground">{translate('signed')}</dt>
          <dd className="min-w-0 truncate">
            {request.signed_document ? (
              <a
                href={localizedHref(downloadUrl(request.signed_document.id))}
                className="underline underline-offset-2 hover:no-underline"
              >
                {request.signed_document.name}
              </a>
            ) : (
              <span className="text-muted-foreground">
                {request.status === 'pending'
                  ? translate('whenEveryoneHasSigned')
                  : translate('noneNotSignedByEveryone')}
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">{translate('sentBy')}</dt>
          <dd className="min-w-0 truncate">
            {request.created_by?.name ?? translate('someone')} · {formatDate(request.created_at)}
          </dd>
        </dl>
        <Hash label={translate('originalSHA256')} value={request.original_sha256} />
        {request.final_sha256 && (
          <Hash label={translate('signedSHA256')} value={request.final_sha256} />
        )}
      </section>
      {request.events && request.events.length > 0 && (
        <section className="grid gap-2">
          <Heading>{translate('auditTrail')}</Heading>
          <ol className="relative grid gap-3 border-l pl-4">
            {request.events.map((event) => (
              <li key={event.hash} className="relative text-[13px]">
                <span
                  className={cn(
                    'absolute top-1.5 -left-[21px] size-2 rounded-full ring-4 ring-card',
                    event.type === 'declined' || event.type === 'revoked'
                      ? 'bg-[#d64545]'
                      : event.type === 'signed' || event.type === 'completed'
                        ? 'bg-success-solid'
                        : 'bg-border',
                  )}
                />
                <p>
                  <span className="font-medium">{EVENT_LABELS[event.type]}</span>
                  {event.signer && (
                    <span className="text-muted-foreground"> · {event.signer.name}</span>
                  )}
                </p>
                <p
                  className="text-[12px] text-muted-foreground"
                  title={event.user_agent ?? undefined}
                >
                  {time.format(new Date(event.at))}
                  {event.ip && ` · ${event.ip}`}
                </p>
              </li>
            ))}
          </ol>
          <p className="flex gap-2 text-[12px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-px size-3.5 shrink-0 stroke-[1.75] text-success-solid" />
            {translate('eachEventIsChainedToTheOneBeforeBy')}
          </p>
        </section>
      )}
    </div>
  )
}

function SignerRow({ signer, index }: { signer: Signer; index: number }) {
  const when = signer.signed_at ?? signer.declined_at ?? signer.viewed_at ?? signer.sent_at ?? null
  return (
    <li className="grid gap-1 rounded-xl border px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ backgroundColor: signerColor(index) }}
        >
          {signer.position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{signer.name}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{signer.email}</span>
        </span>
        <SignerBadge status={signer.status} />
      </div>
      {when && signer.status !== 'waiting' && (
        <p
          className="pl-[34px] text-[12px] text-muted-foreground"
          title={time.format(new Date(when))}
        >
          {SIGNER_VERBS[signer.status]} {formatRelative(when)}
        </p>
      )}
      {signer.decline_reason && (
        <p className="ml-[34px] rounded-lg bg-[#f4e0e0]/60 px-2.5 py-1.5 text-[12.5px] text-[#8d4f4f] dark:bg-rose-500/10 dark:text-rose-200">
          “{signer.decline_reason}”
        </p>
      )}
    </li>
  )
}

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      title={translate('copy2', { label: label })}
      onClick={() => {
        void navigator.clipboard.writeText(value)
        toast(translate('copied', { label: label }))
      }}
      className="cursor-pointer truncate rounded-lg bg-muted/60 px-2.5 py-2 text-left font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
    >
      {label} {value}
    </button>
  )
}
